import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleCollectionAdminRequest } from '../../../../../../src/lib/collection-admin-api';
import type { NotBggAdminBindings } from '../../../../../../src/lib/notbgg-admin-api';
export const prerender=false;
export const ALL:APIRoute=({request})=>handleCollectionAdminRequest(request,env as unknown as NotBggAdminBindings);
