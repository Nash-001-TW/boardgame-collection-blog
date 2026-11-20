import {handle} from '@astrojs/cloudflare/handler';
import {normalizePublicRoute} from './lib/public-route-normalization';
// Astro dynamic pages own identity resolution and current metadata.
export default {async fetch(request:Request,env:Env,context:ExecutionContext){
 const normalized=normalizePublicRoute(request);
 if(normalized){const target=new URL(normalized,request.url);target.search=new URL(request.url).search;return new Response(null,{status:307,headers:{Location:target.href,'Cache-Control':'no-store'}});}
 return handle(request,env,context);
}};
