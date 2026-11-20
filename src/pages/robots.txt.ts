import type {APIRoute} from 'astro';
export const prerender=false;
export const GET:APIRoute=({url})=>new Response('User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: '+url.origin+'/sitemap.xml\n',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
