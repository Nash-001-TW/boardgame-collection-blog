import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleCollectionCopiesRequest } from '../../../../../lib/collection-copies-api';
import type { NotBggAdminBindings } from '../../../../../lib/notbgg-admin-api';
export const prerender=false;
export const ALL:APIRoute=({request})=>handleCollectionCopiesRequest(request,env as unknown as NotBggAdminBindings);
