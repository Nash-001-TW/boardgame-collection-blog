import { deserializeGameRef,gameCatalogKey,type GameRef } from './game-identity';
import type { NumberedCollectionList } from './collection-v2-management';
import { collectionItemTypeLabel } from './collection-item-types';

function initializeCollectionList(root: HTMLElement) {
 const en = root.dataset.lang === 'en';
 const t = (zh: string, english: string) => en ? english : zh;
 const find = <T = HTMLElement>(selector: string) => root.querySelector(selector) as unknown as T;
 const form = find<HTMLFormElement>('[data-list-filters]');
 const table = find<HTMLTableSectionElement>('[data-admin-list]');
 const status = find('[data-admin-status]');
 const error = find('[data-r02-error]');
 const empty = find('[data-r02-empty]');
 const results = find('[data-r02-results]');
 const pagination = find('[data-r02-pagination]');
 const pages = find('[data-r02-pages]');
 const chips = find('[data-r02-chips]');
 const clear = find<HTMLButtonElement>('[data-clear]');
 const url = new URL(location.href);
 const tabs = root.querySelectorAll<HTMLAnchorElement>('[data-tab]');
 const rawTab = url.searchParams.get('tab');
 const tab = rawTab && Array.from(tabs).some(link => link.dataset.tab === rawTab) ? rawTab : 'all';
 const defaults: Record<string, string> = {view: 'records', sort: 'updated', limit: '20', scope: 'production'};
 const filters = ['q', 'players', 'source', 'archive', 'wishlist', 'status', 'scope'];
 const controls = form.querySelectorAll('input,select') as unknown as Iterable<HTMLInputElement | HTMLSelectElement>;
 const number = new Intl.NumberFormat(en ? 'en' : 'zh-TW');
 const date = new Intl.DateTimeFormat(en ? 'en-CA' : 'zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
 });
 const headings = Array.from(results.querySelectorAll('th'), th => th.textContent ?? '');
 const statuses = find<HTMLSelectElement>('[data-r02-status-labels]');
 const scope = url.searchParams.get('scope') === 'test' ? 'test' : 'production';
 const lang = en ? 'en' : 'zh-TW';
 const actionParams = new URLSearchParams({scope, lang});

 function target(changes: Record<string, string | null>) {
  const path = new URL(url);
  for (const [key, value] of Object.entries(changes)) {
   if (value === null || value === '') path.searchParams.delete(key);
   else path.searchParams.set(key, value);
  }
  return path.pathname + path.search;
 }

 const reset = target(Object.fromEntries([...filters, 'tab', 'page'].map(key => [key, null])));
 for (const field of controls) {
  field.value = url.searchParams.get(field.name) ?? defaults[field.name] ?? '';
  if (field instanceof HTMLSelectElement && field.selectedIndex < 0) field.value = defaults[field.name] ?? '';
  if (!filters.includes(field.name) || field.value === (defaults[field.name] ?? '')) continue;
  const chip = document.createElement('a');
  chip.className = 'admin-kit-button admin-kit-chip';
  chip.href = target({[field.name]: null, page: '1'});
  const label = field.closest('label')?.querySelector('span')?.textContent;
  const value = field instanceof HTMLSelectElement ? field.selectedOptions[0]?.textContent : field.value;
  chip.textContent = [label, value, '×'].join(' · ');
  chip.setAttribute('aria-label', t('移除條件', 'Remove filter') + ' ' + label + ' ' + value);
  chips.appendChild(chip);
  const advanced = field.closest('details');
  if (advanced) advanced.open = true;
 }
 clear.hidden = !chips.childElementCount && tab === 'all';
 clear.addEventListener('click', () => location.assign(reset));
 find<HTMLAnchorElement>('[data-r02-empty] a').href = reset;
 find<HTMLAnchorElement>('[data-r02-new]').search = actionParams.toString();
 for (const link of tabs) {
  link.href = target({tab: link.dataset.tab!, page: '1'});
  if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
 }

 function addCell(row: HTMLTableRowElement, index: number) {
  const cell = row.insertCell();
  if (index === 5) cell.className = 'admin-r02-date';
  const label = document.createElement('span');
  label.className = 'admin-kit-cell-label';
  label.textContent = headings[index];
  label.setAttribute('aria-hidden', 'true');
  cell.appendChild(label);
  return cell;
 }

 function render(data: NonNullable<NumberedCollectionList['list']>) {
  table.replaceChildren();
  for (const group of data.groups) {
   if (url.searchParams.get('view') === 'grouped') {
    const groupRow = table.insertRow();
    groupRow.className = 'admin-r02-group';
    groupRow.dataset.collectionGroup = group.key;
    const heading = document.createElement('th');
    heading.colSpan = headings.length;
    heading.textContent = group.game_name + ' · ' + t(number.format(group.items.length) + ' 筆收藏', number.format(group.items.length) + ' records');
    groupRow.appendChild(heading);
   }
   for (const item of group.items) {
    const row = table.insertRow();
    row.dataset.collectionId = String(item.id);
    const cover = document.createElement('span');
    cover.className = 'admin-r02-cover';
    // The fallback text exists only when no picture is shown, so screen readers never
    // announce "no cover" for a row whose (decorative, alt="") cover image loaded.
    const noCover = () => { cover.textContent = t('無封面', 'No cover'); };
    if (item.image) {
     const image = document.createElement('img');
     image.width = 56;
     image.height = 74;
     image.loading = 'lazy';
     image.alt = '';
     image.addEventListener('error', () => { image.remove(); noCover(); }, {once: true});
     image.src = item.image;
     cover.appendChild(image);
    } else {
     noCover();
    }
    addCell(row, 0).appendChild(cover);
    const name = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.display_name;
    const meta = document.createElement('small');
    const type = collectionItemTypeLabel(item.item_type, en);
    meta.textContent = [type, '#' + item.id, group.source_id ?? t('缺少來源身份', 'Missing source identity'),
     group.source_archived && t('來源遊戲已封存', 'Source game archived'),
     group.link_status === 'pending' && t('候選連結', 'Candidate link'),
     group.link_status === 'linked' && t('已確認連結', 'Confirmed link'), group.linked_source_id,
     group.primary_source && (group.primary_source === 'bgg' ? 'BGG' : 'NotBGG'),
     item.archived_at && t('收藏已封存', 'Collection archived')].filter(Boolean).join(' · ');
    name.appendChild(title);
    name.appendChild(meta);
    addCell(row, 1).appendChild(name);
    const badges = document.createElement('div');
    badges.className = 'admin-kit-row';
    const acquisition = item.owned === 1 ? 'owned' : item.acquisition_status === 'owned' ? 'not_owned' : item.acquisition_status;
    const flags = new Set([acquisition]);
    if (item.acquisition_status === 'preordered') flags.add('preordered');
    if (item.wishlist === 1) flags.add('wishlist');
    for (const flag of flags) {
     const badge = document.createElement('span');
     badge.className = 'admin-kit-badge';
     badge.dataset.tone = flag === 'owned' ? 'success' : flag === 'wishlist' ? 'wish' : flag === 'preordered' ? 'preorder' : 'neutral';
     const icon = document.createElement('span');
     icon.setAttribute('aria-hidden', 'true');
     icon.textContent = flag === 'owned' ? '✓' : flag === 'wishlist' ? '♡' : flag === 'preordered' ? '◷' : '•';
     badge.appendChild(icon);
     badge.append(Array.from(statuses.options).find(option => option.value === flag)?.textContent ?? flag);
     badges.appendChild(badge);
    }
    addCell(row, 2).appendChild(badges);
    const min = item.min_players, max = item.max_players;
    addCell(row, 3).append(min && max ? (min === max ? number.format(min) : number.format(min) + '–' + number.format(max)) : '—');
    addCell(row, 4).append(number.format(item.copies));
    const timestamp = Date.parse(item.updated_at.trim().replace(' ', 'T').replace(/(T[\d:.]+)$/, '$1Z'));
    const time = document.createElement('time');
    if (Number.isFinite(timestamp)) {
     time.dateTime = new Date(timestamp).toISOString();
     time.textContent = date.format(timestamp);
    } else time.textContent = '—';
    addCell(row, 5).appendChild(time);

    const actions = document.createElement('details');
    actions.className = 'admin-r02-actions';
    const trigger = document.createElement('summary');
    trigger.className = 'admin-kit-button';
    trigger.textContent = '⋯';
    trigger.setAttribute('aria-label', t('操作', 'Actions') + ' ' + item.display_name);
    const links = document.createElement('div');
    const edit = '/admin/collection/' + item.id;
    for (const [label, path, query] of [
     [t('編輯', 'Edit'), edit, ''],
     [t('副本', 'Copies'), edit + '/copies', ''],
     [t('實體組件', 'Physical components'), edit + '/components', ''],
     [t('卡套需求', 'Sleeve requirements'), '/admin/sleeves/requirements', 'collection=' + item.id],
     [t('採購紀錄', 'Purchase records'), '/admin/purchases', 'collection=' + item.id],
    ]) {
     const link = document.createElement('a');
     link.href = path + '?' + actionParams + (query ? '&' + query : '');
     link.textContent = label;
     links.appendChild(link);
    }
    actions.addEventListener('keydown', event => {
     if (event.key !== 'Escape' || !actions.open) return;
     event.preventDefault();
     event.stopPropagation();
     actions.open = false;
     trigger.focus();
    });
    actions.appendChild(trigger);
    actions.appendChild(links);
    addCell(row, 6).appendChild(actions);
   }
  }
  results.hidden = data.total === 0;
  empty.hidden = data.total !== 0;
  pagination.hidden = !data.total;
  if (!data.total) return;

  const last = Math.ceil(data.total / data.limit);
  const firstItem = (data.page - 1) * data.limit + 1;
  const lastItem = Math.min(data.page * data.limit, data.total);
  const range = number.format(firstItem) + '–' + number.format(lastItem);
  const total = number.format(data.total);
  find('[data-r02-range]').textContent = t('顯示 ' + range + ' 筆，共 ' + total + ' 筆', 'Showing ' + range + ' of ' + total);
  pages.replaceChildren();
  function pageLink(page: number, label: string, accessibleLabel = label, current = false) {
   const link = document.createElement('a');
   link.className = 'admin-kit-button';
   link.href = target({page: String(page)});
   link.textContent = label;
   link.setAttribute('aria-label', accessibleLabel);
   if (current) link.setAttribute('aria-current', 'page');
   pages.appendChild(link);
  }
  if (data.page > 1) {
   pageLink(1, '«', t('首頁', 'First page'));
   pageLink(data.page - 1, '‹', t('上一頁', 'Previous page'));
  }
  const visible = new Set([1, last, data.page - 1, data.page, data.page + 1].filter(n => n >= 1 && n <= last));
  let previous = 0;
  for (const page of Array.from(visible).sort((a, b) => a - b)) {
   if (page - previous > 1) pages.append('…');
   pageLink(page, number.format(page), t('第 ' + page + ' 頁', 'Page ' + page), page === data.page);
   previous = page;
  }
  if (data.page < last) {
   pageLink(data.page + 1, '›', t('下一頁', 'Next page'));
   pageLink(last, '»', t('末頁', 'Last page'));
  }
 }

 async function load() {
  const params = new URLSearchParams();
  params.set('page', url.searchParams.get('page') ?? '1');
  params.set('tab', tab);
  for (const field of controls) {
   if (field.value.trim()) params.set(field.name, field.value.trim());
  }
  error.hidden = empty.hidden = true;
  results.hidden = false;
  results.setAttribute('aria-busy', 'true');
  status.textContent = t('載入中…', 'Loading…');
  try {
   const response = await fetch('/api/admin/collection?' + params, {signal: AbortSignal.timeout(12000)});
   const json = await response.json() as {data?: NumberedCollectionList};
   if (!response.ok || !json.data) throw new Error('Collection response unavailable');
   for (const link of tabs) {
    const value = json.data.counts?.[link.dataset.tab as keyof NonNullable<NumberedCollectionList['counts']>];
    const count = link.querySelector('[data-count]')!;
    if (value !== undefined) count.textContent = number.format(value);
    else {
     const dash = document.createElement('span');
     dash.setAttribute('aria-hidden', 'true');
     dash.textContent = '—';
     const description = document.createElement('span');
     description.className = 'admin-kit-sr';
     description.textContent = t('無法取得', 'Unavailable');
     count.replaceChildren(dash, description);
    }
   }
   if (!json.data.list) throw new Error('Collection list unavailable');
   if (json.data.list.page !== Number(params.get('page'))) {
    url.searchParams.set('page', String(json.data.list.page));
    history.replaceState(history.state, '', url);
   }
   render(json.data.list);
   status.textContent = '';
  } catch {
   results.hidden = true;
   status.textContent = '';
   error.hidden = false;
  } finally {
   results.removeAttribute('aria-busy');
  }
 }

 function applyFilters() {
  const changes: Record<string, string | null> = {page: '1'};
  for (const field of controls) changes[field.name] = field.value.trim();
  location.assign(target(changes));
 }

 form.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
 form.addEventListener('change', event => { if (event.target instanceof HTMLSelectElement) applyFilters(); });
 error.querySelector('a')?.addEventListener('click', event => { event.preventDefault(); void load(); });
 void load();
}

