import {deserializeGameRef,formatNotBggId} from './game-identity';
import {getGames} from './games';
import {publicIdentityIndex} from './identity-resolution';
import {resolveRelationDirection,type RelationEvidence} from './relation-direction';
import {collectionOwned} from './collection-ownership';
import type {BggGameData} from './bgg-types';
import {HttpError} from './notbgg-admin-api';
import {readPublicBggIndex,publicBggHref} from './public-site-data';
export interface PublicLiveRelation {name:string;href:string;source:'bgg'|'manual';kind:string;role:'base'|'expansion'|'related'|'unconfirmed';owned:boolean}
export async function readPublicLiveRelations(db:D1Database,key:string,lang:'en'|'zh-TW'){
 let ref;try{ref=deserializeGameRef(key);}catch{throw new HttpError(400,'INVALID_GAME_ID');}
 const catalog=getGames(),publicIds=await readPublicBggIndex(db),identity=await publicIdentityIndex(db,catalog,publicIds);
 if(ref.source==='bgg'&&!publicIds.includes(ref.bggId))throw new HttpError(404,'GAME_NOT_FOUND');
 const alias=ref.source==='bgg'?identity.byBgg.get(ref.bggId):identity.byNotBgg.get(ref.notBggId);
 const bgg=ref.source==='bgg'?ref.bggId:alias?.bggId??0,seq=ref.source==='notbgg'?Number(ref.notBggId.slice(7)):alias?Number(alias.notBggId.slice(7)):0;
 const rootSql=`SELECT g.id FROM v2_games g LEFT JOIN notbgg_games n ON n.game_id=g.id WHERE (g.bgg_id=? AND ?>0 OR n.seq=? AND ?>0) AND n.archived_at IS NULL`;
 const rootArgs=[bgg,bgg,seq,seq],idsJson=JSON.stringify(publicIds);
 const [cacheRows,gameRows,edgeRows,siteRows,typeRows]=await Promise.all([
  db.prepare(`SELECT bgg_id,cache_json FROM bgg_games WHERE last_success_at IS NOT NULL AND cache_json IS NOT NULL AND bgg_id IN(SELECT value FROM json_each(?)) AND
   (bgg_id=? OR EXISTS(SELECT 1 FROM json_each(cache_json,'$.expansions') WHERE json_extract(value,'$.id')=?) OR EXISTS(SELECT 1 FROM json_each(cache_json,'$.implementations') WHERE json_extract(value,'$.id')=?) OR EXISTS(SELECT 1 FROM json_each(cache_json,'$.compilations') WHERE json_extract(value,'$.id')=?)) LIMIT 1001`).bind(idsJson,bgg,bgg,bgg,bgg).all<{bgg_id:number;cache_json:string}>(),
  db.prepare(`SELECT g.id,g.bgg_id,g.primary_name,n.seq,n.name,n.archived_at FROM v2_games g LEFT JOIN notbgg_games n ON n.game_id=g.id WHERE g.bgg_id IN(SELECT value FROM json_each(?)) OR (n.seq IS NOT NULL AND n.archived_at IS NULL)`).bind(idsJson).all<{id:number;bgg_id:number|null;primary_name:string;seq:number|null;name:string|null;archived_at:string|null}>(),
  db.prepare(`SELECT source_game_id,target_game_id,relation_type,relation_source,admin_confirmed FROM v2_game_relations WHERE archived_at IS NULL AND (relation_source='bgg' OR (relation_source='manual' AND admin_confirmed=1)) AND (source_game_id IN(${rootSql}) OR target_game_id IN(${rootSql})) LIMIT 1001`).bind(...rootArgs,...rootArgs).all<{source_game_id:number;target_game_id:number;relation_type:string;relation_source:'bgg'|'manual';admin_confirmed:number}>(),
  db.prepare(`SELECT source_game_id,target_game_id,relation_type FROM site_game_relations WHERE archived_at IS NULL AND (source_game_id IN(${rootSql}) OR target_game_id IN(${rootSql})) LIMIT 1001`).bind(...rootArgs,...rootArgs).all<{source_game_id:number;target_game_id:number;relation_type:string}>(),
  db.prepare(`SELECT bgg_id,json_extract(cache_json,'$.gameType') game_type,json_extract(cache_json,'$.name') name FROM bgg_games WHERE last_success_at IS NOT NULL AND cache_json IS NOT NULL AND bgg_id IN(SELECT value FROM json_each(?))`).bind(idsJson).all<{bgg_id:number;game_type:string;name:string}>()]);
 if([cacheRows,gameRows,edgeRows,siteRows,typeRows].some(r=>!r.success)||[cacheRows,edgeRows,siteRows].some(r=>r.results.length>1000))throw new HttpError(503,'RELATIONS_UNAVAILABLE');
 const caches=new Map<number,BggGameData>(catalog.filter(g=>g.bgg).map(g=>[g.bggId,g.bgg!]));
 for(const row of typeRows.results)if(!cacheRows.results.some(c=>c.bgg_id===row.bgg_id))caches.delete(row.bgg_id);
 for(const row of cacheRows.results){let game:BggGameData;try{game=JSON.parse(row.cache_json);}catch{throw new HttpError(503,'RELATIONS_UNAVAILABLE');}if(game.bggId!==row.bgg_id)throw new HttpError(503,'RELATIONS_UNAVAILABLE');caches.set(row.bgg_id,game);}
 const roots=gameRows.results.filter(g=>!g.archived_at&&(g.bgg_id===bgg&&bgg>0||g.seq===seq&&seq>0)),rootIds=new Set(roots.map(g=>g.id));
 if(ref.source==='notbgg'&&!roots.some(g=>g.seq===seq)||ref.source==='bgg'&&!caches.has(bgg)&&!roots.length)throw new HttpError(404,'GAME_NOT_FOUND');
 const relatedIds=new Set([...rootIds,...edgeRows.results.flatMap(e=>[e.source_game_id,e.target_game_id]),...siteRows.results.flatMap(e=>[e.source_game_id,e.target_game_id])]);
 const relatedBgg=new Set<number>();for(const [id,c]of caches){const links=[...(c.expansions??[]),...(c.implementations??[]),...(c.compilations??[])];if(id===bgg)links.forEach(link=>relatedBgg.add(link.id));else if(links.some(link=>link.id===bgg))relatedBgg.add(id);}
 for(const g of gameRows.results)if(g.bgg_id&&relatedBgg.has(g.bgg_id))relatedIds.add(g.id);
 for(const link of identity.byBgg.values()){const ids=gameRows.results.filter(g=>g.bgg_id===link.bggId||g.seq===Number(link.notBggId.slice(7))).map(g=>g.id);if(ids.some(id=>relatedIds.has(id)))ids.forEach(id=>relatedIds.add(id));}
 const ownedRows=await db.prepare(`SELECT c.game_id,c.acquisition_status,CASE WHEN json_valid(c.notes) THEN json_extract(c.notes,'$.owned') END legacy_owned FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id LEFT JOIN notbgg_games n ON n.game_id=c.game_id WHERE c.record_scope='production' AND m.archived_at IS NULL AND n.archived_at IS NULL AND c.game_id IN(SELECT value FROM json_each(?))`).bind(JSON.stringify([...relatedIds])).all<{game_id:number;acquisition_status:string;legacy_owned:unknown}>();
 if(!ownedRows.success)throw new HttpError(503,'RELATIONS_UNAVAILABLE');
 const held=new Set(ownedRows.results.filter(c=>collectionOwned(c.acquisition_status,c.legacy_owned)).map(c=>c.game_id));
 const prefix=lang==='en'?'/en':'',rows:PublicLiveRelation[]=[];
 function target(id:number|undefined,bggId:number|undefined,name:string){
  const g=id?gameRows.results.find(g=>g.id===id):gameRows.results.find(g=>g.bgg_id===bggId);
  if(g?.archived_at)return null;
  const linked=bggId?identity.byBgg.get(bggId):g?.seq?identity.byNotBgg.get(formatNotBggId(g.seq)):undefined;
  const href=linked?.primarySource==='notbgg'?prefix+'/games/notbgg/'+linked.notBggId.slice(7):linked?.primarySource==='bgg'?publicBggHref(linked.bggId,lang):g?.seq?prefix+'/games/notbgg/'+String(g.seq).padStart(6,'0'):bggId&&publicIds.includes(bggId)?publicBggHref(bggId,lang):bggId?'https://boardgamegeek.com/boardgame/'+bggId:null;
  if(!href)return null;
  const linkedIds=gameRows.results.filter(row=>linked&&(row.bgg_id===linked.bggId||row.seq===Number(linked.notBggId.slice(7)))).map(row=>row.id);
  return {name:g?.name??name,href,owned:!!g&&held.has(g.id)||linkedIds.some(id=>held.has(id))};
 }
 const grouped=new Map<string,{id:number;kind:'expansions'|'implementations'|'compilations';name:string;evidence:RelationEvidence[]}>();
 for(const [origin,game]of caches)for(const kind of ['expansions','implementations','compilations']as const)for(const link of game[kind]??[]){
  if(!Number.isSafeInteger(link.id)||link.id<1||link.id===origin||origin!==bgg&&link.id!==bgg)continue;
  const id=origin===bgg?link.id:origin,key=id+':'+kind,item=grouped.get(key)??{id,kind,name:origin===bgg?link.name:game.name,evidence:[]};
  item.evidence.push({sourceGameId:origin,targetGameId:link.id,relationType:kind,rawInbound:link.inbound,inboundPresence:typeof link.inbound==='boolean'?'present':'missing',origin:origin===bgg?'direct':'reverse',sourceGameType:game.gameType,targetGameType:typeRows.results.find(row=>row.bgg_id===link.id)?.game_type??caches.get(link.id)?.gameType,evidenceSource:'local-cache',rawNames:[link.name]});grouped.set(key,item);
 }
 const types=new Map([...caches].map(([id,g])=>[id,g.gameType]));for(const row of typeRows.results)types.set(row.bgg_id,row.game_type);
 for(const item of grouped.values()){const t=target(undefined,item.id,caches.get(item.id)?.name??item.name);if(!t)continue;const direction=resolveRelationDirection(bgg,item.id,item.kind,item.evidence,types);rows.push({...t,source:'bgg',kind:item.kind,role:direction.semanticRole==='unknown'?'unconfirmed':direction.semanticRole});}
 for(const edge of [...edgeRows.results,...siteRows.results.map(r=>({...r,relation_source:'manual' as const,admin_confirmed:1}))]){
  const outgoing=rootIds.has(edge.source_game_id),incoming=rootIds.has(edge.target_game_id);if(!outgoing&&!incoming)continue;
  const g=gameRows.results.find(g=>g.id===(outgoing?edge.target_game_id:edge.source_game_id));if(!g||rootIds.has(g.id)||g.archived_at)continue;
  const t=target(g.id,g.bgg_id??undefined,g.name??g.primary_name);if(!t)continue;
  rows.push({...t,source:edge.relation_source,kind:edge.relation_type,role:edge.relation_source==='manual'&&['requires_base','expansion_of'].includes(edge.relation_type)?outgoing?'base':'expansion':'related'});
 }
 return {relations:rows.filter((r,index)=>rows.findIndex(other=>other.href===r.href&&other.kind===r.kind&&other.source===r.source)===index)};
}
export async function handlePublicLiveRelations(request:Request,db:D1Database|undefined,key:string){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(request.method!=='GET')return Response.json({success:false,error:{code:'METHOD_NOT_ALLOWED'}},{status:405,headers});
 try{if(!db)throw new HttpError(503,'RELATIONS_UNAVAILABLE');const data=await readPublicLiveRelations(db,key,new URL(request.url).searchParams.get('lang')==='en'?'en':'zh-TW');return Response.json({success:true,data},{headers});}
 catch(error){return Response.json({success:false,error:{code:error instanceof HttpError?error.code:'RELATIONS_UNAVAILABLE'}},{status:error instanceof HttpError?error.status:503,headers});}
}
