import {deserializeGameRef,formatNotBggId} from './game-identity';
import {getGames} from './games';
import {publicIdentityIndex} from './identity-resolution';
import {bggGameRelations,checkedRelationRead,effectiveGameRelations,readBggRelationCaches,readRelationCaches,readStoredGameRelations,type GameRelationEdge} from './effective-game-relations';
import {collectionOwned} from './collection-ownership';
import type {BggGameData} from './bgg-types';
import {HttpError} from './notbgg-admin-api';
import {safeImage} from './notbgg-public';
import {readPublicBggIndex,publicBggHref,publicBggPresentationSql,publicNotBggPresentationSql} from './public-site-data';
export interface PublicLiveRelation {name:string;href:string;image:string|null;source:'bgg'|'manual';sources:('bgg'|'manual')[];kind:string;role:'base'|'expansion'|'related'|'unconfirmed';owned:boolean}
export async function readPublicLiveRelations(db:D1Database,key:string,lang:'en'|'zh-TW'){
 let ref;try{ref=deserializeGameRef(key);}catch{throw new HttpError(400,'INVALID_GAME_ID');}
 const catalog=getGames(),publicIds=await readPublicBggIndex(db),identity=await publicIdentityIndex(db,catalog,publicIds);
 if(ref.source==='bgg'&&!publicIds.includes(ref.bggId))throw new HttpError(404,'GAME_NOT_FOUND');
 const alias=ref.source==='bgg'?identity.byBgg.get(ref.bggId):identity.byNotBgg.get(ref.notBggId);
 const bgg=ref.source==='bgg'?ref.bggId:alias?.bggId??0,seq=ref.source==='notbgg'?Number(ref.notBggId.slice(7)):alias?Number(alias.notBggId.slice(7)):0;
 const rootSql=`SELECT g.id FROM v2_games g LEFT JOIN notbgg_games n ON n.game_id=g.id WHERE (g.bgg_id=? AND ?>0 OR n.seq=? AND ?>0) AND n.archived_at IS NULL`;
 const rootArgs=[bgg,bgg,seq,seq],idsJson=JSON.stringify(publicIds);
 const [[cacheRows,typeRows],gameRows,[edgeRows,siteRows]]=await Promise.all([
  readBggRelationCaches(db,{ids:publicIds,root:bgg}),
  checkedRelationRead(db.prepare(`SELECT g.id,g.bgg_id,g.primary_name,n.seq,n.name,n.archived_at,${publicNotBggPresentationSql.image} image FROM v2_games g LEFT JOIN notbgg_games n ON n.game_id=g.id WHERE g.bgg_id IN(SELECT value FROM json_each(?)) OR (n.seq IS NOT NULL AND n.archived_at IS NULL)`).bind(idsJson).all<{id:number;bgg_id:number|null;primary_name:string;seq:number|null;name:string|null;archived_at:string|null;image:string|null}>()),
  readStoredGameRelations<GameRelationEdge & {relation_source:'bgg'|'manual'}>(
   db,`source_game_id IN(${rootSql}) OR target_game_id IN(${rootSql})`,[...rootArgs,...rootArgs],true),
 ]);
 const baseline=new Map<number,BggGameData>(catalog.filter(g=>g.bgg).map(g=>[g.bggId,g.bgg!]));
 const caches=readRelationCaches(cacheRows,baseline,typeRows);
 const roots=gameRows.filter(g=>!g.archived_at&&(g.bgg_id===bgg&&bgg>0||g.seq===seq&&seq>0)),rootIds=new Set(roots.map(g=>g.id));
 if(ref.source==='notbgg'&&!roots.some(g=>g.seq===seq)||ref.source==='bgg'&&!caches.has(bgg)&&!roots.length)throw new HttpError(404,'GAME_NOT_FOUND');
 const relatedIds=new Set([...rootIds,...edgeRows.flatMap(e=>[e.source_game_id,e.target_game_id]),...siteRows.flatMap(e=>[e.source_game_id,e.target_game_id])]);
 const relatedBgg=new Set<number>();for(const [id,c]of caches){const links=[...(c.expansions??[]),...(c.implementations??[]),...(c.compilations??[])];if(id===bgg)links.forEach(link=>relatedBgg.add(link.id));else if(links.some(link=>link.id===bgg))relatedBgg.add(id);}
 for(const g of gameRows)if(g.bgg_id&&relatedBgg.has(g.bgg_id))relatedIds.add(g.id);
 for(const link of identity.byBgg.values()){const ids=gameRows.filter(g=>g.bgg_id===link.bggId||g.seq===Number(link.notBggId.slice(7))).map(g=>g.id);if(ids.some(id=>relatedIds.has(id)))ids.forEach(id=>relatedIds.add(id));}
 const imageIds=new Set(relatedBgg);
 for(const game of gameRows){
  if(!relatedIds.has(game.id))continue;
  const id=game.bgg_id??(game.seq?identity.byNotBgg.get(formatNotBggId(game.seq))?.bggId:undefined);
  if(id)imageIds.add(id);
 }
 // Only catalog-visible BGG targets may use live catalog cover metadata.
 const publicImageIds=publicIds.filter(id=>imageIds.has(id));
 const imageRows=publicImageIds.length?await checkedRelationRead(db.prepare(`SELECT b.bgg_id,${publicBggPresentationSql.image} image
  FROM (SELECT bgg_id,CASE WHEN json_valid(cache_json) THEN cache_json END meta FROM bgg_games
   WHERE last_success_at IS NOT NULL AND cache_json IS NOT NULL AND bgg_id IN(SELECT value FROM json_each(?))) b`)
  .bind(JSON.stringify(publicImageIds)).all<{bgg_id:number;image:string|null}>()):[];
 const bggImages=new Map(imageRows.map(row=>[row.bgg_id,row.image]));
 const notBggImages=new Map(gameRows.filter(row=>row.seq).map(row=>[row.seq,row.image]));
 const ownedRows=await db.prepare(`SELECT c.game_id,c.acquisition_status,CASE WHEN json_valid(c.notes) THEN json_extract(c.notes,'$.owned') END legacy_owned FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id LEFT JOIN notbgg_games n ON n.game_id=c.game_id WHERE c.record_scope='production' AND m.archived_at IS NULL AND n.archived_at IS NULL AND c.game_id IN(SELECT value FROM json_each(?))`).bind(JSON.stringify([...relatedIds])).all<{game_id:number;acquisition_status:string;legacy_owned:unknown}>();
 if(!ownedRows.success)throw new HttpError(503,'RELATIONS_UNAVAILABLE');
 const held=new Set(ownedRows.results.filter(c=>collectionOwned(c.acquisition_status,c.legacy_owned)).map(c=>c.game_id));
 const prefix=lang==='en'?'/en':'',rows:PublicLiveRelation[]=[];
 const seen=new Set<string>();
 function add(row:PublicLiveRelation,direction=''){
  const key=JSON.stringify([row.href,row.kind,row.source,direction]);
  if(seen.has(key))return;
  seen.add(key);
  rows.push(row);
 }
 function target(id:number|undefined,bggId:number|undefined,name:string){
  const g=id?gameRows.find(g=>g.id===id):gameRows.find(g=>g.bgg_id===bggId);
  if(g?.archived_at)return null;
  const linked=bggId?identity.byBgg.get(bggId):g?.seq?identity.byNotBgg.get(formatNotBggId(g.seq)):undefined;
  const href=linked?.primarySource==='notbgg'?prefix+'/games/notbgg/'+linked.notBggId.slice(7):linked?.primarySource==='bgg'?publicBggHref(linked.bggId,lang):g?.seq?prefix+'/games/notbgg/'+String(g.seq).padStart(6,'0'):bggId&&publicIds.includes(bggId)?publicBggHref(bggId,lang):bggId?'https://boardgamegeek.com/boardgame/'+bggId:null;
  if(!href)return null;
  const linkedIds=gameRows.filter(row=>linked&&(row.bgg_id===linked.bggId||row.seq===Number(linked.notBggId.slice(7)))).map(row=>row.id);
  const notBggSeq=linked?.primarySource==='notbgg'?Number(linked.notBggId.slice(7)):linked?.primarySource==='bgg'?null:g?.seq;
  const imageId=linked?.bggId??bggId;
  const staticGame=imageId?baseline.get(imageId):undefined;
  const image=notBggSeq?notBggImages.get(notBggSeq):
   imageId&&bggImages.has(imageId)?bggImages.get(imageId):staticGame?.thumbnail??staticGame?.image;
  return {name:g?.name??name,href,image:safeImage(typeof image==='string'?image:null),owned:!!g&&held.has(g.id)||linkedIds.some(id=>held.has(id))};
 }
 const visible=(edge:GameRelationEdge)=>{
  const outgoing=rootIds.has(edge.source_game_id),incoming=rootIds.has(edge.target_game_id);
  if(!outgoing&&!incoming)return null;
  const g=gameRows.find(g=>g.id===(outgoing?edge.target_game_id:edge.source_game_id));
  if(!g||rootIds.has(g.id)||g.archived_at)return null;
  const display=target(g.id,g.bgg_id??undefined,g.name??g.primary_name);
  return display ? {display,outgoing} : null;
 };
 const bggLinks=bggGameRelations(caches,typeRows,bgg).filter(link=>target(undefined,link.relatedBggId,link.relatedName));
 const effective=effectiveGameRelations(bggLinks,edgeRows.filter(e=>e.relation_source==='manual'&&visible(e)),siteRows.filter(visible),gameRows,identity);
 for(const edge of effective){
  if(edge.bgg){
   const link=edge.bgg,t=target(undefined,link.relatedBggId,link.relatedName)!;
   // Use the manual type on merged rows so the label describes the confirmed relationship.
   add({...t,source:'bgg',sources:edge.manual?['bgg','manual']:['bgg'],kind:edge.manual?.relation_type??link.kind,role:link.role});
   continue;
  }
  const stored=edge.manual??edge.site!;
  const {display,outgoing}=visible(stored)!;
  add({...display,source:'manual',sources:['manual'],kind:stored.relation_type,role:
   ['requires_base','expansion_of'].includes(stored.relation_type)?outgoing?'base':'expansion':'related'},
   stored.relation_type==='accessory_for' ? String(outgoing) : '');
 }
 // Retain the public projection of historical stored BGG rows.
 for(const edge of edgeRows.filter(e=>e.relation_source==='bgg')){
  const t=visible(edge);
  if(t)add({...t.display,source:'bgg',sources:['bgg'],kind:edge.relation_type,role:'related'});
 }
 return {relations:rows};
}
export async function handlePublicLiveRelations(request:Request,db:D1Database|undefined,key:string){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(request.method!=='GET')return Response.json({success:false,error:{code:'METHOD_NOT_ALLOWED'}},{status:405,headers});
 try{if(!db)throw new HttpError(503,'RELATIONS_UNAVAILABLE');const data=await readPublicLiveRelations(db,key,new URL(request.url).searchParams.get('lang')==='en'?'en':'zh-TW');return Response.json({success:true,data},{headers});}
 catch(error){return Response.json({success:false,error:{code:error instanceof HttpError?error.code:'RELATIONS_UNAVAILABLE'}},{status:error instanceof HttpError?error.status:503,headers});}
}
