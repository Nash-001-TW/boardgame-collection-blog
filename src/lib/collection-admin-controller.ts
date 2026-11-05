import { deserializeGameRef,gameCatalogKey,type GameRef } from './game-identity';
export function initializeCollectionAdmin(root:HTMLElement){
 const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh;
 let mode=root.dataset.mode!,id=root.dataset.id??'',scope=new URL(location.href).searchParams.get('scope')==='test'?'test':'production',revision=0,collectionArchived=false,selected:GameRef|null=null,busy=false,dirty=false,after=0;
 let key=crypto.randomUUID(),lastBody='',pages:number[]=[];
 const find=<T>(s:string)=>root.querySelector(s) as unknown as T|null;
 const status=find<HTMLElement>('[data-admin-status]')!,reload=find<HTMLButtonElement>('[data-admin-reload]')!,scopeSelect=find<HTMLSelectElement>('[data-scope]')!,form=find<HTMLFormElement>('[data-collection-form]');
 scopeSelect.value=scope;
 root.querySelectorAll<HTMLAnchorElement>('nav a[href^="/admin/collection"]').forEach(a=>{const url=new URL(a.href);url.searchParams.set('scope',scope);a.href=url.href;});
 if(mode==='relations')scopeSelect.closest('label')!.hidden=true;
 const field=(key:string)=>form?.elements.namedItem(key) as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|null;
 const message=(text:string)=>{status.textContent=text;};
 const path=(suffix='')=>`/api/admin/collection${suffix}?scope=${scope}`;
 async function api(url:string,method='GET',body?:unknown){const response=await fetch(url,{method,headers:{'Content-Type':'application/json','X-NotBGG-Request':'1',...(method==='POST'&&url===path()?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});let json;try{json=await response.json() as {data:unknown;error?:{code:string}};}catch{throw new Error(t('服務暫時無法使用','Service unavailable'));}if(!response.ok){if(response.status===409)reload.hidden=false;throw new Error(`${response.status} · ${json.error?.code??'SERVICE_UNAVAILABLE'}`);}return json.data as any;}
 function node(tag:string,text:string){const el=document.createElement(tag);el.textContent=text;return el;}
 function link(url:string,text:string){const a=document.createElement('a');a.href=url;a.textContent=text;return a;}
 const editHref=(n:number)=>`/admin/collection/${n}?scope=${scope}&lang=${en?'en':'zh-TW'}`;
 async function load(){
  reload.hidden=true;
  if(mode==='list'){const rows=await api(path()+'&after='+after);const list=find<HTMLElement>('[data-admin-list]')!;list.replaceChildren();for(const r of rows){const card=node('div',`${r.id} · ${r.display_name} · ${r.item_type} · ${r.acquisition_status} · ${r.archived_at?t('收藏已封存','Collection archived'):''} ${r.source_archived?t('遊戲已封存','Game archived'):''}`);card.className='record';card.appendChild(link(editHref(r.id),t('編輯','Edit')));list.appendChild(card);}find<HTMLButtonElement>('[data-next]')!.hidden=rows.length<20;find<HTMLButtonElement>('[data-previous]')!.hidden=!pages.length;root.dataset.next=String(rows.at(-1)?.id??after);return;}
  if(mode==='relations'){const rows=await api(`/api/admin/notbgg/${encodeURIComponent(id)}/relations`);const list=find<HTMLElement>('[data-relation-list]')!;list.replaceChildren();for(const r of rows){const row=node('div',`${r.relation_type} · ${r.primary_name} · ${r.target_archived?t('目標已封存','Target archived'):''} · ${r.archived_at?t('關聯已封存','Relation archived'):''}`);row.className='record';if(!r.archived_at){const b=node('button',t('封存關聯','Archive relation')) as HTMLButtonElement;b.type='button';b.onclick=()=>void run(async()=>{if(confirm(t('封存此關聯？保留歷史。','Archive this edge? History is retained.'))){await api(`/api/admin/notbgg/${encodeURIComponent(id)}/relations/${r.id}`,'POST',{});await load();}});row.appendChild(b);}list.appendChild(row);}return;}
  if(mode!=='edit')return;
  const detail=await api(path('/'+id)),r=detail.item;revision=r.revision;collectionArchived=!!r.archived_at;
  find<HTMLElement>('[data-system]')!.textContent=`Collection #${r.id} · game_id ${r.game_id??'—'} · Revision ${revision} ${!r.resolved_game?t('遊戲引用缺失；收藏仍保留','Game reference missing; collection retained'):''} ${r.source_archived?t('遊戲已封存；收藏與副本仍保留','Game archived; collection and copies retained'):''} ${r.archived_at?t('收藏已封存','Collection archived'):''}`;
  let notes:any={};try{notes=JSON.parse(r.notes??'{}');}catch{/* legacy text stays in storage */}
  const copy=detail.copies.find((c:any)=>c.id===r.managed_copy_id),order=detail.purchases.find((o:any)=>o.id===r.managed_order_id);
  const values={displayName:r.display_name,acquisitionStatus:r.acquisition_status,personalRating:notes.personal_rating,playCount:notes.play_count,comment:notes.personal_comment,storageNotes:notes.storage_notes,sleeveNotes:notes.sleeve_notes,accessoryNotes:notes.accessory_notes,language:copy?.language_code,edition:copy?.edition,purchaseDate:order?.ordered_at??notes.purchase_date_hint,priceMinor:order?.unit_price_minor,currency:order?.currency_code??notes.purchase_currency_hint??'TWD',merchant:order?.merchant_name??notes.purchase_source_hint};
  for(const [name,value]of Object.entries(values)){const el=field(name);if(el)el.value=String(value??'');}
  (field('wishlist') as HTMLInputElement).checked=!!r.wishlist;(field('createCopy') as HTMLInputElement).checked=!!copy;field('createCopy')!.disabled=!!copy;
  find<HTMLElement>('[data-game-picker]')!.hidden=true;find<HTMLElement>('[data-copy-summary]')!.textContent=JSON.stringify({copies:detail.copies,purchases:detail.purchases,sleeves:detail.sleeves},null,2);
  const archive=find<HTMLButtonElement>('[data-archive]')!;archive.hidden=!!r.archived_at;find<HTMLButtonElement>('[data-save]')!.disabled=!!r.archived_at;
  dirty=false;
 }
 async function run(action:()=>Promise<void>){if(busy)return;busy=true;root.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b=>b.disabled=true);message(t('處理中…','Working…'));try{await action();}catch(e){message(e instanceof Error?e.message:t('操作失敗','Operation failed'));}finally{busy=false;root.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b=>b.disabled=collectionArchived);}}
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
 find<HTMLButtonElement>('[data-next]')?.addEventListener('click',()=>{pages.push(after);after=Number(root.dataset.next);void run(load);});find<HTMLButtonElement>('[data-previous]')?.addEventListener('click',()=>{after=pages.pop()??0;void run(load);});
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 void run(async()=>{await load();if(mode==='new'){const game=new URL(location.href).searchParams.get('game');if(game){find<HTMLInputElement>('[data-picker-form] [name=q]')!.value=game;await search();}}message('');});
}
