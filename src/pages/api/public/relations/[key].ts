import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {handlePublicLiveRelations} from '../../../../lib/public-live-relations';
export const prerender=false;
export const ALL:APIRoute=({request,params})=>handlePublicLiveRelations(request,env.DB,params.key??'');
