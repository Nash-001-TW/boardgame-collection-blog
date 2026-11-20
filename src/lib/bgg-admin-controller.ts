export {};
const root=document.querySelector<HTMLElement>('[data-bgg-admin]');
if(root){
 const en=root.dataset.lang==='en',t=(zh:string,english:string)=>en?english:zh,status=root.querySelector<HTMLElement>('[data-bgg-status]')!;
 const saved='bgg-admin-saved:'+location.href;try{const value=sessionStorage.getItem(saved);if(value){status.textContent=value;sessionStorage.removeItem(saved);}}catch{}
 let busy=false;const commands=new Map<string,{body:string;key:string}>();
 async function send(body:Record<string,unknown>,scope:string){
  if(busy)return;const serialized=JSON.stringify(body);let command=commands.get(scope);if(command?.body!==serialized){command={body:serialized,key:crypto.randomUUID()};commands.set(scope,command);}
  busy=true;root!.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent=t('處理中…','Working…');
  try{const r=await fetch('/api/admin/bgg',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1','Idempotency-Key':command.key},body:serialized});const result=await r.json() as {success?:boolean;error?:{code:string};data?:{results?:{bggId:number;status:string;code:string|null}[]}};
   if(!r.ok||!result.success)throw new Error(result.error?.code??'BGG_SERVICE_UNAVAILABLE');
   const message=result.data?.results?.map(item=>'BGG '+item.bggId+' · '+(item.status==='success'?t('成功','Succeeded'):t('失敗','Failed'))+(item.code?' · '+item.code:'')).join(' / ')??t('關聯已儲存。','Relation saved.');
   try{sessionStorage.setItem(saved,message);}catch{}location.reload();
  }catch(error){const code=error instanceof Error?error.message:'';status.textContent=code==='BGG_SYNC_BUSY'?t('另一同步正在執行或冷卻中，請稍後重試。','A sync is active or cooling down. Retry shortly.')
   :code==='BGG_AUTH_UNAVAILABLE'?t('伺服器尚未設定 BGG 認證。','BGG server authentication is not configured.')
   :code==='RELATION_DIRECTION_UNVERIFIED'?t('無法驗證關聯方向或角色，請確認主遊戲、擴充、配件或合輯身份。','Relation direction or roles cannot be verified. Check base, expansion, accessory or bundle identities.')
   :t('無法完成。請檢查最多 3 筆不同 ID、關聯、版本及權限後重試。','Could not complete. Check the limit of 3 distinct IDs, relation references, version and access.');status.dataset.tone='error';status.focus();
  }finally{busy=false;root!.querySelectorAll('button').forEach(b=>b.disabled=false);}
 }
 root.addEventListener('submit',event=>{const form=event.target;if(!(form instanceof HTMLFormElement)||!form.dataset.bggAction)return;event.preventDefault();const data=new FormData(form),action=form.dataset.bggAction;
  if(action==='sync'){void send({action:'sync',ids:String(data.get('ids')).split(',').map(s=>Number(s.trim()))},'sync');return;}
  if(action==='archive'&&!confirm(t('封存此關聯？原始紀錄會保留。','Archive this relation? The original record is retained.')))return;
  const body:Record<string,unknown>={action:action==='archive'?'archive':'save'};for(const[k,v]of data)body[k]=v;
  for(const name of ['id','revision','sourceId','targetId'])if(data.has(name))body[name]=Number(data.get(name));if(action!=='archive')body.confirmed=data.has('confirmed');
  void send(body,action+':'+String(body.id));
 });
 root.addEventListener('click',event=>{const target=event.target;if(!(target instanceof HTMLElement))return;const single=target.closest<HTMLElement>('[data-sync-id]');if(single)void send({action:'sync',ids:[Number(single.dataset.syncId)]},'sync');
  else if(target.closest('[data-sync-selected]'))void send({action:'sync',ids:[...root.querySelectorAll<HTMLInputElement>('[data-sync-select]:checked')].map(input=>Number(input.value))},'sync');
 });
}
