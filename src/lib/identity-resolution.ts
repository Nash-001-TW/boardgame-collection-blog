import type { Game } from './game-catalog';
import { formatNotBggId,gameCatalogKey,type GameRef,type NotBggId } from './game-identity';
import { translateGameName } from '../i18n/utils';
export interface PublicIdentityLink {notBggId:NotBggId;bggId:number;primarySource:'notbgg'|'bgg';name:string;image:string|null}
export interface IdentityIndex {byNotBgg:Map<string,PublicIdentityLink>;byBgg:Map<number,PublicIdentityLink>}
/** Public whitelist only. No candidates, actors, notes, history or internal game IDs. */
export async function publicIdentityIndex(db:D1Database,games:readonly Game[]):Promise<IdentityIndex>{
 const valid=new Set(games.filter(g=>g.bgg).map(g=>g.bggId));
 const rows=await db.prepare(`SELECT n.seq,l.candidate_bgg_id,l.primary_source,n.name,COALESCE(n.thumbnail_url,n.image_url) image FROM notbgg_bgg_links l JOIN notbgg_games n ON n.seq=l.seq WHERE l.status='linked' AND n.archived_at IS NULL`).all<{seq:number;candidate_bgg_id:number;primary_source:'notbgg'|'bgg';name:string;image:string|null}>();
 const byNotBgg=new Map<string,PublicIdentityLink>(),byBgg=new Map<number,PublicIdentityLink>();
 for(const row of rows.results){if(!valid.has(row.candidate_bgg_id))continue;const link={notBggId:formatNotBggId(row.seq),bggId:row.candidate_bgg_id,primarySource:row.primary_source,name:row.name,image:row.image};byNotBgg.set(link.notBggId,link);byBgg.set(link.bggId,link);}
 return {byNotBgg,byBgg};
}
export function resolvePublicIdentity(ref:GameRef,index:IdentityIndex,games:readonly Game[],lang:'en'|'zh-TW'){
 const link=ref.source==='bgg'?index.byBgg.get(ref.bggId):index.byNotBgg.get(ref.notBggId);if(!link)return null;
 const bgg=games.find(g=>g.bggId===link.bggId&&g.bgg)!;
 return {key:link.notBggId,originalKey:gameCatalogKey(ref),name:link.primarySource==='notbgg'?link.name:translateGameName(bgg.bggId,bgg.name,lang),
  href:link.primarySource==='notbgg'?`${lang==='en'?'/en':''}/games/notbgg/${link.notBggId.slice(7)}`:`${lang==='en'?'/en':''}/games/${encodeURIComponent(bgg.slug)}`,
  image:link.primarySource==='notbgg'?link.image:bgg.bgg?.thumbnail||bgg.bgg?.image||null,link};
}
