import {HttpError} from './notbgg-admin-api';
import {getGames} from './games';
import {formatNotBggId} from './game-identity';
import {publicIdentityIndex} from './identity-resolution';
import {bggGameRelations,effectiveGameRelations,readBggRelationCaches,readRelationCaches,readStoredGameRelations,type GameRelationEdge} from './effective-game-relations';
export const gameRelationTypes=['requires_base','expansion_of','standalone_related','same_series','integrates_with','compilation_of','accessory_for','other'] as const;
export const collectionRelationTypes=['requires_base','expansion_of','standalone_related','same_series','integrates_with','bundle_contains','accessory_for','other'] as const;
const symmetric=['standalone_related','same_series','integrates_with'];
function integer(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new HttpError(400,'INVALID_RELATION');return value;}
async function digest(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function model(domain:unknown){if(domain==='game')return {table:'v2_game_relations',source:'source_game_id',target:'target_game_id',types:gameRelationTypes};if(domain==='collection')return {table:'v2_collection_relations',source:'source_item_id',target:'target_item_id',types:collectionRelationTypes};throw new HttpError(400,'INVALID_RELATION');}
function effectiveType(row:Record<string,unknown>){
 const declared=String(row.game_type??'unknown');
 const staticGame=getGames().find(g=>g.bggId===row.bgg_id)?.bgg;
 let cached:{gameType?:string}|undefined;try{cached=row.cache_json?JSON.parse(String(row.cache_json)):staticGame;}catch{}
 const observed=cached?.gameType==='boardgameexpansion'?'expansion':cached?.gameType==='boardgame'?'base':'unknown';
 if((declared==='base'&&observed==='expansion')||(declared==='expansion'&&observed==='base'))return 'unknown';
 return declared!=='unknown'?declared:observed;
}
async function endpoints(db:D1Database,domain:unknown,source:number,target:number){
 const result=domain==='game'?await db.prepare(`SELECT g.*,n.type notbgg_type,n.seq,n.archived_at,b.cache_json FROM v2_games g LEFT JOIN notbgg_games n ON n.game_id=g.id LEFT JOIN bgg_games b ON b.bgg_id=g.bgg_id WHERE g.id IN(?,?)`).bind(source,target).all<Record<string,unknown>>()
 :await db.prepare(`SELECT c.*,g.bgg_id,g.game_type,b.cache_json,n.archived_at game_archived,m.archived_at FROM v2_collection_items c LEFT JOIN v2_games g ON g.id=c.game_id LEFT JOIN bgg_games b ON b.bgg_id=g.bgg_id LEFT JOIN notbgg_games n ON n.game_id=g.id LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id WHERE c.id IN(?,?)`).bind(source,target).all<Record<string,unknown>>();
 if(!result.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');
 const a=result.results.find(r=>r.id===source),b=result.results.find(r=>r.id===target);
 if(!a||!b||a.archived_at||b.archived_at||a.game_archived||b.game_archived||domain==='game'&&[a,b].some(r=>!r.bgg_id&&!r.seq)||domain==='collection'&&a.record_scope!==b.record_scope)throw new HttpError(400,'INVALID_RELATION_REFERENCE');
 const type=(r:Record<string,unknown>)=>domain==='collection'&&r.item_type!=='unknown'?String(r.item_type):r.notbgg_type==='boardgameaccessory'?'accessory':effectiveType(r);
 return {a,b,sourceType:type(a),targetType:type(b)};
}
export async function writeRelation(db:D1Database,actor:string,key:string|null,body:Record<string,unknown>){
 if(Object.keys(body).some(k=>!['domain','action','id','revision','sourceId','targetId','type','confirmed','notes'].includes(k)))throw new HttpError(400,'INVALID_RELATION');
 const m=model(body.domain),id=integer(body.id),revision=integer(body.revision);
 if(!['save','archive'].includes(String(body.action))||!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new HttpError(400,'INVALID_RELATION');
 const requestKey=await digest(['relation-admin',actor,key]),hash=await digest(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b))));
 const replay=async()=>{const row=await db.prepare('SELECT request_hash,result_id FROM v2_relation_admin_commands WHERE request_key=?').bind(requestKey).first<{request_hash:string;result_id:number}>();if(!row)return null;if(row.request_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT');return {id:row.result_id,replayed:true};};
 const previous=await replay();if(previous)return previous;
 let statement:D1PreparedStatement;
 if(body.action==='archive')statement=db.prepare(`UPDATE ${m.table} SET archived_at=CURRENT_TIMESTAMP,admin_revision=admin_revision+1 WHERE id=? AND admin_revision=? AND archived_at IS NULL ${body.domain==='game'?"AND relation_source='manual'":''} RETURNING id`).bind(id,revision);
 else{
  const source=integer(body.sourceId),target=integer(body.targetId),type=String(body.type);
  if(!source||!target||source===target||!(m.types as readonly string[]).includes(type)||typeof body.confirmed!=='boolean'||typeof body.notes!=='string'||body.notes.length>3000)throw new HttpError(400,'INVALID_RELATION');
  const pair=await endpoints(db,body.domain,source,target);
  if(body.domain==='game'){
   const alias=await db.prepare(`SELECT 1 FROM notbgg_bgg_links WHERE status='linked' AND ((seq=? AND candidate_bgg_id=?) OR (seq=? AND candidate_bgg_id=?))`).bind(pair.a.seq??-1,pair.b.bgg_id??-1,pair.b.seq??-1,pair.a.bgg_id??-1).first();
   if(alias)throw new HttpError(400,'INVALID_RELATION_REFERENCE');
  }
  if(['requires_base','expansion_of'].includes(type)&&(pair.sourceType!=='expansion'||!['base','standalone'].includes(pair.targetType))
   ||type==='accessory_for'&&(pair.sourceType!=='accessory'||!['base','standalone','expansion'].includes(pair.targetType))
   ||['compilation_of','bundle_contains'].includes(type)&&pair.sourceType!=='bundle')throw new HttpError(400,'RELATION_DIRECTION_UNVERIFIED');
  // Pin endpoint identity/type/scope snapshots inside the mutation as well as validating server-side.
  const guard=body.domain==='game'?`EXISTS(SELECT 1 FROM v2_games s JOIN v2_games t ON t.id=? LEFT JOIN notbgg_games sn ON sn.game_id=s.id LEFT JOIN notbgg_games tn ON tn.game_id=t.id WHERE s.id=? AND s.game_type=? AND t.game_type=? AND sn.archived_at IS NULL AND tn.archived_at IS NULL
   AND s.bgg_id IS ? AND t.bgg_id IS ? AND (SELECT cache_json FROM bgg_games WHERE bgg_id=s.bgg_id) IS ? AND (SELECT cache_json FROM bgg_games WHERE bgg_id=t.bgg_id) IS ?)`
   :`EXISTS(SELECT 1 FROM v2_collection_items s JOIN v2_collection_items t ON t.id=? LEFT JOIN v2_collection_management sm ON sm.collection_item_id=s.id LEFT JOIN v2_collection_management tm ON tm.collection_item_id=t.id WHERE s.id=? AND s.record_scope=t.record_scope AND s.item_type=? AND t.item_type=? AND sm.archived_at IS NULL AND tm.archived_at IS NULL)`;
  const proof=[target,source,body.domain==='game'?pair.a.game_type:pair.a.item_type,body.domain==='game'?pair.b.game_type:pair.b.item_type,...(body.domain==='game'?[pair.a.bgg_id??null,pair.b.bgg_id??null,pair.a.cache_json??null,pair.b.cache_json??null]:[])];
  const duplicate=`NOT EXISTS(SELECT 1 FROM ${m.table} r WHERE r.id<>? AND r.archived_at IS NULL AND r.relation_type=?
   ${body.domain==='game'?"AND r.relation_source='manual'":''} AND ((r.${m.source}=? AND r.${m.target}=?) OR (?=1 AND r.${m.source}=? AND r.${m.target}=?)))
   ${body.domain==='game'?`AND NOT EXISTS(SELECT 1 FROM site_game_relations WHERE source_game_id=? AND target_game_id=? AND relation_type=? AND archived_at IS NULL)`:''}`;
  const dup=[id,type,source,target,Number(symmetric.includes(type)),target,source,...(body.domain==='game'?[source,target,type]:[])];
  const game=body.domain==='game',values=[source,target,type,body.notes,...(game?[Number(body.confirmed)]:[])];
  if(id)statement=db.prepare(`UPDATE ${m.table} SET ${m.source}=?,${m.target}=?,relation_type=?,notes=?,${game?'admin_confirmed=?,':''}admin_revision=admin_revision+1
   WHERE id=? AND admin_revision=? AND archived_at IS NULL ${game?"AND relation_source='manual'":''} AND ${guard} AND ${duplicate} RETURNING id`).bind(...values,id,revision,...proof,...dup);
  else statement=db.prepare(`INSERT INTO ${m.table}(${m.source},${m.target},relation_type,notes,${game?'admin_confirmed,relation_source,':''}admin_revision)
   SELECT ?,?,?,?,${game?"?,'manual',":''}1 WHERE ${guard} AND ${duplicate} RETURNING id`).bind(...values,...proof,...dup);
 }
 try{const result=await db.batch<{id:number}>([statement,db.prepare(`INSERT INTO v2_relation_admin_commands(request_key,request_hash,result_id) VALUES(?,?,CASE WHEN changes()=1 THEN ${id?'?':'last_insert_rowid()'} ELSE NULL END)`).bind(requestKey,hash,...(id?[id]:[]))]);return {id:result[0].results[0].id,replayed:false};}
 catch(error){const saved=await replay();if(saved)return saved;if(/constraint|RELATION_CYCLE/i.test(String(error)))throw new HttpError(409,'RELATION_STATE_CHANGED');throw error;}
}
export async function readRelationAdmin(db:D1Database,params:URLSearchParams){
 const domain=params.get('domain')??'game',m=model(domain),after=Number(params.get('after')||0),source=Number(params.get('source')||0);integer(after);integer(source);
 // Collection combinations use their existing read contract and ignore origin.
 const origin=domain==='game'?params.get('origin')??'manual':'manual';
 if(!['all','bgg','manual'].includes(origin))throw new HttpError(400,'INVALID_RELATION');
 const result=origin==='manual'?await db.prepare(`SELECT * FROM ${m.table} WHERE id>? AND (?=0 OR ${m.source}=? OR ${m.target}=?) ORDER BY id LIMIT 21`).bind(after,source,source,source).all<Record<string,unknown>>():null;
 const identities=await db.prepare(`SELECT g.id,g.primary_name,g.bgg_id,g.game_type,n.seq FROM v2_games g LEFT JOIN notbgg_games n ON n.game_id=g.id WHERE n.archived_at IS NULL AND (g.bgg_id IS NOT NULL OR n.seq IS NOT NULL) ORDER BY g.id`).all<{id:number;primary_name:string;bgg_id:number|null;game_type:string;seq:number|null}>();
 const collections=await db.prepare(`SELECT c.id,c.display_name,c.item_type,c.record_scope FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id WHERE m.archived_at IS NULL ORDER BY c.id`).all<Record<string,unknown>>();
 if((result&&!result.success)||!identities.success||!collections.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');
 const options:{identities:Record<string,unknown>[];collections:Record<string,unknown>[]}=
  {identities:identities.results,collections:collections.results};
 if(result)return {domain,rows:result.results.slice(0,20),nextCursor:result.results.length>20?Number(result.results[19].id):null,...options};

 const [cacheRows,typeRows]=await readBggRelationCaches(db);
 const games=identities.results;
 const aliases=await publicIdentityIndex(db,[],[...cacheRows.map(row=>row.bgg_id),...games.flatMap(game=>game.bgg_id?[game.bgg_id]:[])]);
 const localByBgg=new Map(games.filter(game=>game.bgg_id!==null).map(game=>[game.bgg_id,game]));
 const selected=games.find(game=>game.id===source);
 const selectedBgg=selected?.bgg_id??(selected?.seq?aliases.byNotBgg.get(formatNotBggId(selected.seq))?.bggId:undefined);
 const bgg=bggGameRelations(readRelationCaches(cacheRows,new Map(),typeRows),typeRows)
  .filter(link=>(localByBgg.has(link.sourceBggId)||localByBgg.has(link.targetBggId))&&
   (!source||link.sourceBggId===selectedBgg||link.targetBggId===selectedBgg))
  // External sources have no local ID. Their BGG ID breaks ties within the requested sort key.
  .sort((a,b)=>(localByBgg.get(a.sourceBggId)?.id??0)-(localByBgg.get(b.sourceBggId)?.id??0)||
   a.targetBggId-b.targetBggId||a.kind.localeCompare(b.kind)||a.sourceBggId-b.sourceBggId);
 if(bgg.length>1000)throw new HttpError(503,'RELATION_SCOPE_TOO_BROAD');
 type Manual=GameRelationEdge & Record<string,unknown>;
 const [manual,site]=origin==='all'?await readStoredGameRelations<Manual>(db,'1',[],false):[[],[]];
 manual.sort((a,b)=>Number(a.id)-Number(b.id));
 const rows:Record<string,unknown>[]=[];
 for(const row of effectiveGameRelations(bgg,manual,site,games,aliases,edge=>Boolean(edge.archived_at))){
  const stored=row.manual??row.site;
  if(stored){
   if(!row.bgg&&source&&stored.source_game_id!==source&&stored.target_game_id!==source)continue;
   rows.push({...stored,relation_source:row.manual?'manual':'notbgg',sources:row.sources});
   continue;
  }
  const link=row.bgg!;
  rows.push({
   relation_type:link.kind,relation_source:'bgg',sources:row.sources,
   source_game_id:localByBgg.get(link.sourceBggId)?.id,target_game_id:localByBgg.get(link.targetBggId)?.id,
   source_bgg_id:link.sourceBggId,target_bgg_id:link.targetBggId,
   source_name:link.sourceName,target_name:link.targetName,direction_confirmed:link.role!=='unconfirmed',
  });
 }
 return {domain,rows:rows.slice(after,after+20),nextCursor:rows.length>after+20?after+20:null,total:rows.length,...options};
}

// The page can navigate backwards without extending the manual API response.
export async function readManualGameRelationPage(db:D1Database, after:number, source:number) {
 const predicate = 'id<=? AND (?=0 OR source_game_id=? OR target_game_id=?)';
 const args = [after,source,source,source];
 const result = await db.prepare(`SELECT COUNT(*) AS count,
  (SELECT id FROM v2_game_relations WHERE ${predicate} ORDER BY id DESC LIMIT 1 OFFSET 20) AS previous
  FROM v2_game_relations WHERE ${predicate}`).bind(...args,...args).first<{count:number;previous:number|null}>();
 if(!result)throw new HttpError(503,'RELATIONS_UNAVAILABLE');
 return {page:Math.floor(result.count/20)+1,previous:result.previous??0};
}
