import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleComponentPhotoRead, type PhotoBindings } from '../../../../../lib/component-photo-api';

export const prerender = false;
export const ALL: APIRoute = ({ request, params }) => handleComponentPhotoRead(request, env as unknown as PhotoBindings, params.key ?? '', true);
