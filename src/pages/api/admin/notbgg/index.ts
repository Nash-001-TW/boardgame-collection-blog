import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleNotBggAdminRequest } from '../../../../lib/notbgg-admin-api';
export const prerender = false;
export const ALL: APIRoute = ({ request }) => handleNotBggAdminRequest(request, env as unknown as import('../../../../lib/notbgg-admin-api').NotBggAdminBindings);
