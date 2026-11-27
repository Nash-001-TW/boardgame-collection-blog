export {};
const root=document.querySelector<HTMLElement>('[data-sleeve-workflow]');
if(root){
 const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh,status=root.querySelector<HTMLElement>('[data-workflow-status]')!;
 const saved='sleeve-workflow-saved:'+location.href;
 try{if(sessionStorage.getItem(saved)){status.textContent=t('已儲存。','Saved.');sessionStorage.removeItem(saved);}}catch{}
 const filter=root.querySelector('[data-workflow-filter]') as unknown as (HTMLSelectElement & HTMLElement)|null;
 const filterKey='sleeve-workflow-filter';
 function applyFilter(){
  root!.querySelectorAll<HTMLDetailsElement>('[data-size-group]').forEach(group=>{
   const rows=[...group.querySelectorAll<HTMLElement>('[data-completion]')];
   for(const row of rows)row.hidden=!!filter&&filter.value!=='all'&&row.dataset.completion!==filter.value;
   group.hidden=rows.every(row=>row.hidden);
  });
 }
 if(filter){
  try{const value=localStorage.getItem(filterKey);if(value&&['all','pending','complete'].includes(value))filter.value=value;}catch{}
  filter.addEventListener('change',()=>{try{localStorage.setItem(filterKey,filter.value);}catch{}applyFilter();});
  applyFilter();
 }
 function setDates(){
  const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());
  root!.querySelectorAll<HTMLInputElement>('input[type=date]').forEach(input=>{if(!input.value)input.value=date.toISOString().slice(0,10);});
 }
 setDates();
 function searchSizes(form:HTMLFormElement){
  const query=form.querySelector<HTMLInputElement>('[data-size-search]')?.value.trim().toLowerCase().split(/[\s×x]+/).filter(Boolean)??[];
  form.querySelectorAll<HTMLOptionElement>('option[data-dimensions]').forEach(option=>{
   option.hidden=!query.every(term=>option.dataset.dimensions!.includes(term));
  });
  form.querySelectorAll<HTMLOptGroupElement>('optgroup').forEach(group=>group.hidden=[...group.children].every(option=>(option as HTMLOptionElement).hidden));
 }
 function showComponents(form:HTMLFormElement){
  const show=form.querySelector<HTMLInputElement>('[data-show-all]')?.checked;
  for(const entry of form.querySelectorAll<HTMLElement>('[data-existing=true]')){
   entry.hidden=!show;
   if(entry instanceof HTMLOptionElement){
    if(!show&&entry.selected)(entry.closest('select') as unknown as HTMLSelectElement).value='';
    entry.disabled=!show;
   }else if(!show)entry.querySelector<HTMLInputElement>('[data-batch-select]')!.checked=false;
  }
 }
 function updateBatch(form:HTMLFormElement,defaultQuantities=false){
  const components=form.querySelector<HTMLFieldSetElement>('[data-batch-components]');
  if(!components)return;
  const size=form.querySelector('[name=sizeId]') as unknown as HTMLSelectElement;
  const copy=(form.querySelector('[name=copyId]') as unknown as HTMLSelectElement).value;
  let count=0,total=0,valid=true;
  components.hidden=!size.value;
  for(const row of components.querySelectorAll<HTMLElement>('[data-batch-component]')){
   const selection=row.querySelector<HTMLInputElement>('[data-batch-select]')!;
   const quantity=row.querySelector<HTMLInputElement>('[data-batch-quantity]')!;
   const checked=!components.hidden&&!row.hidden&&selection.checked;
   if(defaultQuantities||!checked||!quantity.dataset.selected){
    const counts=JSON.parse(quantity.dataset.counts??'{}') as Record<string,number>;
    quantity.value=String(counts[copy]??quantity.dataset.expected??'');
   }
   quantity.disabled=!checked;
   quantity.dataset.selected=checked?'1':'';
   if(checked){count++;total+=quantity.valueAsNumber||0;valid&&=quantity.validity.valid;}
  }
  form.querySelector<HTMLOutputElement>('[data-batch-preview]')!.textContent=count
   ?t(`${size.selectedOptions[0].dataset.dimensions} · ${count} 筆 · 共 ${total} 張`,`${size.selectedOptions[0].dataset.dimensions} · ${count} requirements · ${total} sleeves total`):'';
  form.querySelector('button')!.disabled=!count||!valid;
 }
 root.addEventListener('input',event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement)||!input.form)return;
  if(input.matches('[data-size-search]'))searchSizes(input.form);
  if(input.matches('[data-batch-quantity]'))updateBatch(input.form);
 });
 root.addEventListener('change',event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement||input instanceof HTMLSelectElement)||!input.form)return;
  if(input.matches('[data-show-all]'))showComponents(input.form);
  if(input.matches('[data-show-all],[data-batch-select],[name=sizeId],[name=copyId]'))updateBatch(input.form,input.name==='copyId');
 });
 async function refreshRequirements(submitted:HTMLFormElement){
  const response=await fetch(location.href,{cache:'no-store'});
  if(!response.ok)throw new Error('REQUIREMENTS_REFRESH_FAILED');
  const next=new DOMParser().parseFromString(await response.text(),'text/html');
  const currentResults=root!.querySelector('[data-workflow-results]');
  const nextResults=next.querySelector('[data-workflow-results]');
  if(!currentResults||!nextResults)throw new Error('REQUIREMENTS_REFRESH_FAILED');
  for(const selector of ['[data-size-group]','[data-requirement]']){
   const open=new Set([...currentResults.querySelectorAll<HTMLDetailsElement>(selector+'[open]')].map(el=>el.getAttribute(selector)));
   nextResults.querySelectorAll<HTMLDetailsElement>(selector).forEach(el=>el.open=open.has(el.getAttribute(selector)));
  }
  for(const form of root!.querySelectorAll<HTMLFormElement>('.workflow-create form')){
   const replacement=next.querySelector<HTMLFormElement>(`.workflow-create form[data-workflow-action="${form.dataset.workflowAction}"]`);
   if(!replacement)throw new Error('REQUIREMENTS_REFRESH_FAILED');
   if(form===submitted){
    const quantity=form.querySelector<HTMLInputElement>('[name=quantity]');
    if(quantity)quantity.value='0';
    const notes=form.querySelector<HTMLTextAreaElement>('[name=notes]');
    if(notes)notes.value='';
   }
   for(const selector of ['[data-size-options]','[data-component-options]','[data-batch-components]']){
    const current=form.querySelector(selector),updated=replacement.querySelector(selector);
    if(!current||!updated)continue;
    if(current instanceof HTMLSelectElement&&updated instanceof HTMLSelectElement&&!(selector==='[data-component-options]'&&form===submitted))updated.value=current.value;
    if(selector==='[data-batch-components]'&&form!==submitted){
     for(const row of current.querySelectorAll<HTMLElement>('[data-batch-component]')){
      const target=updated.querySelector(`[data-batch-component="${row.dataset.batchComponent}"]`);
      const selected=row.querySelector<HTMLInputElement>('[data-batch-select]')!;
      if(!target||!selected.checked)continue;
      target.querySelector<HTMLInputElement>('[data-batch-select]')!.checked=true;
      const quantity=target.querySelector<HTMLInputElement>('[data-batch-quantity]')!;
      quantity.value=row.querySelector<HTMLInputElement>('[data-batch-quantity]')!.value;
      quantity.dataset.selected='1';
     }
    }
    current.replaceWith(updated);
   }
   showComponents(form);searchSizes(form);updateBatch(form);
  }
  currentResults.replaceWith(nextResults);applyFilter();setDates();
 }
 const pending=new WeakMap<HTMLFormElement,{body:string;key:string}>();
 let saving=false;
 root.addEventListener('submit',async event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement)||!form.dataset.workflowAction)return;event.preventDefault();
  const body:Record<string,unknown>={action:form.dataset.workflowAction},data=new FormData(form);
  for(const [name,value] of data)body[name]=value;
  for(const name of ['id','revision','collectionId','sizeId','quantity','copyId','componentId','productId','lastApplicationId'])if(data.has(name))body[name]=data.get(name)===''?null:Number(data.get(name));
  if(body.action==='requirements-batch'){
   body.items=[...form.querySelectorAll<HTMLElement>('[data-batch-component]')].flatMap(row=>{
    const quantity=row.querySelector<HTMLInputElement>('[data-batch-quantity]')!;
    return quantity.disabled?[]:[{componentId:Number(row.dataset.batchComponent),quantity:quantity.valueAsNumber}];
   });
  }
  const button=form.querySelector('button')!;if(saving||button.disabled)return;
  if(body.action==='apply'){
   if(!confirm(t('確認實際套用並扣除庫存？已記錄的歷史使用不可再次扣帳。','Confirm actual application and stock deduction? Do not deduct previously recorded use again.')))return;
   const option=(form.querySelector('[name=productId]') as unknown as HTMLSelectElement).selectedOptions[0];
   body.productRevision=Number(option?.dataset.revision);body.lastTransactionId=Number(option?.dataset.last);body.confirmed=true;body.notPreviouslyRecorded=data.has('notPreviouslyRecorded');
  }
  const serialized=JSON.stringify(body);let command=pending.get(form);if(command?.body!==serialized){command={body:serialized,key:crypto.randomUUID()};pending.set(form,command);}
  saving=true;button.disabled=true;delete status.dataset.tone;status.textContent=t('儲存中…','Saving…');
  try{
   const response=await fetch('/api/admin/sleeves',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1','Idempotency-Key':command.key},body:serialized});
   const result=await response.json() as {success?:boolean;error?:{code?:string}};
   if(!response.ok||!result.success)throw new Error(result.error?.code);
   if(body.action==='apply'){try{sessionStorage.setItem(saved,'1');}catch{}location.reload();}
   else{
    await refreshRequirements(form);
    pending.delete(form);
    status.textContent=t('已儲存。','Saved.');status.focus();
   }
  }catch(error){
   const code=error instanceof Error?error.message:'';
   status.textContent=code==='REQUIREMENTS_REFRESH_FAILED'?t('已儲存，清單更新失敗。可用相同內容重試更新。','Saved, but the list could not refresh. Retry with the same values to refresh it.')
   :code==='COMPONENT_INELIGIBLE'?t('組件未通過實體卡牌驗證。','Component is not a verified physical card.')
   :code==='SLEEVE_WORKFLOW_STATE_CHANGED'?t('資料已變更、需求已鎖定或庫存不足。請重新載入確認。','Data changed, requirement is locked or stock is insufficient. Reload to review.')
   :t('無法儲存，請檢查欄位、權限與組件證據後重試。','Could not save. Check fields, access and component evidence before retrying.');status.dataset.tone='error';status.focus();
  }finally{saving=false;button.disabled=false;updateBatch(form);}
 });
}
