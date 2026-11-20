import { deserializeGameRef,gameCatalogKey,type GameRef } from './game-identity';
import type { CollectionListPage } from './collection-v2-management';

function initializeCollectionList(root: HTMLElement) {
 const en = root.dataset.lang === 'en';
 const t = (zh: string, english: string) => en ? english : zh;
 const form = root.querySelector<HTMLFormElement>('[data-list-filters]')!;
 const scope = root.querySelector('select[data-scope]') as unknown as HTMLSelectElement;
 const list = root.querySelector<HTMLElement>('[data-admin-list]')!;
 const status = root.querySelector<HTMLElement>('[data-admin-status]')!;
 const previous = root.querySelector<HTMLButtonElement>('[data-previous]')!;
 const next = root.querySelector<HTMLButtonElement>('[data-next]')!;
 const fields = form.querySelectorAll('input, select, button') as unknown as Iterable<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>;
 const controls = [scope, ...fields, previous, next];
 const url = new URL(location.href);
 scope.value = url.searchParams.get('scope') === 'test' ? 'test' : 'production';
 for (const name of ['q', 'view', 'source', 'status', 'archive', 'wishlist']) {
  const input = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  if (input && url.searchParams.has(name)) input.value = url.searchParams.get(name)!;
 }
 let filters = new URLSearchParams();
 let cursor = 0;
 let previousCursors: number[] = [];
 let nextCursor: number | null = null;
 let busy = false;

 function render(page: CollectionListPage) {
  const grouped = filters.get('view') === 'grouped';
  list.replaceChildren();
  for (const group of page.groups) {
   const card = document.createElement(grouped ? 'details' : 'div');
   card.className = 'record';
   card.dataset.collectionGroup = group.key;
   const label = document.createElement(grouped ? 'summary' : 'p');
   const identity = group.source_id ?? t('缺少來源身份', 'Missing source identity');
   const linkStatus = group.link_status === 'pending'
    ? t('候選連結', 'Candidate link')
    : group.link_status === 'linked' ? t('已確認連結', 'Confirmed link') : null;
   label.textContent = [
    grouped ? group.game_name : null,
    identity,
    group.source_archived ? t('來源遊戲已封存', 'Source game archived') : null,
    linkStatus && `${linkStatus}: ${group.linked_source_id}`,
    group.primary_source && `${t('主來源', 'Primary source')}: ${group.primary_source === 'bgg' ? 'BGG' : 'NotBGG'}`,
    grouped ? t(`${group.items.length} 筆收藏`, `${group.items.length} collection records`) : null,
   ].filter(Boolean).join(' · ');
   card.appendChild(label);
   const members = document.createElement(grouped ? 'ul' : 'div');
   for (const item of group.items) {
    const row = document.createElement(grouped ? 'li' : 'div');
    row.dataset.collectionId = String(item.id);
    row.textContent = [`#${item.id}`, item.display_name, item.item_type, item.acquisition_status,
     item.wishlist === 1 ? t('願望清單','Wishlist') : null,
     item.archived_at ? t('收藏已封存', 'Collection archived') : null].filter(Boolean).join(' · ') + ' ';
    const edit = document.createElement('a');
    edit.href = `/admin/collection/${item.id}?scope=${filters.get('scope')}&lang=${en ? 'en' : 'zh-TW'}`;
    edit.textContent = t('編輯', 'Edit');
    row.appendChild(edit);
    members.appendChild(row);
   }
   card.appendChild(members);
   list.appendChild(card);
  }
 }

 async function load(after: number, back: number[], query = filters) {
  if (busy) return;
  busy = true;
  controls.forEach(control => control.disabled = true);
  status.textContent = t('處理中…', 'Working…'); status.dataset.tone = 'info';
  try {
   const params = new URLSearchParams(query);
   params.set('after', String(after));
   const response = await fetch(`/api/admin/collection?${params}`);
   const result = await response.json() as {data?: CollectionListPage; error?: {code: string}};
   if (!response.ok || !result.data) throw new Error(result.error?.code ?? String(response.status));
   filters = query;
   render(result.data);
   cursor = after;
   previousCursors = back;
   nextCursor = result.data.nextCursor;
   status.textContent = result.data.groups.length ? '' : t('找不到符合條件的收藏', 'No matching collection records');
  } catch {
   if (query !== filters) {
    list.replaceChildren();
    previousCursors = [];
    nextCursor = null;
   }
   status.textContent = t('無法載入收藏列表，請重試。', 'Could not load the collection list. Try again.'); status.dataset.tone = 'error';
  } finally {
   previous.hidden = !previousCursors.length;
   next.hidden = nextCursor === null;
   controls.forEach(control => control.disabled = false);
   busy = false;
  }
 }

 function applyFilters() {
  if (busy) return;
  const query = new URLSearchParams({scope: scope.value});
  for (const [name, value] of new FormData(form)) {
   if (typeof value === 'string' && value.trim()) query.set(name, value.trim());
  }
  for (const name of ['scope', 'q', 'view', 'source', 'status', 'archive', 'wishlist']) {
   const value = query.get(name);
   if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
  }
  history.replaceState(history.state, '', url);
  root.querySelectorAll<HTMLAnchorElement>('nav a[href^="/admin/collection"]').forEach(anchor => {
   const target = new URL(anchor.href);
   target.searchParams.set('scope', scope.value);
   anchor.href = target.href;
  });
  void load(0, [], query);
 }

 form.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
 form.querySelectorAll('select').forEach(select => select.addEventListener('change', applyFilters));
 scope.addEventListener('change', applyFilters);
 next.addEventListener('click', () => {
  if (nextCursor !== null) void load(nextCursor, [...previousCursors, cursor]);
 });
 previous.addEventListener('click', () => {
  const after = previousCursors.at(-1);
  if (after !== undefined) void load(after, previousCursors.slice(0, -1));
 });
 applyFilters();
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
   componentsLink.href = `/admin/collection/components/manage?collection=${encodeURIComponent(id)}&lang=${en?'en':'zh-TW'}`;
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
  else await api(path('/'+id),'PATCH',{expectedRevision:revision,data,createCopy:(field('createCopy') as HTMLInputElement).checked});dirty=false;await load();message(t('已儲存收藏 #','Saved collection #')+id);
 });});
 find<HTMLButtonElement>('[data-archive]')?.addEventListener('click',()=>void run(async()=>{if(!confirm(t('封存收藏？不刪除遊戲、實體副本、購買資料或歷史。','Archive collection? Game, physical copies, purchases and history are retained.')))return;await api(path('/'+id+'/archive'),'POST',{expectedRevision:revision});await load();message(t('已封存','Archived'));}));
 find<HTMLFormElement>('[data-picker-form]')?.addEventListener('submit',event=>{event.preventDefault();void run(search);});
 async function search(){const q=(find<HTMLInputElement>('[data-picker-form] [name=q]')!).value,rows=await api(path('/search')+'&q='+encodeURIComponent(q)),list=find<HTMLElement>('[data-game-results]')!;list.replaceChildren();for(const r of rows){const b=node('button',`${r.name} · ${r.type} · ${gameCatalogKey(r.ref)}`) as HTMLButtonElement;b.type='button';b.onclick=()=>{selected=r.ref;field('displayName')!.value=r.name;message(t('已選擇 ','Selected ')+gameCatalogKey(r.ref));};list.appendChild(b);}if(!rows.length)list.textContent=t('找不到可用遊戲','No available game');}
 find<HTMLFormElement>('[data-relation-form]')?.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const f=event.target as HTMLFormElement;await api(`/api/admin/notbgg/${encodeURIComponent(id)}/relations`,'POST',{target:deserializeGameRef((f.elements.namedItem('target') as HTMLInputElement).value.trim()),relationType:(f.elements.namedItem('relationType') as unknown as HTMLSelectElement).value,notes:(f.elements.namedItem('notes') as HTMLTextAreaElement).value||null});await load();message(t('關聯已新增','Relation added'));});});
 reload.onclick=()=>{if(!dirty||confirm(t('放棄未儲存變更並重新載入？','Discard unsaved changes and reload?')))void run(load);};
 scopeSelect.onchange=()=>{if(dirty&&!confirm(t('放棄未儲存變更？','Discard unsaved changes?'))){scopeSelect.value=scope;return;}const url=new URL(location.href);url.searchParams.set('scope',scopeSelect.value);dirty=false;location.assign(url);};
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 void run(async()=>{await load();if(mode==='new'){const game=new URL(location.href).searchParams.get('game');if(game){find<HTMLInputElement>('[data-picker-form] [name=q]')!.value=game;await search();}}message('');});
}
