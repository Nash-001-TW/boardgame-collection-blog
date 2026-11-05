import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleNotBggLinkRequest } from '../../../../../../lib/notbgg-link-api';
import type { NotBggAdminBindings } from '../../../../../../lib/notbgg-admin-api';
export const prerender=false;
export const ALL:APIRoute=({request})=>handleNotBggLinkRequest(request,env as unknown as NotBggAdminBindings);
