import {getGames,type GameDetailModel} from './games';
import type {BggGameData,BggLink,BggRelationLink} from './bgg-types';
import {safeImage,resolveNotBggPage} from './notbgg-public';
import {formatNotBggId,isBggId} from './game-identity';
import {HttpError} from './notbgg-admin-api';
import {translateGameName} from '../i18n/utils';

/** Public read policy: static registrations remain public. New live BGG entries need
 * successful metadata plus an active production collection or confirmed public identity.
 * Every response is no-store; success commits are visible on the next request. */
const staticGames=getGames();
export const publicMetadataRegistry=JSON.stringify(staticGames.filter(g=>g.bgg).map(g=>({id:g.bggId,slug:g.slug,meta:{name:g.bgg!.name,localName:translateGameName(g.bggId,g.bgg!.name,'zh-TW'),alternativeNames:g.bgg!.alternativeNames??[],year:g.bgg!.year,gameType:g.bgg!.gameType,
 thumbnail:g.bgg!.thumbnail||g.bgg!.image,minPlayers:g.bgg!.minPlayers,maxPlayers:g.bgg!.maxPlayers,minPlayTime:g.bgg!.minPlayTime,maxPlayTime:g.bgg!.maxPlayTime,averageRating:g.bgg!.averageRating,averageWeight:g.bgg!.averageWeight,mechanics:g.bgg!.mechanics}})));
const active=`c.record_scope='production' AND m.archived_at IS NULL AND n.archived_at IS NULL`;
const newQualification=`EXISTS(SELECT 1 FROM v2_games g JOIN v2_collection_items c ON c.game_id=g.id
 LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id LEFT JOIN notbgg_games n ON n.game_id=g.id
 WHERE g.bgg_id=b.bgg_id AND ${active}) OR EXISTS(SELECT 1 FROM notbgg_bgg_links l JOIN notbgg_games n ON n.seq=l.seq
 WHERE l.candidate_bgg_id=b.bgg_id AND l.status='linked' AND n.archived_at IS NULL)`;
export const publicStaticMetadataSql = "static AS MATERIALIZED(SELECT CAST(json_extract(value,'$.id') AS INTEGER) id,json_extract(value,'$.slug') slug,json_extract(value,'$.meta') meta FROM json_each(?))";
export const publicBggMetadataSql = "CASE WHEN b.last_success_at IS NOT NULL AND b.cache_json IS NOT NULL THEN b.cache_json ELSE s.meta END";
export const publicBggPresentationSql = {"image":"COALESCE(json_extract(b.meta,'$.thumbnail'),json_extract(b.meta,'$.image'))","minPlayers":"json_extract(b.meta,'$.minPlayers')","maxPlayers":"json_extract(b.meta,'$.maxPlayers')"};
export const publicNotBggPresentationSql = {"image":"COALESCE(n.thumbnail_url,n.image_url)","minPlayers":"n.min_players","maxPlayers":"n.max_players"};
const cte=`WITH ${publicStaticMetadataSql},
 ids AS MATERIALIZED(SELECT id FROM static UNION SELECT b.bgg_id FROM bgg_games b WHERE b.cache_json IS NOT NULL AND b.last_success_at IS NOT NULL AND (${newQualification})),
 links AS MATERIALIZED(SELECT l.seq,l.candidate_bgg_id,l.primary_source FROM notbgg_bgg_links l JOIN notbgg_games n ON n.seq=l.seq JOIN ids ON ids.id=l.candidate_bgg_id WHERE l.status='linked' AND n.archived_at IS NULL),
 bgg AS MATERIALIZED(SELECT ids.id,s.slug,json_extract(s.meta,'$.localName') local_name,${publicBggMetadataSql} meta,
 CASE WHEN b.last_success_at IS NOT NULL AND b.cache_json IS NOT NULL THEN 'D1' ELSE 'static' END origin FROM ids LEFT JOIN static s ON s.id=ids.id LEFT JOIN bgg_games b ON b.bgg_id=ids.id),
 catalog AS MATERIALIZED(
 SELECT 'BGG:'||b.id key,'bgg' source,b.id bgg_id,NULL seq,b.slug,b.origin,json_extract(b.meta,'$.name') name,
 COALESCE(json_extract(b.meta,'$.alternativeNames'),'[]')||' '||COALESCE(b.local_name,'') aliases,${publicBggPresentationSql.image} image,
 json_extract(b.meta,'$.year') year,CASE json_extract(b.meta,'$.gameType') WHEN 'boardgameexpansion' THEN 'expansion' WHEN 'boardgameaccessory' THEN 'accessory' ELSE 'boardgame' END type,
 ${publicBggPresentationSql.minPlayers} min_players,${publicBggPresentationSql.maxPlayers} max_players,json_extract(b.meta,'$.minPlayTime') min_time,json_extract(b.meta,'$.maxPlayTime') max_time,
 json_extract(b.meta,'$.averageRating') rating,json_extract(b.meta,'$.averageWeight') weight,COALESCE(json_extract(b.meta,'$.mechanics'),'[]') mechanics,'[]' accessories
 FROM bgg b WHERE NOT EXISTS(SELECT 1 FROM links l WHERE l.candidate_bgg_id=b.id AND l.primary_source='notbgg')
 UNION ALL
 SELECT 'NotBGG:'||printf('%06d',n.seq),'notbgg',NULL,n.seq,NULL,'NotBGG',n.name,n.alternate_names_json,${publicNotBggPresentationSql.image},n.year_published,
 CASE n.type WHEN 'boardgameaccessory' THEN 'accessory' WHEN 'boardgameexpansion' THEN 'expansion' ELSE 'boardgame' END,${publicNotBggPresentationSql.minPlayers},${publicNotBggPresentationSql.maxPlayers},n.min_playtime,n.max_playtime,NULL,NULL,n.mechanics_json,COALESCE((SELECT json_group_array(category) FROM notbgg_accessory_categories WHERE seq=n.seq),'[]')
 FROM notbgg_games n WHERE n.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM links l WHERE l.seq=n.seq AND l.primary_source='bgg'))`;
