import {collectionPickerNumeric,collectionPickerOutcome,collectionPickerRequests,mergeCollectionPickerPages} from './collection-picker';
const root=document.querySelector<HTMLElement>('[data-purchase-admin]');
if(root){
 const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh,status=root.querySelector<HTMLElement>('[data-purchase-status]')!;
 const saved='purchase-saved:'+location.pathname;try{if(sessionStorage.getItem(saved)){status.textContent=t('採購已儲存。','Purchase saved.');sessionStorage.removeItem(saved);}}catch{}
 const form=root.querySelector<HTMLFormElement>('[data-purchase-form]');
 if(form){
  const lines=form.querySelector<HTMLElement>('[data-purchase-lines]')!;
  let pickerNumber=0;
  function setupPicker(picker:HTMLElement){
   const query=picker.querySelector<HTMLInputElement>('[data-picker-query]')!;
   const id=picker.querySelector<HTMLInputElement>('[name=collectionId]')!;
   const search=picker.querySelector<HTMLElement>('[data-picker-search]')!;
   const results=picker.querySelector<HTMLElement>('[data-picker-results]')!;
   const selection=picker.querySelector<HTMLElement>('[data-picker-selection]')!;
   const feedback=picker.querySelector<HTMLElement>('[data-picker-status]')!;
   const manual=picker.querySelector<HTMLButtonElement>('[data-picker-manual]')!;
   const change=picker.querySelector<HTMLButtonElement>('[data-picker-change]')!;
   results.id='purchase-collection-results-'+(++pickerNumber);
   query.setAttribute('aria-controls',results.id);
   let active=-1, options:HTMLElement[]=[];
   let timer:ReturnType<typeof setTimeout>|undefined, pending:AbortController|undefined;
   const selectionRequired=t('請先選擇收藏。','Select a collection first.');
   query.setCustomValidity(selectionRequired);
   function close(){
    clearTimeout(timer);
    pending?.abort();
    pending=undefined;
    active=-1;
    results.hidden=true;
    query.setAttribute('aria-expanded','false');
    query.removeAttribute('aria-activedescendant');
    options.forEach(option=>option.setAttribute('aria-selected','false'));
   }
   function select(value:number,name?:string){
    close();
    id.value=String(value);
    picker.querySelector('[data-picker-label]')!.textContent=name?`${name} (#${value})`:`#${value}`;
    const description=picker.closest('[data-purchase-line]')!.querySelector<HTMLInputElement>('[name=description]')!;
    if(name&&!description.value.trim())description.value=name.slice(0,description.maxLength);
    query.disabled=true;
    search.hidden=true;
    selection.hidden=false;
    change.focus();
   }
   function message(value:string){
    feedback.textContent=value;
    feedback.hidden=!value;
   }
   function schedule(){
    close();
    results.replaceChildren();
    options=[];
    manual.hidden=true;
    message('');
    const value=query.value.trim();
    if(!value)return;
    const request=new AbortController();
    pending=request;
    timer=setTimeout(async()=>{
     const timeout=setTimeout(()=>request.abort('timeout'),8000);
     try{
      const pages=await Promise.all(collectionPickerRequests(value,0).map(async requestSpec=>{
       const response=await fetch(requestSpec.url,{signal:request.signal});
       return {request:requestSpec,page:collectionPickerOutcome(response.ok,await response.json())};
      }));
      if(pending!==request||!picker.isConnected)return;
      const {rows}=mergeCollectionPickerPages(pages);
      for(const row of rows){
       const option=document.createElement('div');
       option.id=results.id+'-'+row.id;
       option.setAttribute('role','option');
       option.setAttribute('aria-selected','false');
       option.textContent=`${row.name} (#${row.id})`;
       if(row.archived){
        option.setAttribute('aria-disabled','true');
        option.textContent+=' · '+t('已封存，不能記採購','Archived, unavailable for purchases');
       }else{
        options.push(option);
        option.addEventListener('click',()=>select(row.id,row.name));
       }
       results.appendChild(option);
      }
      results.hidden=!rows.length;
      query.setAttribute('aria-expanded',String(!!rows.length));
      if(!rows.length)message(t('找不到符合的收藏。','No matching collections.'));
     }catch{
      if(pending!==request||!picker.isConnected)return;
      request.abort();
      message(t('暫時無法搜尋。你可以直接輸入收藏 ID。','Search is temporarily unavailable. You can enter a collection ID directly.'));
      manual.hidden=!collectionPickerNumeric(value)||!Number.isSafeInteger(Number(value))||Number(value)<1;
     }finally{
      clearTimeout(timeout);
     }
    },200);
   }
   query.addEventListener('input',schedule);
   query.addEventListener('focus',schedule);
   results.addEventListener('mousedown',event=>event.preventDefault());
   picker.addEventListener('focusout',event=>{
    if(!(event.relatedTarget instanceof Node)||!picker.contains(event.relatedTarget))close();
   });
   query.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){
     event.preventDefault();
     close();
    }else if(event.key==='Enter'){
     event.preventDefault();
     if(!results.hidden)options[Math.max(0,active)]?.click();
     else if(!manual.hidden)manual.click();
    }else if((event.key==='ArrowDown'||event.key==='ArrowUp')&&options.length){
     event.preventDefault();
     results.hidden=false;
     query.setAttribute('aria-expanded','true');
     const step=event.key==='ArrowDown'?1:-1;
     active=(active<0?(step>0?0:options.length-1):(active+step+options.length)%options.length);
     options.forEach((option,index)=>option.setAttribute('aria-selected',String(index===active)));
     query.setAttribute('aria-activedescendant',options[active].id);
     options[active].scrollIntoView({block:'nearest'});
    }
   });
   manual.addEventListener('click',()=>select(Number(query.value.trim())));
   change.addEventListener('click',()=>{
    id.value='';
    query.value='';
    selection.hidden=true;
    search.hidden=false;
    query.disabled=false;
    query.focus();
   });
  }
  lines.querySelectorAll<HTMLElement>('[data-purchase-picker]').forEach(setupPicker);
  form.querySelector('[data-add-line]')?.addEventListener('click',()=>{
   if(lines.children.length>=30)return;
   const line=form.querySelector<HTMLTemplateElement>('[data-line-template]')!.content.cloneNode(true) as DocumentFragment;
   setupPicker(line.querySelector<HTMLElement>('[data-purchase-picker]')!);
   lines.appendChild(line);
   preview();
  });
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
