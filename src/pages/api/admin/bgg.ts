import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {handleBggAdminRequest} from '../../../lib/bgg-admin-api';
import type {NotBggAdminBindings} from '../../../lib/notbgg-admin-api';
export const prerender=false;
export const ALL:APIRoute=({request})=>handleBggAdminRequest(request,env as unknown as NotBggAdminBindings);