const legacyOwned=`CASE lower(CAST(CASE WHEN json_valid(c.notes) THEN json_extract(c.notes,'$.owned') END AS TEXT)) WHEN 'true' THEN 1 WHEN '1' THEN 1 WHEN 'false' THEN 0 WHEN '0' THEN 0 ELSE c.acquisition_status='owned' END`;
const matchCatalog=`(g.bgg_id=k.bgg_id OR n.seq=k.seq OR EXISTS(SELECT 1 FROM links l WHERE
 (l.candidate_bgg_id=k.bgg_id AND l.seq=n.seq) OR (l.seq=k.seq AND l.candidate_bgg_id=g.bgg_id)))`;
const flag=(predicate:string)=>`EXISTS(SELECT 1 FROM v2_collection_items c JOIN v2_games g ON g.id=c.game_id LEFT JOIN notbgg_games n ON n.game_id=g.id LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id WHERE ${active} AND ${matchCatalog} AND (${predicate}))`;
const decorated=`SELECT k.*,${flag(legacyOwned)} owned,${flag('c.wishlist=1')} wishlist,${flag("c.acquisition_status='preordered'")} preordered FROM catalog k`;

export interface PublicCard {key:string;source:string;name:string;href:string|null;image:string|null;type:string;year:number|null;minPlayers:number|null;maxPlayers:number|null;minTime:number|null;maxTime:number|null;rating:number|null;weight:number|null;owned:boolean;wishlist:boolean;preordered:boolean;collectionId?:number;origin:string;status?:string}
function number(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;}
export function publicBggHref(id:number,lang:'en'|'zh-TW'){return (lang==='en'?'/en':'')+'/games/'+(staticGames.find(g=>g.bggId===id&&g.bgg)?.slug?'': 'bgg/')+(staticGames.find(g=>g.bggId===id&&g.bgg)?.slug??id);}
function card(row:Record<string,unknown>,lang:'en'|'zh-TW'):PublicCard{
 const source=String(row.source??'missing'),key=String(row.key??(row.collection_id?'collection:'+row.collection_id:''));
 const name=String(row.display_name??row.name??'');
 return {key,source,name:row.display_name==null&&source==='bgg'?translateGameName(Number(row.bgg_id),name,lang):name,href:source==='bgg'?publicBggHref(Number(row.bgg_id),lang):source==='notbgg'?(lang==='en'?'/en':'')+'/games/notbgg/'+String(row.seq).padStart(6,'0'):null,image:safeImage(typeof row.image==='string'?row.image:null),type:String(row.type??'unknown'),year:number(row.year),minPlayers:number(row.min_players),maxPlayers:number(row.max_players),minTime:number(row.min_time),maxTime:number(row.max_time),rating:number(row.rating),weight:number(row.weight),owned:row.owned===1,wishlist:row.wishlist===1,preordered:row.preordered===1,origin:String(row.origin??'unavailable'),...(row.collection_id?{collectionId:Number(row.collection_id),status:String(row.acquisition_status)}:{})};
}
export async function readPublicBrowse(db:D1Database|undefined,params:URLSearchParams,lang:'en'|'zh-TW',collection=false){
 if(!db)throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');
 const q=(params.get('q')??'').trim(),source=params.get('source')??'all',accessory=params.get('accessory')??'',type=accessory?'accessory':params.get('type')??params.get('filter')??'all',status=params.get('status')??'all',rawSort=params.get('sort')??'name',sort=({'name-asc':'name','year-desc':'year','bgg-rating-desc':'rating','weight-desc':'weight'} as Record<string,string>)[rawSort]??rawSort,page=Number(params.get('page')||1),plus=params.get('players')==='6plus',players=plus?6:Number(params.get('players')||0);
 const time=params.get('time')??'',weight=params.get('weight')??'';let mechanic=(params.get('mechanic')??'').trim();
 if(mechanic.startsWith('notbgg:')){try{mechanic=decodeURIComponent(mechanic.slice(7));}catch{throw new HttpError(400,'INVALID_PUBLIC_QUERY');}}
 if(q.length>100||mechanic.length>120||!['','upgrade','playmat','storage','promo','sleeves','miniatures','tokens','other'].includes(accessory)||!['','30','31-60','61-120','over120','60','90','120'].includes(time)||!['','1-2','2-3','3-4','4-5'].includes(weight)||!['all','bgg','notbgg'].includes(source)||!['all','boardgame','expansion','accessory'].includes(type)||!['all','owned','wishlist','preordered'].includes(status)||!['name','name-desc','year','year-asc','rating','weight'].includes(sort)||!Number.isSafeInteger(page)||page<1||page>1000||!Number.isSafeInteger(players)||players<0||players>100)throw new HttpError(400,'INVALID_PUBLIC_QUERY');
 const timeMin=time==='31-60'?30:time==='61-120'?60:time==='over120'?120:0,timeMax=time==='31-60'?60:time==='61-120'?120:time==='over120'?100000:Number(time)||100000;
 const [weightMin,weightMax]=weight?weight.split('-').map(Number):[0,5];
 let base=`SELECT d.*,NULL display_name FROM (${decorated}) d`;
 if(collection)base=`SELECT k.*,c.id collection_id,c.display_name,c.acquisition_status,${legacyOwned} owned,c.wishlist,c.acquisition_status='preordered' preordered
 FROM v2_collection_items c LEFT JOIN v2_games g ON g.id=c.game_id LEFT JOIN notbgg_games n ON n.game_id=g.id LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
 LEFT JOIN links l ON l.seq=n.seq OR l.candidate_bgg_id=g.bgg_id
 LEFT JOIN catalog k ON k.key=CASE WHEN l.primary_source='notbgg' THEN 'NotBGG:'||printf('%06d',l.seq) WHEN l.primary_source='bgg' THEN 'BGG:'||l.candidate_bgg_id WHEN n.seq IS NOT NULL THEN 'NotBGG:'||printf('%06d',n.seq) ELSE 'BGG:'||g.bgg_id END WHERE ${active}`;
 const selected=`${cte}, selected AS(${base}), filtered AS(SELECT * FROM selected WHERE (?='' OR instr(lower(COALESCE(name,'')||' '||COALESCE(display_name,'')||' '||COALESCE(aliases,'')||' '||COALESCE(key,'')),lower(?))>0)
 AND (?='all' OR source=?) AND (?='all' OR type=?) AND (?='all' OR (?='owned' AND owned=1) OR (?='wishlist' AND wishlist=1) OR (?='preordered' AND preordered=1)) AND (?=0 OR ((min_players<=? OR ?=1) AND max_players>=?))
 AND (?='' OR (max_time>? AND max_time<=?)) AND (?='' OR (weight>=? AND (weight<? OR (?=5 AND weight=5))))
 AND (?='' OR EXISTS(SELECT 1 FROM json_each(COALESCE(mechanics,'[]')) j WHERE CAST(CASE WHEN j.type='object' THEN json_extract(j.value,'$.id') ELSE j.value END AS TEXT)=? OR instr(lower(CASE WHEN j.type='object' THEN json_extract(j.value,'$.name') ELSE j.value END),lower(?))>0))
 AND (?='' OR EXISTS(SELECT 1 FROM json_each(COALESCE(accessories,'[]')) WHERE value=?)))`;
 // Give the game listing the same public column set without reading any collection notes.
 const sql=selected;
 const args=[publicMetadataRegistry,q,q,source,source,type,type,status,status,status,status,players,players,Number(plus),players,time,timeMin,timeMax,weight,weightMin,weightMax,weightMax,mechanic,mechanic,mechanic,accessory,accessory];
 const ordering=sort==='name'?'COALESCE(display_name,name) COLLATE NOCASE ASC':sort==='name-desc'?'COALESCE(display_name,name) COLLATE NOCASE DESC':sort==='year'?'year DESC':sort==='year-asc'?'year IS NULL,year ASC':sort==='rating'?'rating DESC':'weight DESC';
 const [rows,count]=await Promise.all([db.prepare(`${sql} SELECT * FROM filtered ORDER BY ${ordering},key,${collection?'collection_id':'source'} LIMIT 20 OFFSET ?`).bind(...args,(page-1)*20).all<Record<string,unknown>>(),db.prepare(`${sql} SELECT COUNT(*) total FROM filtered`).bind(...args).first<{total:number}>()]);
 if(!rows.success||!count||!Number.isSafeInteger(count.total))throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');
 return {cards:rows.results.map(row=>card(row,lang)),total:count.total,page,pageSize:20,collection};
}

