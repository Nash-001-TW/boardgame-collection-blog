import type {PublicLiveRelation} from './public-live-relations';
function initialize(){document.querySelectorAll<HTMLElement>('[data-live-relations]').forEach(root=>{
 if(root.dataset.ready)return;root.dataset.ready='true';const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh,body=root.querySelector<HTMLElement>('[data-live-relation-body]')!,retry=root.querySelector<HTMLButtonElement>('button')!;
 let busy=false;
 async function load(){if(busy)return;busy=true;retry.hidden=true;try{
  const r=await fetch('/api/public/relations/'+encodeURIComponent(root.dataset.key!)+'?lang='+root.dataset.lang,{cache:'no-store'}),result=await r.json() as {success?:boolean;data?:{relations:PublicLiveRelation[]}};
  if(!r.ok||!result.success||!result.data)throw new Error('unavailable');body.replaceChildren();
  if(!result.data.relations.length)body.textContent=t('尚無可公開的可靠關聯。','No reliable public relations recorded.');
  const labels={base:t('主遊戲','Base game'),expansion:t('擴充','Expansion'),related:t('相關遊戲','Related game'),unconfirmed:t('方向待確認','Direction unconfirmed')};
  const kinds:Record<string,string>={expansions:t('BGG 擴充關聯','BGG expansion link'),implementations:t('重新實作關聯','Implementation link'),compilations:t('合輯關聯','Compilation link'),requires_base:t('需要主遊戲','Requires base'),expansion_of:t('擴充關聯','Expansion of'),standalone_related:t('獨立遊戲相關','Standalone related'),same_series:t('同系列','Same series'),integrates_with:t('可整合遊玩','Integrates with'),compilation_of:t('合輯內容','Compilation of'),accessory_for:t('適用配件','Accessory for'),compatible_with:t('相容','Compatible with'),other:t('其他關聯','Other relation')};
  const list=document.createElement('ul');for(const row of result.data.relations){const li=document.createElement('li'),a=document.createElement('a');a.textContent=row.name;a.href=row.href;
   li.appendChild(a);li.appendChild(document.createTextNode(' · '+(row.source==='bgg'?'BGG':t('管理員','Admin'))+' · '+labels[row.role]+' · '+(kinds[row.kind]??t('相關遊戲','Related game'))+(row.owned?' · '+t('已收藏','Owned'):'')));list.appendChild(li);}body.appendChild(list);
 }catch{body.textContent=t('關聯資料查詢失敗，請稍後重試。','Relations could not be loaded. Please retry.');retry.hidden=false;}finally{busy=false;}}
 retry.addEventListener('click',()=>void load());void load();
});}
initialize();document.addEventListener('astro:page-load',initialize);
