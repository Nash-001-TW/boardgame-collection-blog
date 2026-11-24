import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler-rs';
import { experimental_AstroContainer } from 'astro/container';

/** Test-only injected bindings; real Astro pages and real middleware, no dev exemption. */
export async function dashboardPreview(bindings: Record<string, unknown>) {
    async function compile(entry: string) {
        const css: string[] = [];
        const compiled = await build({ entryPoints: [entry], bundle: true, write: false,
            format: 'cjs', platform: 'node', packages: 'external', define:{'import.meta.env.DEV':'false'}, plugins: [{ name: 'admin-astro', setup(builder) {
                builder.onResolve({ filter: /^(cloudflare:workers|astro:middleware)$/ }, args => ({path:args.path,namespace:'test-bindings'}));
                builder.onLoad({filter:/.*/,namespace:'test-bindings'},args=>({contents:args.path==='cloudflare:workers'?'export const env=TEST_BINDINGS;':'export const defineMiddleware=fn=>fn;',loader:'js'}));
                builder.onLoad({ filter: /\.css$/ }, async args => {
                    css.push(await readFile(args.path, 'utf8')); return { contents: '', loader: 'js' };
                });
                builder.onLoad({ filter: /\.astro$/ }, async args => {
                    const result = transform(await readFile(args.path, 'utf8'), { filename: args.path.replaceAll('\\', '/'),
                        internalURL: 'astro/compiler-runtime', resultScopedSlot: true, resolvePath: p => p });
                    for (const item of result.css) css.push(String(item));
                    if (result.diagnostics.some(item => item.severity === 'error')) throw new Error('Component compile failed');
                    return { contents: result.code.replace(/^import ["'][^"']+\?astro&type=style[^"']*["'];?$/gm, ''), loader: 'ts' };
                });
            } }] });
        const module = { exports: {} as { default: Parameters<experimental_AstroContainer['renderToString']>[0] } };
        new Function('TEST_BINDINGS','require', 'module', 'exports', compiled.outputFiles[0].text)(bindings,createRequire(import.meta.url), module, module.exports);
        return { exports: module.exports, component: module.exports.default, css: css.join('\n') };
    }

 const views = new Map();
 for (const [route,entry] of [
  ['/admin','src/pages/admin/index.astro'],
  ['/admin/sleeves','src/pages/admin/sleeves/index.astro'],
  ['/admin/purchases','src/pages/admin/purchases/index.astro'],
  ['/admin/bgg','src/pages/admin/bgg/index.astro'],
  ['/admin/sleeves/requirements','src/pages/admin/sleeves/requirements.astro'],
  ['/admin/collection','src/pages/admin/collection/index.astro'],
  ['/admin/collection/copies','src/pages/admin/collection/[id]/copies.astro'],
  ['/admin/collection/components/classification','src/pages/admin/collection/components/classification.astro'],
  ['/admin/collection/components/manage','src/pages/admin/collection/components/manage.astro'],
  ['/admin/collection/new','src/pages/admin/collection/new.astro'],
  ['/admin/collection/[id]','src/pages/admin/collection/[id].astro'],
  ['/admin/notbgg','src/pages/admin/notbgg/index.astro'],
  ['/admin/notbgg/new','src/pages/admin/notbgg/new.astro'],
  ['/admin/notbgg/[id]','src/pages/admin/notbgg/[id].astro'],
  ['/admin/notbgg/[id]/link','src/pages/admin/notbgg/[id]/link.astro'],
  ['/admin/notbgg/[id]/relations','src/pages/admin/notbgg/[id]/relations.astro']
 ]) views.set(route,await compile(entry));
 const middleware=await compile('src/middleware.ts');
 const container=await experimental_AstroContainer.create();
 return async (request:Request):Promise<Response> => {
  const url=new URL(request.url),copyRoute=url.pathname.match(/^\/admin\/collection\/([1-9][0-9]*)\/copies\/?$/);
  const collectionRoute=url.pathname.match(/^\/admin\/collection\/([1-9][0-9]*)\/?$/);
  const notBggRoute=url.pathname.match(/^\/admin\/notbgg\/([0-9]{6,})(?:\/(link|relations))?\/?$/);
  const id=copyRoute?.[1] ?? collectionRoute?.[1] ?? notBggRoute?.[1];
  let route=url.pathname;
  if(copyRoute) route='/admin/collection/copies';
  if(collectionRoute) route='/admin/collection/[id]';
  if(notBggRoute) route='/admin/notbgg/[id]' + (notBggRoute[2] ? '/' + notBggRoute[2] : '');
  const view=views.get(route);
  if(!view)return new Response('Not found',{status:404});
  return (middleware.exports as any).onRequest({request,url},async()=>{
   const response=await container.renderToResponse(view.component,{request,params:id?{id}:{}});
   const html=await response.text();
   return new Response(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</head>',`<style>${view.css}</style></head>`),{status:response.status,headers:response.headers});
  });
 };
}
