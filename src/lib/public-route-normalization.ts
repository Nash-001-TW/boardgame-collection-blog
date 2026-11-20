import {bggRouteId,publicBggHref} from './public-site-data';
/** Compatibility aliases only. No asset fetch and no identity/cache fallback here. */
export function normalizePublicRoute(request:Request){
 if(!['GET','HEAD'].includes(request.method))return null;const url=new URL(request.url);let path;try{path=decodeURIComponent(url.pathname).replace(/\/{2,}/g,'/');}catch{return null;}
 const numeric=path.match(/^\/(en\/)?games\/bgg\/([1-9]\d*)(?:\/index\.html)?\/?$/);
 let canonical:string|undefined;
 if(numeric)canonical=publicBggHref(Number(numeric[2]),numeric[1]?'en':'zh-TW');
 else{const match=path.match(/^\/(en\/)?games\/([^/]+)(?:\/index\.html)?\/?$/);if(match){const exact=bggRouteId(match[2]),id=exact??(match[2].endsWith('.html')?bggRouteId(match[2].slice(0,-5)):null);if(id)canonical=publicBggHref(id,match[1]?'en':'zh-TW');}}
 return canonical&&url.pathname!==canonical&&url.pathname!==canonical+'/'?canonical:null;
}
