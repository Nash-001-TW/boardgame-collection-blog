import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleSleeveAdminRequest } from '../../../lib/sleeve-admin-api';
import type { NotBggAdminBindings } from '../../../lib/notbgg-admin-api';
export const prerender = false;
export const ALL: APIRoute = ({request}) => handleSleeveAdminRequest(request,env as unknown as NotBggAdminBindings);
