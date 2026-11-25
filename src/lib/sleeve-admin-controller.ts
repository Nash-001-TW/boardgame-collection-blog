const root=document.querySelector<HTMLElement>('[data-sleeve-admin]');
if(root){
    const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh;
    const status=root.querySelector<HTMLElement>('[data-sleeve-status]')!;
    const savedKey='sleeve-saved:'+location.pathname+location.search;
    try{if(sessionStorage.getItem(savedKey)){sessionStorage.removeItem(savedKey);status.textContent=t('已儲存卡套資料。','Sleeve data saved.');status.dataset.tone='success';}}catch{/* Optional notice. */}
    for(const input of root.querySelectorAll<HTMLInputElement>('input[type=date]')){
        const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());input.value=now.toISOString().slice(0,10);
    }
    for (const form of root.querySelectorAll<HTMLFormElement>('[data-sleeve-action=stock]')) {
        const kind = form.elements.namedItem('kind');
        const quantity = form.querySelector<HTMLInputElement>('[name=quantity]')!;
        const unit = form.elements.namedItem('unit');
        const collection = form.querySelector<HTMLInputElement>('[name=collectionId]')!;
        const order = form.querySelector<HTMLInputElement>('[name=giftOrder]')!;
        const line = form.elements.namedItem('purchaseOrderLineId');
        if (!(kind instanceof HTMLSelectElement) || !(unit instanceof HTMLSelectElement) || !(line instanceof HTMLSelectElement)) continue;
        const fields = form.querySelector<HTMLFieldSetElement>('[data-gift-fields]')!;
        const quantityLabel = form.querySelector('[data-stock-quantity-label]')!;
        const defaultLabel = quantityLabel.textContent;
        const balance = form.querySelector('[data-gift-balance]')!;
        const update = () => {
            const gift = kind.value === 'GIFT';
            fields.hidden = fields.disabled = !gift;
            quantityLabel.textContent = gift
                ? (unit.value === 'pack' ? t('包數','Number of packs') : t('張數','Number of sleeves'))
                : defaultLabel;
            const multiplier = unit.value === 'pack' ? Number(form.dataset.packSize) : 1;
            quantity.min = gift ? '1' : '-1000000';
            quantity.max = String(gift ? Math.floor(1_000_000 / multiplier) : 1_000_000);
            balance.textContent = quantity.value && quantity.validity.valid
                ? (Number(form.dataset.balance) + quantity.valueAsNumber * multiplier).toLocaleString(en ? 'en' : 'zh-TW')
                : '—';
        };
        kind.addEventListener('change', update);
        unit.addEventListener('change', update);
        quantity.addEventListener('input', update);
        update();

        const unavailable = t('無法取得，請檢查 ID 或清空欄位。','Could not load. Check the ID or clear the field.');
        function lookup<T>(input: HTMLInputElement, notice: Element, url: (id: number) => string,
            reset: () => void, loaded: (data: T) => string) {
            let pending: AbortController | undefined;
            input.addEventListener('input', () => {
                pending?.abort();
                input.setCustomValidity('');
                reset();
                notice.textContent = '';
                if (!input.value || !input.validity.valid || !Number.isSafeInteger(input.valueAsNumber)) return;
                const loading = t('查詢中…','Looking up…');
                input.setCustomValidity(loading);
                notice.textContent = loading;
                const request = new AbortController();
                pending = request;
                void (async () => {
                    try {
                        const signal = AbortSignal.any([request.signal,AbortSignal.timeout(10_000)]);
                        const result = await fetch(url(input.valueAsNumber), {signal});
                        if (!result.ok) throw new Error('Lookup failed');
                        const {data} = await result.json() as {data:T};
                        if (request.signal.aborted) return;
                        notice.textContent = loaded(data);
                        input.setCustomValidity('');
                    } catch {
                        if (request.signal.aborted) return;
                        notice.textContent = unavailable;
                        input.setCustomValidity(unavailable);
                    }
                })();
            });
        }
        const scope = new URLSearchParams(location.search).get('scope') === 'test' ? 'test' : 'production';
        lookup<{item:{display_name:string}}>(collection, form.querySelector('[data-gift-collection]')!,
            id => '/api/admin/collection/'+id+'?scope='+scope, () => {}, data => data.item.display_name);
        lookup<{lines:{id:number;line_number:number;description:string}[]}>(order, form.querySelector('[data-gift-order]')!,
            id => '/api/admin/purchases?id='+id, () => {
                line.disabled = true;
                line.length = 1;
                line.selectedIndex = 0;
            }, data => {
                for (const row of data.lines) line.add(new Option(row.line_number+' · '+row.description, String(row.id)));
                line.disabled = !data.lines.length;
                return data.lines.length ? t('請選擇要連結的明細。','Select a line to link.') : t('此訂單沒有明細。','This order has no lines.');
            });
    }
    const pending=new WeakMap<HTMLFormElement,{body:string;key:string}>();
    const messages:Record<string,string>={
        SLEEVE_STATE_CHANGED:t('資料已更新、庫存不足，或已有交易而無法變更尺寸。請重新載入確認。','The record changed, stock is insufficient, or an existing ledger prevents a size change. Reload to review.'),
        SLEEVE_PRODUCT_PACK_LOCKED:t('已有交易，尺寸與每包張數不可修改。','Size and sleeves per pack are locked after the first transaction.'),
        SLEEVE_TRANSACTION_IMMUTABLE:t('已登錄的交易不可修改或刪除。','Recorded transactions cannot be changed or deleted.'),
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
        data.delete('giftOrder');
        for (const field of ['collectionId','purchaseOrderLineId']) if (data.get(field)==='') data.delete(field);
        for(const [name,value] of data)body[name]=value;
        for(const name of ['productId','revision','lastTransactionId','width','height','sheetsPerPack','quantity','collectionId','purchaseOrderLineId'])if(data.has(name))body[name]=Number(data.get(name));
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