/** Drop any unexpected cache properties before passing metadata into SSR components. */
export function publicBggMetadata(value:unknown,id:number):BggGameData{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');const g=value as Record<string,unknown>;
 if(g.bggId!==id||typeof g.name!=='string'||!g.name.trim()||!['boardgame','boardgameexpansion','boardgameaccessory'].includes(String(g.gameType)))throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');
 const links=(name:string,relation=false):(BggLink|BggRelationLink)[]=>Array.isArray(g[name])?(g[name] as Record<string,unknown>[]).filter(x=>x&&isBggId(x.id)&&typeof x.name==='string').map(x=>({id:Number(x.id),name:String(x.name),...(relation&&typeof x.inbound==='boolean'?{inbound:x.inbound}:{})})):[];
 const n=(name:string)=>number(g[name])??undefined;
 return {bggId:id,gameType:String(g.gameType),name:g.name,alternativeNames:Array.isArray(g.alternativeNames)?g.alternativeNames.filter((x):x is string=>typeof x==='string'):[],description:typeof g.description==='string'?g.description:'',year:n('year')??0,image:safeImage(g.image as string)??undefined,thumbnail:safeImage(g.thumbnail as string)??undefined,minPlayers:n('minPlayers')??0,maxPlayers:n('maxPlayers')??0,minPlayTime:n('minPlayTime')??0,maxPlayTime:n('maxPlayTime')??0,minAge:n('minAge'),averageWeight:n('averageWeight'),complexity:['Unknown','Light','Medium Light','Medium','Medium Heavy','Heavy'].includes(String(g.complexity))?g.complexity as BggGameData['complexity']:'Unknown',bestPlayerCounts:Array.isArray(g.bestPlayerCounts)?g.bestPlayerCounts.filter((x):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0):[],designers:links('designers'),artists:links('artists'),publishers:links('publishers'),categories:links('categories'),mechanics:links('mechanics'),families:links('families'),expansions:links('expansions',true),implementations:links('implementations',true),compilations:links('compilations',true),isExpansion:g.isExpansion===true,averageRating:n('averageRating'),usersRated:n('usersRated'),bggRating:n('bggRating'),overallRank:n('overallRank'),categoryRanks:Array.isArray(g.categoryRanks)?g.categoryRanks.filter(x=>x&&typeof x==='object'&&isBggId(x.id)&&typeof x.name==='string').map(x=>({id:x.id,name:x.name,friendlyName:typeof x.friendlyName==='string'?x.friendlyName:'',rank:number(x.rank)??undefined,bayesAverage:number(x.bayesAverage)??undefined})):[]};
}
export async function readPublicBgg(db:D1Database|undefined,id:number,lang:'en'|'zh-TW'){
 if(!isBggId(id))throw new HttpError(404,'GAME_NOT_FOUND');if(!db)throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');
 const row=await db.prepare(`${cte} SELECT b.meta,b.origin,l.seq,l.primary_source FROM bgg b LEFT JOIN links l ON l.candidate_bgg_id=b.id WHERE b.id=?`).bind(publicMetadataRegistry,id).first<{meta:string;origin:string;seq:number|null;primary_source:string|null}>();
 if(!row)return null;
 if(row.seq&&row.primary_source==='notbgg')return {redirect:(lang==='en'?'/en':'')+'/games/notbgg/'+String(row.seq).padStart(6,'0'),game:null,origin:row.origin};
 // Slim static listing metadata is not a substitute for the original full static detail.
 let metadata:unknown;if(row.origin==='D1'){try{metadata=JSON.parse(row.meta);}catch{throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');}}else metadata=staticGames.find(g=>g.bggId===id)?.bgg;
 const bgg=publicBggMetadata(metadata,id),slug=staticGames.find(g=>g.bggId===id&&g.bgg)?.slug??'bgg/'+id;
 return {redirect:null,game:{bggId:id,slug,name:bgg.name,bgg} satisfies GameDetailModel,origin:row.origin};
}
export function bggRouteId(slug:string){return staticGames.find(g=>g.slug===slug&&g.bgg)?.bggId??(/^bgg-[1-9]\d*$/.test(slug)?Number(slug.slice(4)):null);}
export async function readPublicNotBgg(db:D1Database|undefined,id:number,lang:'en'|'zh-TW'){
 if(!Number.isSafeInteger(id)||id<1)return {detail:null,identity:null,redirect:null};
 // A confirmed BGG primary may now live in D1 without a build-time registration.
 if(!db)throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');
 const link=await db.prepare(`SELECT l.candidate_bgg_id FROM notbgg_bgg_links l JOIN notbgg_games n ON n.seq=l.seq WHERE l.seq=? AND l.status='linked' AND l.primary_source='bgg' AND n.archived_at IS NULL`).bind(id).first<{candidate_bgg_id:number}>();
 if(link){const bgg=await readPublicBgg(db,link.candidate_bgg_id,lang);if(bgg?.game)return {detail:null,identity:null,redirect:publicBggHref(link.candidate_bgg_id,lang)};}
 return resolveNotBggPage(db,formatNotBggId(id),staticGames,lang);
}
export async function readPublicOverview(db:D1Database|undefined){
 if(!db)throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');
 const row=await db.prepare(`SELECT COUNT(*) records,COALESCE(SUM(${legacyOwned}),0) owned,COALESCE(SUM(c.wishlist=1),0) wishlist,COALESCE(SUM(c.acquisition_status='preordered'),0) preordered FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id LEFT JOIN notbgg_games n ON n.game_id=c.game_id WHERE ${active}`).first<{records:number;owned:number;wishlist:number;preordered:number}>();
 if(!row)throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');return row;
}
/** Only identity keys, never all collection rows or raw metadata. */
export async function readPublicBggIndex(db:D1Database){
 const result=await db.prepare(`${cte} SELECT id FROM bgg ORDER BY id LIMIT 20001`).bind(publicMetadataRegistry).all<{id:number}>();
 if(!result.success||result.results.length>20000)throw new HttpError(503,'PUBLIC_DATA_UNAVAILABLE');return result.results.map(r=>r.id);
}
export async function publicBggRoute(db:D1Database|undefined,url:URL,id:number|null,lang:'en'|'zh-TW'){
 let data:Awaited<ReturnType<typeof readPublicBgg>>=null,unavailable=false;
 try{if(id)data=await readPublicBgg(db,id,lang);}catch(error){if(!(error instanceof HttpError&&error.status===404))unavailable=true;}
 const canonical=data?.game?publicBggHref(data.game.bggId,lang):null;
 const redirect=data?.redirect??(canonical&&url.pathname.replace(/\/$/,'')!==canonical?canonical:null);
 return {data,unavailable,status:unavailable?503:data?.game?200:404,redirect:redirect?redirect+url.search:null};
}
export async function publicNotBggRoute(db:D1Database|undefined,url:URL,id:number,lang:'en'|'zh-TW'){
 let result:Awaited<ReturnType<typeof readPublicNotBgg>>|undefined,unavailable=false;
 try{result=await readPublicNotBgg(db,id,lang);}catch{unavailable=true;}
 const canonical=result?.detail?(lang==='en'?'/en':'')+'/games/notbgg/'+String(id).padStart(6,'0'):null;
 const redirect=result?.redirect??(canonical&&url.pathname.replace(/\/$/,'')!==canonical?canonical:null);
 return {result,unavailable,status:unavailable?503:result?.detail?200:404,redirect:redirect?redirect+url.search:null};
}
