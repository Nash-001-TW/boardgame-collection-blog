export {};
const root=document.querySelector<HTMLElement>('[data-sleeve-workflow]');
if(root){
 const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh,status=root.querySelector<HTMLElement>('[data-workflow-status]')!;
 const saved='sleeve-workflow-saved:'+location.href;
 try{if(sessionStorage.getItem(saved)){status.textContent=t('已儲存。','Saved.');sessionStorage.removeItem(saved);}}catch{}
 root.querySelectorAll<HTMLInputElement>('input[type=date]').forEach(input=>{const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());input.value=date.toISOString().slice(0,10);});
 (root.querySelector('[data-assignment-filter]') as HTMLSelectElement|null)?.addEventListener('change',event=>{
  const filter=(event.target as HTMLSelectElement).value;
  root.querySelectorAll<HTMLElement>('[data-assigned]').forEach(el=>el.hidden=filter!=='all'&&el.dataset.assigned!==filter);
 });
 const pending=new WeakMap<HTMLFormElement,{body:string;key:string}>();
 root.addEventListener('submit',async event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement)||!form.dataset.workflowAction)return;event.preventDefault();
  const body:Record<string,unknown>={action:form.dataset.workflowAction},data=new FormData(form);
  for(const [name,value] of data)body[name]=value;
  for(const name of ['id','revision','collectionId','sizeId','quantity','copyId','componentId','productId','lastApplicationId'])if(data.has(name))body[name]=data.get(name)===''?null:Number(data.get(name));
  if(body.action==='apply'){
   if(!confirm(t('確認實際套用並扣除庫存？已記錄的歷史使用不可再次扣帳。','Confirm actual application and stock deduction? Do not deduct previously recorded use again.')))return;
   const option=(form.querySelector('[name=productId]') as unknown as HTMLSelectElement).selectedOptions[0];
   body.productRevision=Number(option?.dataset.revision);body.lastTransactionId=Number(option?.dataset.last);body.confirmed=true;body.notPreviouslyRecorded=data.has('notPreviouslyRecorded');
  }
  const serialized=JSON.stringify(body);let command=pending.get(form);if(command?.body!==serialized){command={body:serialized,key:crypto.randomUUID()};pending.set(form,command);}
  const button=form.querySelector('button')!;if(button.disabled)return;button.disabled=true;status.textContent=t('儲存中…','Saving…');
  try{
   const response=await fetch('/api/admin/sleeves',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1','Idempotency-Key':command.key},body:serialized});
   const result=await response.json() as {success?:boolean;error?:{code?:string}};
   if(!response.ok||!result.success)throw new Error(result.error?.code);
   try{sessionStorage.setItem(saved,'1');}catch{}location.reload();
  }catch(error){
   const code=error instanceof Error?error.message:'';
   status.textContent=code==='COMPONENT_INELIGIBLE'?t('組件未通過實體卡牌驗證。','Component is not a verified physical card.')
   :code==='SLEEVE_WORKFLOW_STATE_CHANGED'?t('資料已變更、需求已鎖定或庫存不足。請重新載入確認。','Data changed, requirement is locked or stock is insufficient. Reload to review.')
   :t('無法儲存，請檢查欄位、權限與組件證據後重試。','Could not save. Check fields, access and component evidence before retrying.');status.dataset.tone='error';status.focus();
  }finally{button.disabled=false;}
 });
}
