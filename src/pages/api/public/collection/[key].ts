import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handlePublicGameCollection } from '../../../../lib/public-game-collection';
export const prerender=false;
export const ALL:APIRoute=({request,params})=>handlePublicGameCollection(request,env,params.key??'');
