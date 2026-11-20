const root=document.querySelector<HTMLElement>('[data-copies-admin]');
if(root){
    const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh;
    const status=root.querySelector<HTMLElement>('[data-copy-status]')!;
    const endpoint='/api/admin/collection/'+root.dataset.collectionId+'/copies?scope='+root.dataset.scope;
    const savedKey='copies-saved:'+location.pathname+location.search;
    try{
        if(sessionStorage.getItem(savedKey)){
            sessionStorage.removeItem(savedKey);status.textContent=t('副本已儲存。','Copy saved.');status.dataset.tone='success';
        }
    }catch{/* Optional success feedback. */}
    const commands=new WeakMap<HTMLFormElement,{body:string;key:string}>();
    let busy=false;
    root.addEventListener('submit',async event=>{
        const form=event.target;
        if(!(form instanceof HTMLFormElement)||!form.dataset.copyAction)return;
        event.preventDefault();if(busy)return;
        const fields=new FormData(form);
        const condition=form.dataset.copyAction==='condition';
        const body:Record<string,unknown>=condition?{action:'condition',revision:Number(fields.get('revision')),tags:fields.getAll('tags')}:{expectedRevision:Number(fields.get('expectedRevision'))};
        for(const name of condition?['seal','inspection','trade','date','details']:['label','language','edition'])body[name]=condition?String(fields.get(name)??''):fields.get(name)||null;
        if(fields.has('copyId'))body.copyId=Number(fields.get('copyId'));
        const serialized=JSON.stringify(body);
        let command=commands.get(form);
        if(command?.body!==serialized){command={body:serialized,key:crypto.randomUUID()};commands.set(form,command);}
        busy=true;root.querySelectorAll('button').forEach(button=>button.disabled=true);
        status.textContent=t('儲存中…','Saving…');status.dataset.tone='info';
        try{
            const response=await fetch(endpoint,{method:form.dataset.copyAction==='create'?'POST':'PATCH',
                headers:{'Content-Type':'application/json','X-NotBGG-Request':'1','Idempotency-Key':command.key},body:serialized});
            const result=await response.json() as {success?:boolean;error?:{code?:string}};
            if(!response.ok||!result.success){
                status.textContent=response.status===409
                    ?t('收藏或副本已更新或封存。請重新載入後再試。','The collection or copy changed or was archived. Reload before retrying.')
                    :t('無法儲存副本。請檢查輸入與權限。','Could not save the copy. Check your input and access.');
                status.dataset.tone='error';status.focus();return;
            }
            try{sessionStorage.setItem(savedKey,'1');}catch{/* Optional success feedback. */}
            location.reload();
        }catch{
            status.textContent=t('無法確認儲存結果，請重試或重新載入。','Could not confirm the save. Retry or reload.');
            status.dataset.tone='error';status.focus();
        }finally{busy=false;root.querySelectorAll('button').forEach(button=>button.disabled=false);}
    });
}
