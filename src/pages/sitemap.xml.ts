import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {publicSitemap} from '../lib/public-sitemap';
export const prerender=false;
export const GET:APIRoute=({url})=>publicSitemap(env.DB,url.origin);
