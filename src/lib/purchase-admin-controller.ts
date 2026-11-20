export {};
const root=document.querySelector<HTMLElement>('[data-purchase-admin]');
if(root){
 const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh,status=root.querySelector<HTMLElement>('[data-purchase-status]')!;
 const saved='purchase-saved:'+location.pathname;try{if(sessionStorage.getItem(saved)){status.textContent=t('採購已儲存。','Purchase saved.');sessionStorage.removeItem(saved);}}catch{}
 const form=root.querySelector<HTMLFormElement>('[data-purchase-form]');
 if(form){
  const lines=form.querySelector<HTMLElement>('[data-purchase-lines]')!;
  form.querySelector('[data-add-line]')?.addEventListener('click',()=>{if(lines.children.length>=30)return;lines.appendChild(form.querySelector<HTMLTemplateElement>('[data-line-template]')!.content.cloneNode(true));preview();});
  form.addEventListener('click',event=>{const target=event.target;if(target instanceof HTMLElement&&target.closest('[data-remove-line]')){target.closest('[data-purchase-line]')?.remove();preview();}});
  function input(){
   const body:Record<string,unknown>={};const data=new FormData(form!);
   for(const name of ['date','merchant','reference','currency','status','notes','method'])body[name]=String(data.get(name)??'');
   for(const name of ['id','revision','shipping','tax','fee','discount','refunded'])body[name]=Number(data.get(name));
   body.lines=[...lines.querySelectorAll('[data-purchase-line]')].map(row=>{const value=(name:string)=>(row.querySelector('[name='+name+']') as HTMLInputElement).value;return {collectionId:Number(value('collectionId')),description:value('description'),quantity:Number(value('quantity')),price:Number(value('price')),discount:Number(value('discount')),allocated:Number(value('allocated'))};});return body;
  }
  function preview(){
   const display=form!.querySelector<HTMLElement>('[data-money-preview]')!;
   try{const b=input(),rows=b.lines as {quantity:number;price:number;discount:number;allocated:number}[];
    const subtotal=rows.reduce((sum,r)=>sum+BigInt(r.quantity)*BigInt(r.price)-BigInt(r.discount),0n),total=subtotal+BigInt(b.shipping as number)+BigInt(b.tax as number)+BigInt(b.fee as number)-BigInt(b.discount as number)-BigInt(b.refunded as number);
    const allocated=b.method==='weighted'?total:rows.reduce((sum,r)=>sum+BigInt(r.allocated),0n);
    display.textContent=t('商品淨額／淨支付額／尚未分攤：','Item subtotal / net payment / unallocated: ')+[subtotal,total,total-allocated].join(' / ')+' '+String(b.currency);
   }catch{display.textContent=t('請填寫整數金額。','Enter integer amounts.');}
  }
  form.addEventListener('input',preview);form.addEventListener('change',preview);preview();
  let command:{body:string;key:string}|undefined,busy=false;
  form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;
   const serialized=JSON.stringify(input());if(command?.body!==serialized)command={body:serialized,key:crypto.randomUUID()};
   busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent=t('儲存中…','Saving…');
   try{const response=await fetch('/api/admin/purchases',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1','Idempotency-Key':command.key},body:serialized});const result=await response.json() as {success?:boolean;data?:{id:number};error?:{code:string}};
    if(!response.ok||!result.success||!result.data)throw new Error(result.error?.code??'SERVICE_UNAVAILABLE');
    try{sessionStorage.setItem(saved,'1');}catch{}
    location.href='/admin/purchases?id='+result.data.id+'&lang='+(en?'en':'zh-TW');
   }catch(error){const code=error instanceof Error?error.message:'';status.textContent=code==='ALLOCATION_EXCEEDS_TOTAL'?t('分攤合計超過訂單淨額。','Allocations exceed the order net amount.')
    :code==='PURCHASE_READ_ONLY'||code==='PURCHASE_STATE_CHANGED'?t('採購已變更或已有引用，請重新載入；歷史資料維持唯讀。','Purchase changed or has dependencies. Reload; historical data is read only.')
    :t('無法儲存。請檢查整數金額、日期、收藏歸屬、權限及分攤比例。','Could not save. Check integer amounts, dates, collection targets, access and allocation weights.');status.dataset.tone='error';status.focus();
   }finally{busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
 }
}
