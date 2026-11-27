import { deserializeGameRef, gameCatalogKey } from './game-identity';
import { collectionItemTypeLabel } from './collection-item-types';
import type { CollectionV2Writer } from './collection-v2-management';

type Preview = Awaited<ReturnType<CollectionV2Writer['previewRelink']>>;
type RelinkResult = Awaited<ReturnType<CollectionV2Writer['relink']>>;
type HistoryRows = Awaited<ReturnType<CollectionV2Writer['relinkHistory']>>;

interface BasicEditor {
 isBusy(): boolean;
 revision(): number;
 onConflict(): void;
 onSuccess(result: RelinkResult, displayName: string, rename: boolean, sourceId: string): void;
}

export function initializeCollectionRelink(root: HTMLElement, editor?: BasicEditor) {
 const {relinkId: id, relinkScope: scope, relinkLang: lang} = root.dataset;
 const en = lang === 'en';
 const t = (zh: string, english: string) => en ? english : zh;
 const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
 const relink = find<HTMLDialogElement>('[data-relink]');
 const relinkOpen = find<HTMLButtonElement>('[data-relink-open]');
 const relinkSearch = find<HTMLFormElement>('[data-relink-search]');
 const relinkConfirm = find<HTMLFormElement>('[data-relink-confirm]');
 const relinkResults = find<HTMLElement>('[data-relink-results]');
 const relinkStatus = find<HTMLElement>('[data-relink-status]');
 const relinkEmpty = find<HTMLElement>('[data-relink-empty]');
 const typeConfirm = relinkConfirm.elements.namedItem('confirmType') as HTMLInputElement;
 const rename = relinkConfirm.elements.namedItem('rename') as HTMLInputElement;
 const confirmButton = relinkConfirm.querySelector('button')!;
 const historyOpen = find<HTMLButtonElement>('[data-relink-history-open]');
 const historyDialog = find<HTMLDialogElement>('[data-relink-history-dialog]');
 const historyList = find<HTMLOListElement>('[data-relink-history]');
 const historyStatus = find<HTMLElement>('[data-relink-history-status]');
 const success = find<HTMLElement>('[data-relink-success]');
 const path = (suffix: string) => '/api/admin/collection' + suffix + '?scope=' + scope;
 const relinkUrl = (action: string) => path('/' + id) + '&action=' + action;
 const typeLabel = (type: string) => collectionItemTypeLabel(type, en);
 const gameChange = (data: Preview) =>
  (data.current.name ?? t('缺少對應遊戲','Missing linked game')) + ' → ' + data.target.name;
 const stale = () => t('收藏已變更，請重新載入最新資料後再試。','The collection changed. Reload the latest data and try again.');

 let preview: Preview | null = null;
 let relinkBusy = false;
 let submitting = false;
 let relinkBody = '';
 let relinkKey = '';
 // The server renders the current count, so the button is correct on first paint on every tab.
 let historyCount = Number(historyOpen.dataset.count ?? 0) || 0;
 let historyRevision = historyOpen.dataset.revision ? Number(historyOpen.dataset.revision) : -1;
 let historyRequest = 0;
 let archived = false;
 let successTimer: number | undefined;

 async function api<T>(url: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(url, {
   method: body === undefined ? 'GET' : 'PATCH',
   headers: {'Content-Type':'application/json', 'X-NotBGG-Request':'1', ...(key ? {'Idempotency-Key':key} : {})},
   body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json() as {data: T; error?: {code: string}};
  if (!response.ok) throw new Error(response.status + ' · ' + (json.error?.code ?? 'SERVICE_UNAVAILABLE'));
  return json.data;
 }

 function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
 }

 function syncRelinkControls() {
  relink.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(control => {
   control.disabled = control.hasAttribute('data-relink-close') ? submitting : relinkBusy;
  });
  confirmButton.disabled = relinkBusy || !preview || preview.sameGame || (preview.typeChanged && !typeConfirm.checked);
 }

 function clearPreview() {
  preview = null;
  relinkConfirm.reset();
  relinkConfirm.hidden = true;
  for (const selector of ['games','types','affected','preserved']) find('[data-relink-' + selector + ']').textContent = '';
  find('[data-relink-duplicate]').hidden = true;
  find('[data-relink-type-confirm]').hidden = true;
  syncRelinkControls();
 }

 function updateHistoryButton() {
  historyOpen.hidden = archived || historyCount === 0;
  historyOpen.textContent = t('紀錄 ', 'History ') + new Intl.NumberFormat(lang).format(historyCount);
 }

 async function renderRelinkHistory() {
  const request = ++historyRequest;
  historyStatus.textContent = t('載入紀錄中…','Loading history…');
  try {
   // The endpoint orders rows by revision descending.
   const rows = await api<HistoryRows>(relinkUrl('relink-history'));
   if (request !== historyRequest) return;
   historyCount = rows.length;
   historyRevision = rows[0]?.revision ?? -1;
   updateHistoryButton();
   const date = new Intl.DateTimeFormat(lang, {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Taipei'});
   historyList.replaceChildren(...rows.map(row => {
    const label = row.from_name ?? t('缺少對應遊戲','Missing linked game');
    const timestamp = new Date(row.occurred_at.replace(' ', 'T')+'Z');
    return node('li', label + ' → ' + row.to_name + ' · ' + date.format(timestamp));
   }));
   historyStatus.textContent = rows.length ? '' : t('目前沒有更換紀錄。','No changes recorded.');
  } catch {
   if (request === historyRequest) historyStatus.textContent = t('無法載入更換紀錄。','Unable to load change history.');
  }
 }

 async function runRelink(action: () => Promise<void>, isSubmission = false) {
  if (archived || relinkBusy || editor?.isBusy()) return;
  relinkBusy = true;
  submitting = isSubmission;
  syncRelinkControls();
  relinkStatus.textContent = t('處理中…','Working…');
  try {
   await action();
  } catch (error) {
   const message = error instanceof Error ? error.message : '';
   if (message.includes('409 · CONFLICT')) {
    editor?.onConflict();
    relinkStatus.textContent = stale();
   } else {
    relinkStatus.textContent = t('無法完成更換操作。','Unable to complete the linked game operation.');
    if (/^\d{3} · [A-Z_]+$/.test(message)) relinkStatus.textContent += ' ' + message;
   }
   if (relink.open) relinkStatus.focus();
  } finally {
   relinkBusy = false;
   submitting = false;
   syncRelinkControls();
  }
 }

 function wireDialog(dialog: HTMLDialogElement, opener: HTMLButtonElement) {
  dialog.querySelector('[data-relink-close]')!.addEventListener('click', () => {
   if (!submitting) dialog.close();
  });
  dialog.addEventListener('cancel', event => {
   if (submitting) event.preventDefault();
  });
  dialog.addEventListener('close', () => opener.focus());
 }

 wireDialog(relink, relinkOpen);
 wireDialog(historyDialog, historyOpen);
 relinkOpen.addEventListener('click', () => {
  if (!archived && !editor?.isBusy()) relink.showModal();
 });
 historyOpen.addEventListener('click', () => {
  historyDialog.showModal();
  void renderRelinkHistory();
 });
 updateHistoryButton();
 relinkSearch.addEventListener('submit', event => {
  event.preventDefault();
  const q = String(new FormData(relinkSearch).get('q') ?? '').trim();
  void runRelink(async () => {
   const rows = await api<Awaited<ReturnType<CollectionV2Writer['search']>>>(path('/search') + '&q=' + encodeURIComponent(q));
   clearPreview();
   relinkResults.replaceChildren();
   for (const row of rows) {
    const ref = gameCatalogKey(row.ref);
    const button = node('button', row.name + ' · ' + ref) as HTMLButtonElement;
    button.type = 'button';
    button.className = 'admin-kit-button';
    button.onclick = () => void runRelink(async () => {
     const data = await api<Preview>(relinkUrl('relink-preview') + '&ref=' + encodeURIComponent(ref));
     if (editor && data.revision !== editor.revision()) {
      clearPreview();
      editor.onConflict();
      relinkStatus.textContent = stale();
      return;
     }
     clearPreview();
     preview = data;
     find<HTMLElement>('[data-relink-games]')!.textContent =
      gameChange(data);
     find<HTMLElement>('[data-relink-types]')!.textContent =
      t('收藏類型','Collection type') + ' · ' + typeLabel(data.current.itemType) + ' → ' + typeLabel(data.target.itemType);
     find<HTMLElement>('[data-relink-duplicate]')!.hidden = !data.hasOtherCollections;
     const impacts = {publicGamePage:t('公開遊戲頁','Public game page'), seriesSpending:t('系列花費歸屬','Series spending'), publicSleeves:t('公開卡套頁','Public sleeve page')};
     const labels = {copies:t('副本','Copies'), components:t('組件','Components'), photos:t('照片','Photos'),
      counts:t('清點','Counts'), sleeves:t('卡套需求','Sleeve requirements'), purchases:t('採購','Purchases'), relations:t('收藏關聯','Collection relationships')};
     find<HTMLElement>('[data-relink-affected]')!.textContent = t('會變更','Affected') + ' · ' + data.affected.map(key => impacts[key]).join(' · ');
     find<HTMLElement>('[data-relink-preserved]')!.textContent = t('保留資料','Preserved') + ' · ' +
      (Object.keys(labels) as (keyof typeof labels)[]).map(key => labels[key] + ' ' + data.preserved[key]).join(' · ');
     find<HTMLElement>('[data-relink-type-confirm]')!.hidden = !data.typeChanged;
     relinkConfirm.hidden = false;

     relinkStatus.textContent = data.sameGame ? t('這款遊戲已是目前的對應。','This game is already linked.') : '';
    }).then(() => {
     if (relink.open && !relinkConfirm.hidden && document.activeElement === document.body) rename.focus();
    });
    relinkResults.appendChild(button);
   }
   relinkEmpty.hidden = rows.length > 0;
   relinkStatus.textContent = '';
  });
 });
 typeConfirm.addEventListener('change', syncRelinkControls);
 relinkConfirm.addEventListener('submit', event => {
  event.preventDefault();
  const data = preview;
  if (!data || confirmButton.disabled) return;
  void runRelink(async () => {
   const body = {action:'relink', ref:data.target.ref, revision:data.revision,
    renameToGame:rename.checked, confirmTypeChange:typeConfirm.checked};
   const serialized = JSON.stringify(body);
   // Retrying the same submission after a failed response must use its original key.
   if (relinkBody !== serialized) {
    relinkKey = crypto.randomUUID();
    relinkBody = serialized;
   }
   const result = await api<RelinkResult>(path('/' + id), body, relinkKey);
   const header = result.header;
   const heading = find<HTMLHeadingElement>('h1');
   const displayName = header?.display_name ?? (body.renameToGame ? data.target.name : heading.textContent ?? '');
   const sourceId = header?.source_id ?? gameCatalogKey(data.target.ref);
   if (heading) heading.textContent = displayName;
   const game = find<HTMLElement>('[data-detail-game]');
   if (game) {game.textContent = header?.game_name ?? data.target.name; game.hidden = game.textContent === displayName;}
   const source = find<HTMLAnchorElement>('[data-detail-source]');
   const type = find<HTMLElement>('[data-detail-type]');
   if (source) {
    const ref = deserializeGameRef(sourceId);
    source.textContent = sourceId;
    source.href = (en ? '/en' : '') + (ref.source === 'bgg' ? '/games/bgg-' + ref.bggId : '/games/notbgg/' + ref.notBggId.slice(7));
    source.hidden = false;
    find<HTMLElement>('[data-detail-source-missing]')!.hidden = true;
   }
   if (type) type.textContent = typeLabel(header?.item_type ?? data.target.itemType);
   const cover = find<HTMLElement>('.admin-detail-cover');
   if (cover) {
    cover.querySelector('img')?.remove();
    if (header?.image) {
     const image = document.createElement('img');
     image.alt = '';
     image.referrerPolicy = 'no-referrer';
     image.addEventListener('error', () => {image.hidden = true;}, {once:true});
     image.src = header.image;
     cover.appendChild(image);
    }
   }
   editor?.onSuccess(result, displayName, body.renameToGame, sourceId);
   relinkSearch.reset();
   clearPreview();
   relinkResults.replaceChildren();
   relinkEmpty.hidden = true;
   relinkStatus.textContent = '';
   relink.close();
   if (result.revision > historyRevision) {
    historyCount++;
    historyRevision = result.revision;
   }
   updateHistoryButton();
   void renderRelinkHistory();
   success.textContent = t('已更換對應遊戲','Linked game changed') + ' · ' + gameChange(data);
   window.clearTimeout(successTimer);
   successTimer = window.setTimeout(() => { success.textContent = ''; }, 5000);
  }, true);
 });

 return {
  get busy() { return relinkBusy; },
  setArchived(value: boolean) {
   archived = value;
   relinkOpen.hidden = value;
   updateHistoryButton();
  },
 };
}
