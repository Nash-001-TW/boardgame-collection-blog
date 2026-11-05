import type { Game } from './game-catalog';
import { publicIdentityIndex } from './identity-resolution';
/** Keep existing prerendered BGG pages. Only the identity decision precedes static asset delivery. */
export async function bggIdentityDecision(request:Request,db:D1Database|undefined,games:readonly Game[]){
 if(!['GET','HEAD'].includes(request.method))return null;
 const url=new URL(request.url);
 // ASSETS decodes paths and collapses duplicate slashes before matching HTML.
 // Resolve that same path once, before its .html/index.html aliases reach ASSETS.
 let pathname:string;try{pathname=decodeURIComponent(url.pathname).replace(/\/{2,}/g,'/');}catch{return null;}
 const match=pathname.match(/^\/(en\/)?games\/([^/]+)(?:\/index\.html)?\/?$/);if(!match)return null;
 // Prefer a real slug verbatim, including a genuine slug ending in .html.
 const game=games.find(g=>g.slug===match[2]&&g.bgg)??(match[2].endsWith('.html')?games.find(g=>g.slug===match[2].slice(0,-5)&&g.bgg):undefined);if(!game)return null;
 const canonical=`${match[1]?'/en':''}/games/${encodeURIComponent(game.slug)}`;
 const alias=url.pathname!==canonical&&url.pathname!==canonical+'/';
 if(!db)return {canonical,identity:null,unavailable:true,redirect:alias?canonical:null};
 const link=(await publicIdentityIndex(db,games)).byBgg.get(game.bggId)??null;
 return {canonical,identity:link,unavailable:false,redirect:link?.primarySource==='notbgg'?`${match[1]?'/en':''}/games/notbgg/${link.notBggId.slice(7)}`:alias?canonical:null};
}
