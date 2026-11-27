import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handlePublicGameCollection } from '../../../../lib/public-game-collection';
export const prerender=false;
// The client sends encodeURIComponent('BGG:123'); the Workers runtime passes the route param still percent-encoded.
// Decode once; malformed input falls through unchanged and is rejected by deserializeGameRef as INVALID_GAME_ID.
function decodeKey(key:string|undefined){try{return decodeURIComponent(key??'');}catch{return key??'';}}
export const ALL:APIRoute=({request,params})=>handlePublicGameCollection(request,env,decodeKey(params.key));