export function initializeCollectionAdmin(root:HTMLElement){
 if(root.dataset.mode==='list'){initializeCollectionList(root);return;}
 const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh;
 let mode=root.dataset.mode!,id=root.dataset.id??'',scope=new URL(location.href).searchParams.get('scope')==='test'?'test':'production',revision=0,collectionArchived=false,selected:GameRef|null=null,busy=false,dirty=false;
 let key=crypto.randomUUID(),lastBody='';
 const find=<T>(s:string)=>root.querySelector(s) as unknown as T|null;
 const status=find<HTMLElement>('[data-admin-status]')!,reload=find<HTMLButtonElement>('[data-admin-reload]')!,scopeSelect=find<HTMLSelectElement>('[data-scope]')!,form=find<HTMLFormElement>('[data-collection-form]');
 scopeSelect.value=scope;
 root.querySelectorAll<HTMLAnchorElement>('nav a[href^="/admin/collection"]').forEach(a=>{const url=new URL(a.href);url.searchParams.set('scope',scope);a.href=url.href;});
 if(mode==='relations')scopeSelect.closest('label')!.hidden=true;
 const field=(key:string)=>form?.elements.namedItem(key) as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|null;
 const message=(text:string)=>{status.textContent=text;status.dataset.tone='info';};
 const path=(suffix='')=>`/api/admin/collection${suffix}?scope=${scope}`;
 async function api(url:string,method='GET',body?:unknown){const response=await fetch(url,{method,headers:{'Content-Type':'application/json','X-NotBGG-Request':'1',...(method==='POST'&&url===path()?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});let json;try{json=await response.json() as {data:unknown;error?:{code:string}};}catch{throw new Error(t('服務暫時無法使用','Service unavailable'));}if(!response.ok){if(response.status===409)reload.hidden=false;throw new Error(`${response.status} · ${json.error?.code??'SERVICE_UNAVAILABLE'}`);}return json.data as any;}
 function node(tag:string,text:string){const el=document.createElement(tag);el.textContent=text;return el;}
 const editHref=(n:number)=>`/admin/collection/${n}?scope=${scope}&lang=${en?'en':'zh-TW'}`;
 async function load(){
  reload.hidden=true;
  if(mode==='relations'){const rows=await api(`/api/admin/notbgg/${encodeURIComponent(id)}/relations`);const list=find<HTMLElement>('[data-relation-list]')!;list.replaceChildren();for(const r of rows){const row=node('div',`${r.relation_type} · ${r.primary_name} · ${r.target_archived?t('目標已封存','Target archived'):''} · ${r.archived_at?t('關聯已封存','Relation archived'):''}`);row.className='record';if(!r.archived_at){const b=node('button',t('封存關聯','Archive relation')) as HTMLButtonElement;b.type='button';b.onclick=()=>void run(async()=>{if(confirm(t('封存此關聯？保留歷史。','Archive this edge? History is retained.'))){await api(`/api/admin/notbgg/${encodeURIComponent(id)}/relations/${r.id}`,'POST',{});await load();}});row.appendChild(b);}list.appendChild(row);}return;}
  if(mode!=='edit')return;
  const detail=await api(path('/'+id)),r=detail.item;revision=r.revision;collectionArchived=!!r.archived_at;
  find<HTMLElement>('[data-collection-heading]')!.textContent = t('編輯收藏','Edit collection');
  const componentsLink = find<HTMLAnchorElement>('[data-physical-components-link]');
  if (componentsLink) {
   componentsLink.href = `/admin/collection/${encodeURIComponent(id)}/components?scope=${scope}&lang=${en?'en':'zh-TW'}`;
   find<HTMLElement>('[data-physical-components-entry]')!.hidden = false;
  }
  const copiesLink = find<HTMLAnchorElement>('[data-copies-link]');
  if (copiesLink) {
   copiesLink.href = `/admin/collection/${encodeURIComponent(id)}/copies?scope=${scope}&lang=${en?'en':'zh-TW'}`;
   find<HTMLElement>('[data-copies-entry]')!.hidden = false;
  }
  find<HTMLElement>('[data-system]')!.textContent=`Collection #${r.id} · game_id ${r.game_id??'—'} · Revision ${revision} ${!r.resolved_game?t('遊戲引用缺失；收藏仍保留','Game reference missing; collection retained'):''} ${r.source_archived?t('遊戲已封存；收藏與副本仍保留','Game archived; collection and copies retained'):''} ${r.archived_at?t('收藏已封存','Collection archived'):''}`;
  let notes:any={};try{notes=JSON.parse(r.notes??'{}');}catch{/* legacy text stays in storage */}
  const copy=detail.copies.find((c:any)=>c.id===r.managed_copy_id),order=detail.purchases.find((o:any)=>o.id===r.managed_order_id);
  const values={displayName:r.display_name,acquisitionStatus:r.acquisition_status,personalRating:notes.personal_rating,playCount:notes.play_count,comment:notes.personal_comment,storageNotes:notes.storage_notes,sleeveNotes:notes.sleeve_notes,accessoryNotes:notes.accessory_notes,language:copy?.language_code,edition:copy?.edition,purchaseDate:order?.ordered_at??notes.purchase_date_hint,priceMinor:order?.unit_price_minor,currency:order?.currency_code??notes.purchase_currency_hint??'TWD',merchant:order?.merchant_name??notes.purchase_source_hint};
  for(const [name,value]of Object.entries(values)){const el=field(name);if(el)el.value=String(value??'');}
  (field('wishlist') as HTMLInputElement).checked=!!r.wishlist;(field('createCopy') as HTMLInputElement).checked=!!copy;field('createCopy')!.disabled=!!copy;
  find<HTMLElement>('[data-copy-create-label]')!.textContent = copy
   ? t('編輯原有副本的語言與版本（其他副本請至副本管理）','Edit the original copy language and edition (manage other copies separately)')
   : detail.copies.length ? t('另外建立一份副本（既有副本請至副本管理）','Create another copy (manage existing copies separately)')
   : t('建立一份實體副本','Create a physical copy');
  find<HTMLElement>('[data-game-picker]')!.hidden=true;find<HTMLElement>('[data-copy-summary]')!.textContent=JSON.stringify({copies:detail.copies,purchases:detail.purchases,sleeves:detail.sleeves},null,2);
  const archive=find<HTMLButtonElement>('[data-archive]')!;archive.hidden=!!r.archived_at;find<HTMLButtonElement>('[data-save]')!.disabled=!!r.archived_at;
  dirty=false;
 }
 async function run(action:()=>Promise<void>){if(busy)return;busy=true;root.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b=>b.disabled=true);message(t('處理中…','Working…'));try{await action();}catch(e){message(e instanceof Error?e.message:t('操作失敗','Operation failed'));status.dataset.tone='error';status.focus();}finally{busy=false;root.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b=>b.disabled=collectionArchived);}}
 form?.addEventListener('input',()=>dirty=true);
 form?.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
  const data:Record<string,unknown>={};for(const name of ['displayName','acquisitionStatus','currency'])data[name]=field(name)!.value;
  for(const name of ['personalRating','playCount','priceMinor'])data[name]=field(name)!.value===''?null:Number(field(name)!.value);
  for(const name of ['comment','storageNotes','sleeveNotes','accessoryNotes','language','edition','purchaseDate','merchant'])data[name]=field(name)!.value||null;
  data.wishlist=(field('wishlist') as HTMLInputElement).checked;
  if(mode==='new'){if(!selected)throw new Error(t('請選擇既有遊戲','Choose an existing game'));const body={ref:selected,data,createCopy:(field('createCopy') as HTMLInputElement).checked};const serialized=JSON.stringify(body);if(lastBody&&lastBody!==serialized)key=crypto.randomUUID();lastBody=serialized;const result=await api(path(),'POST',body);id=String(result.collectionId);mode='edit';history.replaceState(history.state,'',editHref(result.collectionId));}
  else await api(path('/'+id),'PATCH',{expectedRevision:revision,data,createCopy:(field('createCopy') as HTMLInputElement).checked});dirty=false;if(refreshDetailHeader(t('已儲存收藏 #','Saved collection #')+id))return;await load();message(t('已儲存收藏 #','Saved collection #')+id);
 });});
 find<HTMLButtonElement>('[data-archive]')?.addEventListener('click',()=>void run(async()=>{if(!confirm(t('封存收藏？不刪除遊戲、實體副本、購買資料或歷史。','Archive collection? Game, physical copies, purchases and history are retained.')))return;await api(path('/'+id+'/archive'),'POST',{expectedRevision:revision});if(refreshDetailHeader(t('已封存','Archived')))return;await load();message(t('已封存','Archived'));}));
 find<HTMLFormElement>('[data-picker-form]')?.addEventListener('submit',event=>{event.preventDefault();void run(search);});
 async function search(){const q=(find<HTMLInputElement>('[data-picker-form] [name=q]')!).value,rows=await api(path('/search')+'&q='+encodeURIComponent(q)),list=find<HTMLElement>('[data-game-results]')!;list.replaceChildren();for(const r of rows){const b=node('button',`${r.name} · ${r.type} · ${gameCatalogKey(r.ref)}`) as HTMLButtonElement;b.type='button';b.onclick=()=>{selected=r.ref;field('displayName')!.value=r.name;message(t('已選擇 ','Selected ')+gameCatalogKey(r.ref));};list.appendChild(b);}if(!rows.length)list.textContent=t('找不到可用遊戲','No available game');}
 find<HTMLFormElement>('[data-relation-form]')?.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const f=event.target as HTMLFormElement;await api(`/api/admin/notbgg/${encodeURIComponent(id)}/relations`,'POST',{target:deserializeGameRef((f.elements.namedItem('target') as HTMLInputElement).value.trim()),relationType:(f.elements.namedItem('relationType') as unknown as HTMLSelectElement).value,notes:(f.elements.namedItem('notes') as HTMLTextAreaElement).value||null});await load();message(t('關聯已新增','Relation added'));});});
 reload.onclick=()=>{if(!dirty||confirm(t('放棄未儲存變更並重新載入？','Discard unsaved changes and reload?')))void run(load);};
 scopeSelect.onchange=()=>{if(dirty&&!confirm(t('放棄未儲存變更？','Discard unsaved changes?'))){scopeSelect.value=scope;return;}const url=new URL(location.href);url.searchParams.set('scope',scopeSelect.value);dirty=false;location.assign(url);};
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 void run(async()=>{await load();if(mode==='new'){const game=new URL(location.href).searchParams.get('game');if(game){find<HTMLInputElement>('[data-picker-form] [name=q]')!.value=game;await search();}}message(takeFlash());});
 // The detail header is server rendered; after a successful save or archive the page reloads so the
 // header (status, archive mark, copies) is read fresh, and the result message survives the reload.
 // Only pages that render the header reload; storage failures only lose the message, never the save.
 function refreshDetailHeader(text:string){
  if(mode!=='edit'||!document.querySelector('[data-detail-header]'))return false;
  try{sessionStorage.setItem(flashKey(),text);}catch{/* message is optional */}
  dirty=false;location.reload();return true;
 }
 function flashKey(){return 'collection-detail-flash:'+scope+':'+id;}
 function takeFlash(){
  if(mode!=='edit')return '';
  try{const text=sessionStorage.getItem(flashKey())??'';sessionStorage.removeItem(flashKey());return text;}catch{return '';}
 }
}
