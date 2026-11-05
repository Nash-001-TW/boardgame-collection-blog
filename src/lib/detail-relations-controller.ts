import type { RelationDisplayItem } from './relation-display';
import { relationKinds } from './game-content';
export interface RelationViewState {
 path: string; query: string; kind: string; limit: number; listY: number; pageY: number;
}
/** Untrusted history entries cannot request arbitrary batches or another page's state. */
export function readRelationViewState(value: unknown, path: string, total: number): RelationViewState | null {
 if(!value||typeof value!=='object'||!('path' in value)||value.path!==path
  ||!('query' in value)||typeof value.query!=='string'||value.query.length>1000
  ||!('kind' in value)||typeof value.kind!=='string'||!['all',...relationKinds].includes(value.kind)
  ||!('limit' in value)||typeof value.limit!=='number'||!Number.isSafeInteger(value.limit)||value.limit<20
  ||!('listY' in value)||typeof value.listY!=='number'||!Number.isFinite(value.listY)||value.listY<0
  ||!('pageY' in value)||typeof value.pageY!=='number'||!Number.isFinite(value.pageY)||value.pageY<0)return null;
 return {path,query:value.query,kind:value.kind,limit:Math.min(value.limit,Math.max(20,total)),listY:value.listY,pageY:value.pageY};
}
/** #ID is exact; ordinary text keeps the existing substring-name search. */
export function matchesRelationQuery(row: Pick<RelationDisplayItem,'id'|'name'>, query: string): boolean {
 const q=query.trim().toLocaleLowerCase();
 if(/^#\d+$/.test(q))return String(row.id)===q.slice(1);
 return String(row.id)===q||row.name.toLocaleLowerCase().includes(q);
}
export function initializeDetailRelations(root:HTMLElement){
 const data=root.querySelector('[data-relations-payload]');if(!data||root.dataset.ready)return;root.dataset.ready='true';
 const {rows}=JSON.parse(data.textContent!) as {rows:RelationDisplayItem[];labels:Record<string,string>};data.remove();
 const input=root.querySelector<HTMLInputElement>('[data-relation-search]')!,list=root.querySelector<HTMLElement>('[data-relation-list]')!,more=root.querySelector<HTMLButtonElement>('[data-relation-more]')!;
 const zh=document.documentElement.lang!=='en';let kind='all',limit=20;
 let restored:RelationViewState|null=null;
 try{restored=readRelationViewState(history.state?.detailRelations,location.pathname,rows.length);}catch{/* History unavailable: normal browsing remains usable. */}
 function save(){
  try{history.replaceState({...history.state,detailRelations:{path:location.pathname,query:input.value,kind,limit,listY:list.scrollTop,pageY:scrollY}},'');}catch{/* Optional navigation restoration must not block relations. */}
 }
 function selectKind(){root.querySelectorAll<HTMLButtonElement>('[data-relation-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.relationFilter===kind)));}
 function bindImageFallbacks(){
  list.querySelectorAll('img').forEach(image=>{
   if(image.dataset.fallbackBound)return;image.dataset.fallbackBound='true';
   const failed=()=>{const blank=document.createElement('span');blank.className='relation-placeholder';blank.textContent='◇';blank.setAttribute('aria-hidden','true');image.replaceWith(blank);};
   image.addEventListener('error',failed,{once:true});
   if(image.complete&&image.naturalWidth===0)failed();
  });
 }
 function render(appendOnly=false){
  const matches=rows.filter(r=>(kind==='all'||r.kinds.some(k=>k===kind))&&matchesRelationQuery(r,input.value));
  const fragment=document.createDocumentFragment();
  for(const r of matches.slice(appendOnly?list.children.length:0,limit)){
   const li=document.createElement('li');li.dataset.relationId=String(r.id);const a=document.createElement('a');a.href=r.href;if(!r.internal){a.target='_blank';a.rel='noopener noreferrer';}
   const image=r.image?document.createElement('img'):document.createElement('span');if(image instanceof HTMLImageElement){image.src=r.image;image.alt='';image.loading='lazy';image.decoding='async';image.width=42;image.height=55;}else{image.className='relation-placeholder';image.textContent='◇';image.setAttribute('aria-hidden','true');}
   const copy=document.createElement('span'),name=document.createElement('strong'),identity=document.createElement('span'),type=document.createElement('small'),icon=document.createElement('span');name.textContent=r.name;identity.className='relation-id';identity.textContent=`BGG #${r.id}`;type.textContent=r.roleLabels.join(' · ');copy.appendChild(name);copy.appendChild(identity);copy.appendChild(type);icon.textContent=r.internal?'→':'↗';a.appendChild(image);a.appendChild(copy);a.appendChild(icon);
   li.appendChild(a);fragment.appendChild(li);
  }
  if(appendOnly)list.appendChild(fragment);else list.replaceChildren(fragment);bindImageFallbacks();more.hidden=limit>=matches.length;const count=root.querySelector<HTMLElement>('[data-relation-count]')!;count.textContent=zh?`已顯示 ${Math.min(limit,matches.length)} / ${matches.length}`:`Showing ${Math.min(limit,matches.length)} / ${matches.length}`;
  const empty=root.querySelector<HTMLElement>('[data-relation-empty]');if(empty)empty.hidden=matches.length>0;
  if(more.hidden&&document.activeElement===more)count.focus();
 }
 if(restored&&Array.from(root.querySelectorAll<HTMLButtonElement>('[data-relation-filter]')).some(button=>button.dataset.relationFilter===restored.kind)){
  input.value=restored.query;kind=restored.kind;limit=restored.limit;selectKind();render();
  const view=restored;
  requestAnimationFrame(()=>{list.scrollTop=view.listY;window.scrollTo({top:view.pageY,behavior:'instant'});});
 }else{bindImageFallbacks();}
 input.addEventListener('input',()=>{limit=20;render();list.scrollTop=0;save();});
 root.querySelectorAll<HTMLButtonElement>('[data-relation-filter]').forEach(button=>button.addEventListener('click',()=>{kind=button.dataset.relationFilter!;limit=20;selectKind();render();list.scrollTop=0;save();}));
 more.addEventListener('click',()=>{const top=list.scrollTop;limit+=20;render(true);list.scrollTop=top;save();});
 window.addEventListener('pagehide',save);
}
