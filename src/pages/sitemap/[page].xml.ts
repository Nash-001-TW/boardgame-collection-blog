import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {publicSitemap} from '../../lib/public-sitemap';
export const prerender=false;
export const GET:APIRoute=({url,params})=>publicSitemap(env.DB,url.origin,Number(params.page));
