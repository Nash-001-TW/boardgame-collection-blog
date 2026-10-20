import type { APIRoute } from 'astro';

// 此 API 必須先通過 src/middleware.ts 的管理員驗證。
export const prerender = false;

export const GET: APIRoute = () => {
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
