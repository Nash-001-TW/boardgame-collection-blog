import type { APIRoute } from 'astro';
import { env, waitUntil } from 'cloudflare:workers';
import { handleComponentPhotoWrite, type PhotoBindings } from '../../../../../lib/component-photo-api';

export const prerender = false;
export const ALL: APIRoute = ({ request }) => handleComponentPhotoWrite(request, env as unknown as PhotoBindings, waitUntil);
