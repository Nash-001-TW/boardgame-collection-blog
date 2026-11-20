import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {readPublicBrowse} from '../../../lib/public-site-data';
import {HttpError} from '../../../lib/notbgg-admin-api';
export const prerender=false;
export const ALL:APIRoute=async({request})=>{
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
 if(request.method!=='GET')return Response.json({success:false,error:{code:'METHOD_NOT_ALLOWED'}},{status:405,headers});
 try{const p=new URL(request.url).searchParams;return Response.json({success:true,data:await readPublicBrowse(env.DB,p,p.get('lang')==='en'?'en':'zh-TW',p.get('view')==='collection')},{headers});}
 catch(error){return Response.json({success:false,error:{code:error instanceof HttpError?error.code:'PUBLIC_DATA_UNAVAILABLE'}},{status:error instanceof HttpError?error.status:503,headers});}
};
