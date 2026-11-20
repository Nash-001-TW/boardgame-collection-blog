import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {handlePurchaseAdminRequest} from '../../../lib/purchase-admin-api';
import type {NotBggAdminBindings} from '../../../lib/notbgg-admin-api';
export const prerender=false;
export const ALL:APIRoute=({request})=>handlePurchaseAdminRequest(request,env as unknown as NotBggAdminBindings);
