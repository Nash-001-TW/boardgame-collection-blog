import {fetchBggGameXml} from './bgg';
import {parseBggGameXml} from './bgg-parser';
import {XMLValidator} from 'fast-xml-parser';
import {HttpError} from './notbgg-admin-api';
import {getGames} from './games';

export function bggId(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2_147_483_647)throw new HttpError(400,'INVALID_BGG_ID');return value;}
async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export interface SyncDependencies {fetcher?:typeof fetch;sleep?:(ms:number)=>Promise<void>;timeoutMs?:number}
type SyncResult={bggId:number;status:'success'|'failed';code:string|null};
export async function syncBggBatch(db:D1Database,secret:unknown,actor:string,key:string|null,input:unknown,deps:SyncDependencies={}){
 if(typeof secret!=='string'||!secret.trim())throw new HttpError(503,'BGG_AUTH_UNAVAILABLE');
 if(!Array.isArray(input)||input.length<1||input.length>3||new Set(input).size!==input.length)throw new HttpError(400,'BGG_BATCH_LIMIT');
 const ids=input.map(bggId);if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY');
 const requestKey=await hash(['bgg-sync',actor,key]),requestHash=await hash(ids),owner=crypto.randomUUID();
 const replay=async()=>{const row=await db.prepare('SELECT request_hash,results_json FROM v2_bgg_sync_commands WHERE request_key=?').bind(requestKey).first<{request_hash:string;results_json:string}>();if(!row)return null;if(row.request_hash!==requestHash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT');return {results:JSON.parse(row.results_json) as SyncResult[],replayed:true};};
 const previous=await replay();if(previous)return previous;
 const gate=await db.prepare(`UPDATE v2_bgg_sync_gate SET owner=?,lease_until=unixepoch('now')*1000+120000
 WHERE id=1 AND lease_until<unixepoch('now')*1000 AND next_allowed<=unixepoch('now')*1000 RETURNING id`).bind(owner).first();
 if(!gate)throw new HttpError(409,'BGG_SYNC_BUSY');
 const results:SyncResult[]=[],sleep=deps.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
 try{
  for(const [index,id]of ids.entries()){
   if(index)await sleep(2000);
   const started=await db.prepare(`INSERT INTO bgg_games(bgg_id,name,last_attempt_at,sync_status,sync_owner) SELECT ?,'Pending',CURRENT_TIMESTAMP,'syncing',?
    WHERE EXISTS(SELECT 1 FROM v2_bgg_sync_gate WHERE owner=? AND lease_until>=unixepoch('now')*1000)
    ON CONFLICT(bgg_id) DO UPDATE SET last_attempt_at=CURRENT_TIMESTAMP,sync_status='syncing',sync_owner=excluded.sync_owner RETURNING bgg_id`).bind(id,owner,owner).first();
   if(!started)throw new HttpError(409,'BGG_SYNC_BUSY');
   let code='BGG_FETCH_FAILED',game:ReturnType<typeof parseBggGameXml>|undefined;
   for(let attempt=0;attempt<2;attempt++){
    try{
     const xml=await fetchBggGameXml(id,{token:secret,fetcher:deps.fetcher,signal:AbortSignal.timeout(deps.timeoutMs??5000)});
     if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('INVALID_XML');
     try{game=parseBggGameXml(xml);}catch{throw new Error('INVALID_XML');}
     if(game.bggId!==id||!game.name||game.name==='Unknown'||!['boardgame','boardgameexpansion','boardgameaccessory'].includes(game.gameType)||JSON.stringify(game).includes(secret))throw new Error('INVALID_XML');
     break;
    }catch(error){
     const message=error instanceof Error?error.message:'';
     const http=message.match(/^BGG API HTTP (\d{3})$/)?.[1];
     code=message==='INVALID_XML'?'BGG_XML_INVALID':message==='BGG_RESPONSE_TOO_LARGE'?'BGG_RESPONSE_TOO_LARGE':http?'BGG_HTTP_'+http
      :error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'BGG_TIMEOUT':'BGG_FETCH_FAILED';
     game=undefined;
     if(attempt===0&&(code==='BGG_TIMEOUT'||code==='BGG_FETCH_FAILED'||['202','429','500','502','503','504'].includes(http??'')))await sleep(2000);else break;
    }
   }
   const result=game?await db.prepare(`UPDATE bgg_games SET name=?,game_type=?,is_expansion=?,cache_json=?,last_success_at=CURRENT_TIMESTAMP,last_error_code=NULL,sync_status='success',updated_at=CURRENT_TIMESTAMP
    WHERE bgg_id=? AND EXISTS(SELECT 1 FROM v2_bgg_sync_gate WHERE owner=? AND lease_until>=unixepoch('now')*1000) RETURNING bgg_id`).bind(game.name,game.gameType,Number(game.isExpansion),JSON.stringify(game),id,owner).first()
    :await db.prepare(`UPDATE bgg_games SET last_error_code=?,sync_status='failed' WHERE bgg_id=? AND EXISTS(SELECT 1 FROM v2_bgg_sync_gate WHERE owner=? AND lease_until>=unixepoch('now')*1000) RETURNING bgg_id`).bind(code,id,owner).first();
   if(!result)throw new HttpError(409,'BGG_SYNC_BUSY');results.push({bggId:id,status:game?'success':'failed',code:game?null:code});
  }
  await db.prepare('INSERT INTO v2_bgg_sync_commands(request_key,request_hash,results_json) VALUES(?,?,?)').bind(requestKey,requestHash,JSON.stringify(results)).run();
  return {results,replayed:false};
 }finally{await db.prepare(`UPDATE v2_bgg_sync_gate SET owner=NULL,lease_until=0,next_allowed=unixepoch('now')*1000+3000 WHERE id=1 AND owner=?`).bind(owner).run();}
}

export async function readBggSync(db:D1Database,params:URLSearchParams){
 const q=(params.get('q')??'').trim(),state=params.get('state')??'all',after=Number(params.get('after')||0);
 if(q.length>100||!['all','success','failed','unknown','syncing'].includes(state)||!Number.isSafeInteger(after)||after<0)throw new HttpError(400,'INVALID_BGG_QUERY');
 const result=await db.prepare(`SELECT bgg_id,name,cache_json,
 CASE WHEN sync_status='syncing' AND NOT EXISTS(SELECT 1 FROM v2_bgg_sync_gate WHERE owner=bgg_games.sync_owner AND lease_until>=unixepoch('now')*1000) THEN 'failed' ELSE sync_status END sync_status,
 last_attempt_at,last_success_at,CASE WHEN sync_status='syncing' AND NOT EXISTS(SELECT 1 FROM v2_bgg_sync_gate WHERE owner=bgg_games.sync_owner AND lease_until>=unixepoch('now')*1000) THEN 'BGG_INTERRUPTED' ELSE last_error_code END last_error_code FROM bgg_games`).all<Record<string,unknown>>();
 if(!result.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');
 const staticGames=getGames();
 const evidence=(game:ReturnType<typeof parseBggGameXml>|undefined)=>game?(['expansions','implementations','compilations']as const).flatMap(kind=>(game[kind]??[]).filter(link=>Number.isSafeInteger(link.id)&&link.id>0).map(link=>({id:link.id,name:link.name,kind,inbound:link.inbound??null}))):[];
 const rows=new Map<number,Record<string,unknown>>(result.results.map(r=>{const{cache_json,...safe}=r;let game;try{game=cache_json?JSON.parse(String(cache_json)):staticGames.find(g=>g.bggId===r.bgg_id)?.bgg;}catch{throw new HttpError(503,'DATABASE_UNAVAILABLE');}return [Number(r.bgg_id),{...safe,evidence:evidence(game)}];}));
 for(const game of staticGames)if(game.bgg&&!rows.has(game.bggId))rows.set(game.bggId,{bgg_id:game.bggId,name:game.bgg.name,sync_status:'unknown',last_success_at:null,last_attempt_at:null,last_error_code:null,evidence:evidence(game.bgg)});
 const filtered=[...rows.values()].filter(row=>Number(row.bgg_id)>after&&(state==='all'||row.sync_status===state)&&(String(row.bgg_id)===q||String(row.name).toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>Number(a.bgg_id)-Number(b.bgg_id));
 return {rows:filtered.slice(0,20),nextCursor:filtered.length>20?Number(filtered[19].bgg_id):null};
}
