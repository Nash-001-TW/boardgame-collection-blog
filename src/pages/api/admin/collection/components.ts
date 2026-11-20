import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handlePhysicalComponentRequest } from '../../../../lib/physical-component-admin-api';
import type { NotBggAdminBindings } from '../../../../lib/notbgg-admin-api';

export const prerender = false;
export const ALL: APIRoute = ({ request }) =>
    handlePhysicalComponentRequest(request, env as unknown as NotBggAdminBindings);
