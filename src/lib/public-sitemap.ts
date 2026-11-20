import {readPublicBrowse} from './public-site-data';
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export async function publicSitemap(db:D1Database|undefined,origin:string,page?:number){
 const headers={'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'};
 try{
  if(page!==undefined&&(!Number.isSafeInteger(page)||page<1||page>1000))return new Response('Not found',{status:404,headers});
  const data=await readPublicBrowse(db,new URLSearchParams({page:String(page??1)}),'zh-TW');
  if(page===undefined){const count=Math.max(1,Math.min(1000,Math.ceil(data.total/20)));return new Response('<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+Array.from({length:count},(_,i)=>'<sitemap><loc>'+escape(origin+'/sitemap/'+(i+1)+'.xml')+'</loc></sitemap>').join('')+'</sitemapindex>',{headers});}
  if(page>1&&!data.cards.length)return new Response('Not found',{status:404,headers});
  const paths=page===1?['/','/games','/collection','/blog','/about','/en/','/en/games','/en/collection','/en/blog','/en/about']:[];
  for(const card of data.cards)if(card.href)paths.push(card.href,'/en'+card.href);
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(paths)].map(path=>'<url><loc>'+escape(origin+path)+'</loc></url>').join('')+'</urlset>',{headers});
 }catch{return new Response('Sitemap temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}
