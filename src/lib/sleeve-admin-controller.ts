const root=document.querySelector<HTMLElement>('[data-sleeve-admin]');
if(root){
    const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh;
    const status=root.querySelector<HTMLElement>('[data-sleeve-status]')!;
    const savedKey='sleeve-saved:'+location.pathname+location.search;
    try{if(sessionStorage.getItem(savedKey)){sessionStorage.removeItem(savedKey);status.textContent=t('已儲存卡套資料。','Sleeve data saved.');status.dataset.tone='success';}}catch{/* Optional notice. */}
    for(const input of root.querySelectorAll<HTMLInputElement>('input[type=date]')){
        const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());input.value=now.toISOString().slice(0,10);
    }
    const pending=new WeakMap<HTMLFormElement,{body:string;key:string}>();
    const messages:Record<string,string>={
        SLEEVE_STATE_CHANGED:t('資料已更新、庫存不足，或已有交易而無法變更尺寸。請重新載入確認。','The record changed, stock is insufficient, or an existing ledger prevents a size change. Reload to review.'),
        INVALID_SLEEVE_INPUT:t('請檢查必填欄位、日期及整數數量。','Check required fields, dates and integer quantities.'),
        IDEMPOTENCY_CONFLICT:t('此請求的內容已變更，請重新載入。','This request changed. Reload the page.'),
    };
    root.addEventListener('submit',async event=>{
        const form=event.target;
        if(!(form instanceof HTMLFormElement)||!form.dataset.sleeveAction)return;
        event.preventDefault();
        const action=form.dataset.sleeveAction;
        if(action==='archive'&&!confirm(t('停用此產品？交易與需求記錄會保留。','Deactivate this product? Transactions and requirements are retained.')))return;
        if(action==='stock'&&!confirm(t('確認登錄此庫存變更？請核對包數或張數。','Record this stock change? Check the pack or sleeve quantity.')))return;
        const body:Record<string,unknown>={action};
        const data=new FormData(form);
        for(const [name,value] of data)body[name]=value;
        for(const name of ['productId','revision','lastTransactionId','width','height','sheetsPerPack','quantity'])if(data.has(name))body[name]=Number(data.get(name));
        if(action==='create'||action==='edit'){
            body.thickness=data.get('thickness')===''?null:Number(data.get('thickness'));
            body.active=data.has('active');
        }
        const serialized=JSON.stringify(body);
        let command=pending.get(form);
        if(command?.body!==serialized){command={body:serialized,key:crypto.randomUUID()};pending.set(form,command);}
        const button=form.querySelector('button');
        if(button?.disabled)return;
        if(button)button.disabled=true;
        status.textContent=t('儲存中…','Saving…');status.dataset.tone='info';
        try{
            const response=await fetch('/api/admin/sleeves',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1','Idempotency-Key':command.key},body:serialized});
            const result=await response.json() as {success?:boolean;error?:{code?:string}};
            if(!response.ok||!result.success)throw new Error(result.error?.code??'SERVICE_UNAVAILABLE');
            try{sessionStorage.setItem(savedKey,'1');}catch{/* Optional notice. */}
            location.reload();
        }catch(error){
            const code=error instanceof Error?error.message:'SERVICE_UNAVAILABLE';
            status.textContent=messages[code]??t('無法儲存。請確認權限或稍後重試。','Could not save. Check your access or retry later.');
            status.dataset.tone='error';status.focus();
        }finally{if(button)button.disabled=false;}
    });
}
