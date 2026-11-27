export {};

const root = document.querySelector<HTMLElement>('[data-bgg-admin]');
if (root) connect(root);

function connect(root: HTMLElement) {
  const en = root.dataset.lang === 'en';
  const t = (zh: string, english: string) => en ? english : zh;
  const status = root.querySelector<HTMLElement>('[data-bgg-status]')!;
  const toolbar = root.querySelector<HTMLFormElement>('[data-game-relation-toolbar]');
  const filterToggle = toolbar?.querySelector<HTMLButtonElement>('[data-relation-filter-toggle]');
  function setFilterOpen(open: boolean) {
    toolbar?.toggleAttribute('data-filter-open', open);
    filterToggle?.setAttribute('aria-expanded', String(open));
  }
  filterToggle?.addEventListener('click', () => setFilterOpen(!toolbar?.hasAttribute('data-filter-open')));
  toolbar?.querySelector('[data-relation-search]')?.addEventListener('input', () => setFilterOpen(true));
  const url = new URL(location.href);
  const readError = root.querySelector('p[role=alert]');
  if (readError && url.searchParams.get('view') === 'relations' &&
      url.searchParams.get('domain') !== 'collection' &&
      ['bgg', 'all'].includes(url.searchParams.get('origin') ?? '')) {
    url.searchParams.set('origin', 'manual');
    url.searchParams.delete('after');
    const manual = document.createElement('a');
    manual.href = url.href;
    manual.textContent = t('回到手動關聯以縮小篩選範圍', 'Return to Manual to narrow the filter');
    readError.appendChild(document.createTextNode(' '));
    readError.appendChild(manual);
  }
  const saved = 'bgg-admin-saved:' + location.href;
  try {
    const value = sessionStorage.getItem(saved);
    if (value) {
      status.textContent = value;
      sessionStorage.removeItem(saved);
    }
  } catch {
    // Storage can be unavailable. The current page still supports all operations.
  }

  const commands = new Map<string, {body: string; key: string}>();
  let busy = false;

  function errorMessage(code: string, relation: boolean) {
    switch (code) {
      case 'BGG_SYNC_BUSY': return t('另一同步正在執行或冷卻中，請稍後重試。', 'A sync is active or cooling down. Retry shortly.');
      case 'BGG_AUTH_UNAVAILABLE': return t('伺服器尚未設定 BGG 認證。', 'BGG server authentication is not configured.');
      case 'RELATION_DIRECTION_UNVERIFIED': return t('無法驗證關聯方向或角色，請確認主遊戲、擴充、配件或合輯身份。', 'Relation direction or roles cannot be verified. Check base, expansion, accessory or bundle identities.');
      case 'RELATION_CYCLE': return t('此關聯會形成依賴循環。', 'This relation would create a dependency cycle.');
      case 'INVALID_RELATION_REFERENCE': return t('無法使用所選端點。請確認資料仍有效、收藏範圍一致，且遊戲端點沒有指向同一個已連結身分。', 'The selected endpoints are unavailable, outside the same collection scope, or already linked as one game identity.');
      case 'RELATION_STATE_CHANGED': return t('關聯狀態已變更或已有相同關聯。請核對後重試。', 'The relation changed or a duplicate exists. Check the current records and retry.');
      case 'INVALID_RELATION': return t('無法完成。請選擇兩個不同的端點並核對關聯類型。', 'Could not complete. Select two different endpoints and check the relation type.');
      default: return relation
        ? t('無法完成關聯操作，請稍後重試。', 'Could not complete the relation operation. Retry later.')
        : t('無法完成。請檢查最多 3 筆不同 ID 及權限後重試。', 'Could not complete. Check the limit of 3 distinct IDs and access.');
    }
  }

  async function send(body: Record<string, unknown>, scope: string, form?: HTMLFormElement) {
    if (busy) return;
    const serialized = JSON.stringify(body);
    let command = commands.get(scope);
    if (command?.body !== serialized) {
      command = {body: serialized, key: crypto.randomUUID()};
      commands.set(scope, command);
    }
    const localError = form?.querySelector<HTMLElement>('[data-relation-error]');
    const buttons = [...root.querySelectorAll('button:enabled')] as HTMLButtonElement[];
    busy = true;
    buttons.forEach(button => button.disabled = true);
    if (localError) localError.hidden = true;
    status.textContent = t('處理中…', 'Working…');
    try {
      const response = await fetch('/api/admin/bgg', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-NotBGG-Request': '1', 'Idempotency-Key': command.key},
        body: serialized,
      });
      const result = await response.json() as {
        success?: boolean;
        error?: {code: string};
        data?: {results?: {bggId: number; status: string; code: string | null}[]};
      };
      if (!response.ok || !result.success) throw new Error(result.error?.code ?? 'BGG_SERVICE_UNAVAILABLE');
      const message = result.data?.results?.map(item =>
        'BGG ' + item.bggId + ' · ' + (item.status === 'success' ? t('成功', 'Succeeded') : t('失敗', 'Failed')) +
        (item.code ? ' · ' + item.code : '')).join(' / ') ??
        (body.action === 'archive' ? t('關聯已封存。', 'Relation archived.') : t('關聯已儲存。', 'Relation saved.'));
      const next = new URL(location.href);
      if (body.action === 'save' && body.domain === 'collection' && body.id === 0) {
        next.searchParams.set('relationTarget', String(body.targetId));
      }
      try {
        sessionStorage.setItem('bgg-admin-saved:' + next.href, message);
      } catch {
        // Navigation still refreshes the saved relation when storage is unavailable.
      }
      if (next.href === location.href) location.reload();
      else location.assign(next.href);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const message = errorMessage(code, Boolean(localError));
      if (localError) {
        status.textContent = '';
        localError.hidden = false;
        localError.textContent = message + (/^[A-Z][A-Z_]+$/.test(code) ? ' (' + code + ')' : '');
        localError.focus();
      } else {
        status.textContent = message;
        status.dataset.tone = 'error';
        status.focus();
      }
      buttons.forEach(button => button.disabled = false);
      busy = false;
    }
  }

  const editor = root.querySelector<HTMLFormElement>('[data-bgg-action=relation]');
  const editorSelect = (name: string) => {
    const field = editor?.elements.namedItem(name);
    return field instanceof HTMLSelectElement ? field : undefined;
  };
  const source = editorSelect('sourceId');
  const target = editorSelect('targetId');
  const type = editorSelect('type');
  const preview = editor?.querySelector<HTMLElement>('[data-relation-preview]');
  const hint = editor?.querySelector<HTMLElement>('[data-relation-hint]');
  let suggestType = false;

  function updatePreview() {
    if (!source || !target || !type || !preview || !hint) return;
    const label = (field: HTMLSelectElement) => field.value ? field.selectedOptions[0]?.textContent?.trim() : '—';
    preview.textContent = label(source) + ' → ' + label(target);
    const rule = type.selectedOptions[0]?.dataset.hint;
    hint.textContent = rule ? t('方向限制', 'Direction rule') + ' · ' + rule : '';
  }

  function updateSuggestedType() {
    if (!suggestType || !source || !type) return;
    const itemType = source.selectedOptions[0]?.dataset.itemType;
    type.value = itemType === 'expansion' ? 'expansion_of' : itemType === 'accessory' ? 'accessory_for' : 'other';
  }

  function filterPicker(search: HTMLInputElement) {
    const picker = search.closest('[data-relation-picker]')!;
    const select = picker.querySelector('select')!;
    const message = picker.querySelector<HTMLElement>('[data-relation-no-matches]')!;
    const terms = search.value.trim().toLocaleLowerCase().split(/\s+/);
    let match = false;
    for (const option of select.options) {
      const text = option.textContent?.toLocaleLowerCase() ?? '';
      const matches = terms.every(term => text.includes(term));
      if (option.value && matches) match = true;
      option.hidden = Boolean(option.value && !matches && !option.selected);
    }
    message.hidden = !search.value.trim() || match;
  }

  root.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-relation-search]')) filterPicker(event.target);
  });
  root.addEventListener('change', event => {
    const field = event.target;
    if (!(field instanceof HTMLSelectElement)) return;
    const search = field.closest('[data-relation-picker]')?.querySelector<HTMLInputElement>('[data-relation-search]');
    if (search) filterPicker(search);
    if (field === type) suggestType = false;
    if (field === source) updateSuggestedType();
    if (field.form === editor) updatePreview();
  });

  function setFields(form: HTMLFormElement, values: Record<string, unknown>) {
    for (const [name, value] of Object.entries(values)) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = Boolean(value);
      else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
        const string = String(value);
        // An older row can reference an archived endpoint. Require an active selection before saving.
        field.value = field instanceof HTMLSelectElement && !Array.from(field.options).some(option => option.value === string) ? '' : string;
      }
    }
  }

  function openDialog(opener: HTMLElement) {
    const dialog = document.getElementById(opener.dataset.relationOpen ?? '');
    if (!(dialog instanceof HTMLDialogElement) || dialog.open || busy) return;
    const error = dialog.querySelector<HTMLElement>('[data-relation-error]');
    if (error) { error.hidden = true; error.textContent = ''; }
    if (dialog.id === 'relation-editor' && editor) {
      // Hidden inputs reflect the value attribute, so reset the command fields explicitly.
      editor.reset();
      const edit = opener.dataset.relationEdit;
      setFields(editor, edit ? JSON.parse(edit) : {id: 0, revision: 0, notes: ''});
      const title = dialog.querySelector<HTMLElement>('h2')!;
      title.textContent = (edit ? title.dataset.edit : title.dataset.add) ?? '';
      suggestType = !edit && editor.hasAttribute('data-collection-editor');
      updateSuggestedType();
      editor.querySelectorAll<HTMLInputElement>('[data-relation-search]').forEach(filterPicker);
      updatePreview();
    }
    if (dialog.id === 'relation-archive') {
      setFields(dialog.querySelector('form')!, JSON.parse(opener.dataset.relationArchive ?? '{}'));
      dialog.querySelector('[data-relation-archive-description]')!.textContent = opener.dataset.relationDescription ?? '';
    }
    dialog.showModal();
  }

  root.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => {
    if (busy) event.preventDefault();
  }));
  root.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.bggAction) return;
    event.preventDefault();
    const data = new FormData(form);
    const action = form.dataset.bggAction;
    if (action === 'sync') {
      void send({action: 'sync', ids: String(data.get('ids')).split(',').map(value => Number(value.trim()))}, 'sync');
      return;
    }
    const body: Record<string, unknown> = {action: action === 'archive' ? 'archive' : 'save'};
    for (const [name, value] of data) body[name] = value;
    for (const name of ['id', 'revision', 'sourceId', 'targetId']) if (data.has(name)) body[name] = Number(data.get(name));
    if (action !== 'archive') body.confirmed = data.has('confirmed');
    void send(body, action + ':' + String(body.id), form);
  });

  root.addEventListener('click', event => {
    const element = event.target;
    if (!(element instanceof Element)) return;
    const opener = element.closest<HTMLElement>('[data-relation-open]');
    const single = element.closest<HTMLElement>('[data-sync-id]');
    if (opener) openDialog(opener);
    else if (element.closest('[data-relation-close]')) element.closest('dialog')?.close();
    else if (element.closest('[data-relation-swap]') && source && target && editor) {
      [source.value, target.value] = [target.value, source.value];
      editor.querySelectorAll<HTMLInputElement>('[data-relation-search]').forEach(search => {
        search.value = '';
        filterPicker(search);
      });
      updatePreview();
    } else if (single) void send({action: 'sync', ids: [Number(single.dataset.syncId)]}, 'sync');
    else if (element.closest('[data-sync-selected]')) {
      void send({action: 'sync', ids: [...root.querySelectorAll<HTMLInputElement>('[data-sync-select]:checked')].map(input => Number(input.value))}, 'sync');
    }
  });
}
