
import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { verifyAccessAdmin } from './lib/auth/cloudflare-access';

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;

  // 只保護管理後台與管理 API
  const isAdminRoute =
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/api/admin' ||
    pathname.startsWith('/api/admin/');

  if (!isAdminRoute) {
    return next();
  }

  // 所有拒絕回應禁止快取
  const forbidden = () =>
    new Response('Forbidden', {
      status: 403,
      headers: {
        'Cache-Control': 'no-store'
      }
    });

  // Cloudflare Workers 環境
  if (!env) {
    return forbidden();
  }

  const bindings = env as unknown as Record<string, unknown>;

  // ============================================
  // 本地開發專用
  // 必須同時符合三項條件
  // ============================================
  const hostname = context.url.hostname;

  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';

  const allowLocalAdmin =
    import.meta.env.DEV &&
    isLoopback &&
    bindings.LOCAL_ADMIN_DEV === 'true';

  if (allowLocalAdmin) {
    const response = await next();
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  // ============================================
  // 正式環境：Cloudflare Access JWT 驗證
  // ============================================
  const token = context.request.headers.get(
    'Cf-Access-Jwt-Assertion'
  );

  const admin = await verifyAccessAdmin(token, {
    teamDomain: String(bindings.ACCESS_TEAM_DOMAIN ?? ''),
    audience: String(bindings.ACCESS_AUD ?? ''),
    adminEmail: String(bindings.ADMIN_EMAIL ?? '')
  });

  if (!admin) {
    return forbidden();
  }

  const response = await next();
  response.headers.set('Cache-Control', 'no-store');

  return response;
});
