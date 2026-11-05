import { handle } from '@astrojs/cloudflare/handler';
import { getGames } from './lib/games';
import { bggIdentityDecision } from './lib/bgg-identity-gateway';
const games=getGames();
export default {
 async fetch(request:Request,env:Env,context:ExecutionContext):Promise<Response>{
  let decision;try{decision=await bggIdentityDecision(request,env.DB,games);}catch{return new Response('Game identity is temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
  if(!decision)return handle(request,env,context);
  if(decision.redirect){const target=new URL(decision.redirect,request.url);target.search=new URL(request.url).search;return new Response(null,{status:307,headers:{Location:target.href,'Cache-Control':'no-store'}});}
  const assetRequest=new Request(request);
  assetRequest.headers.delete('If-None-Match');assetRequest.headers.delete('If-Modified-Since');
  const original=await handle(assetRequest,env,context);if(original.status!==200||!original.headers.get('Content-Type')?.includes('text/html'))return original;
  const response=new Response(original.body,original);response.headers.set('Cache-Control','no-store');
  response.headers.delete('ETag');response.headers.delete('Last-Modified');
  if(decision.unavailable)response.headers.set('X-Game-Identity','unavailable');
  if(request.method==='HEAD')return response;
  const canonical=new URL(decision.canonical,request.url).href;
  const escaped=canonical.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const identity=decision.identity;
  const rewrite=new HTMLRewriter().on('link[rel="canonical"]',{element(el){el.remove();}}).on('head',{element(el){el.append(`<link rel="canonical" href="${escaped}">`,{html:true});}});
  if(identity)rewrite.on('[data-detail-v2]',{element(el){el.prepend(`<p data-identity-notice>NotBGG: ${identity.notBggId} · BGG #${identity.bggId} · BGG primary / BGG 主要來源</p>`,{html:true});}});
  if(decision.unavailable)rewrite.on('[data-detail-v2]',{element(el){el.prepend('<p role="status">Identity resolution unavailable; showing the original BGG source. 身份解析暫時無法使用，目前顯示原始 BGG 資料。</p>',{html:true});}});
  rewrite.on('body',{element(el){el.append('<script>window.addEventListener("pageshow",function(e){if(e.persisted)location.reload()})</script>',{html:true});}});
  return rewrite.transform(response);
 }
};
