import type { APIRoute } from 'astro';

import { env } from 'cloudflare:workers';
import { authorizeAdminRequest } from '../../../lib/auth/admin-request';

// Independently verify Access even when invoked without middleware.
export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const authorization = await authorizeAdminRequest(request, env as unknown as Record<string, unknown>);
  if (!('admin' in authorization)) return Response.json({ success: false, error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, {
    status: authorization.status, headers: { 'Cache-Control': 'no-store' }
  });
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Admin authentication passed'
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }
  );
};
