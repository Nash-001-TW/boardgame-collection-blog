import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {transform} from '@astrojs/compiler-rs';
import {experimental_AstroContainer} from 'astro/container';
import {normalizePublicRoute} from '../../src/lib/public-route-normalization.ts';

/** Actual public SSR route components; no Cloudflare config, dev server or live DB. */
export async function publicSitePreview(bindings:Record<string,unknown>){
 const scripts=new Map<string,{code:string;directory:string}>(),css=new Set<string>();
 async function compile(entry:string){
  const result=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'public-ssr',setup(builder){
   builder.onResolve({filter:/^cloudflare:workers$/},args=>({path:args.path,namespace:'bindings'}));builder.onLoad({filter:/.*/,namespace:'bindings'},()=>({contents:'export const env=TEST_BINDINGS;',loader:'js'}));
   builder.onLoad({filter:/\.css$/},async args=>{css.add(await readFile(args.path,'utf8'));return {contents:'',loader:'js'};});
   builder.onLoad({filter:/\.astro$/},async args=>{const filename=args.path.replaceAll('\\','/'),r=transform(await readFile(args.path,'utf8'),{filename,internalURL:'astro/compiler-runtime',resultScopedSlot:true,resolvePath:p=>p});if(r.diagnostics.some(d=>d.severity==='error'))throw new Error('Astro compile failed');r.css.forEach(c=>css.add(String(c)));r.scripts.forEach((script,index)=>{if(typeof script.code==='string')scripts.set(filename+':'+index,{code:script.code,directory:path.dirname(args.path)});});return {contents:r.code.replace(/^import ["'][^"']+\?astro&type=style[^"']*["'];?$/gm,''),loader:'ts'};});
  }}]});
  const module={exports:{} as {default:Parameters<experimental_AstroContainer['renderToString']>[0]}};new Function('TEST_BINDINGS','require','module','exports',result.outputFiles[0].text)(bindings,createRequire(import.meta.url),module,module.exports);return module.exports.default;
 }
 const pages=new Map<string,Awaited<ReturnType<typeof compile>>>();
 for(const [route,entry]of Object.entries({'home':'src/pages/index.astro','home-en':'src/pages/en/index.astro','games':'src/pages/games.astro','games-en':'src/pages/en/games.astro','collection':'src/pages/collection.astro','collection-en':'src/pages/en/collection.astro','detail':'src/pages/games/[slug].astro','detail-en':'src/pages/en/games/[slug].astro','numeric':'src/pages/games/bgg/[id].astro','numeric-en':'src/pages/en/games/bgg/[id].astro','notbgg':'src/pages/games/notbgg/[id].astro','notbgg-en':'src/pages/en/games/notbgg/[id].astro'}))pages.set(route,await compile(entry));
 const javascript=(await build({stdin:{contents:[...scripts.keys()].map(id=>'import '+JSON.stringify('script:'+id)+';').join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'scripts',setup(builder){builder.onResolve({filter:/^script:/},args=>({path:args.path.slice(7),namespace:'script'}));builder.onLoad({filter:/.*/,namespace:'script'},args=>{const script=scripts.get(args.path)!;return {contents:script.code,loader:'ts',resolveDir:script.directory};});}}]})).outputFiles[0].text;
 const container=await experimental_AstroContainer.create();
 return {javascript,async render(request:Request){
  const redirect=normalizePublicRoute(request);if(redirect)return new Response(null,{status:307,headers:{Location:redirect+new URL(request.url).search,'Cache-Control':'no-store'}});
  const url=new URL(request.url),en=/^\/en(?:\/|$)/.test(url.pathname),suffix=en?'-en':'',p=url.pathname.replace(/^\/en(?=\/|$)/,'')||'/';
  let key=p==='/'?'home':p==='/games'?'games':p==='/collection'?'collection':'',params:Record<string,string>={};
  let match=p.match(/^\/games\/(bgg|notbgg)\/([^/]+)\/?$/);if(match){key=match[1]==='bgg'?'numeric':'notbgg';params={id:match[2]};}
  else if((match=p.match(/^\/games\/([^/]+)\/?$/))){key='detail';params={slug:decodeURIComponent(match[1])};}
  const component=pages.get(key+suffix);if(!component)return new Response('Not found',{status:404});
  const r=await container.renderToResponse(component,{request,params}),headers=new Headers(r.headers);headers.delete('Content-Length');
  const html=(await r.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</head>','<style>'+[...css].join('\n')+'</style></head>').replace('</body>','<script src="/public-site.js"></script></body>');
  return new Response(html,{status:r.status,headers});
 }};
}
