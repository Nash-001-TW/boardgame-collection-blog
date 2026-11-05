import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {d7aBuiltPreview} from './helpers/d7a-built-preview.ts';
import {migrateIsolatedD1} from './helpers/notbgg-local-d1.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';
import {NotBggLinkRepository} from '../src/lib/notbgg-link-repository.ts';

// Real loopback HTTP -> built Worker -> actual ASSETS; no handler/HTML mocks.
test('F1 production HTTP: all BGG static aliases use reversible identity resolution',async t=>{
 const local=await d7aBuiltPreview(),rows:{stage:string;method:string;path:string;chain:unknown[]}[]=[];
 try{
  const variants=(lang:string)=>{const p=lang+'/games/';return [p+'santorini',p+'santorini/',p+'santorini.html',p+'santorini.html/',p+'santorini/index.html',p+'santorini/index.html/',p+'%73antorini',p+'%73antorini%2Ehtml',p+'santorini/%69ndex%2Ehtml',p+'santorini%2Findex.html',p+'/santorini/index.html',...(lang?['/%65n/games/santorini/','/en/%67ames/santorini/index.html','/en/games%2Fsantorini/','/en//games/santorini.html']:['/%67ames/santorini/','/%67ames/santorini/index.html','/games%2Fsantorini/','//games/santorini.html'])];};
  const check=async(path:string,primary:'bgg'|'notbgg',stage:string,method='GET')=>{
   const english=decodeURIComponent(path).replace(/\/{2,}/g,'/').startsWith('/en/'),prefix=english?'/en':'';
   const expected=prefix+(primary==='bgg'?'/games/santorini':'/games/notbgg/000001');
   // Construct from pathname, not a protocol-relative URL, for duplicate-slash cases.
   let next=new URL(local.url);next.pathname=path;next.search='?q=keep%20state';const visited=new Set<string>(),chain:unknown[]=[];
   for(let i=0;i<5;i++){
    assert.ok(!visited.has(next.href),'redirect cycle');visited.add(next.href);
    const r=await fetch(next,{method,redirect:'manual'}),body=await r.text();
    chain.push({path:next.pathname,status:r.status,location:r.headers.get('location'),worker:r.headers.has('x-d7a-queries'),queries:r.headers.get('x-d7a-queries'),canonical:body.match(/<link[^>]+rel="canonical"[^>]+>/)?.[0]});
    assert.ok(r.headers.has('x-d7a-queries'),'identity request bypassed Worker: '+next.pathname);
    assert.equal(r.headers.get('cache-control'),'no-store');
    if(r.status===307){assert.ok(r.headers.get('location'));const target=new URL(r.headers.get('location')!,next);assert.equal(target.origin,local.url.origin);assert.equal(target.pathname,expected);assert.equal(target.search,'?q=keep%20state');next=target;continue;}
    assert.equal(r.status,200,stage+': '+path);assert.ok(next.pathname===expected||next.pathname===expected+'/');
    if(method==='GET'){assert.match(body,primary==='bgg'?/Santorini/:/Synthetic F1 primary/);assert.equal((body.match(/rel="canonical"/g)??[]).length,1);assert.ok(body.includes(`rel="canonical" href="${new URL(expected,local.url).href}"`));assert.ok(!body.includes('PRIVATE_F1'));}
    else assert.equal(body,'');
    rows.push({stage,method,path,chain});return;
   }throw new Error('Too many redirects: '+path);
  };
  await t.test('candidate config equals generated Worker-first; missing schema fails closed',async()=>{
   const source=JSON.parse(await readFile('wrangler.json','utf8')),generated=JSON.parse(await readFile('dist/server/wrangler.json','utf8'));
   assert.deepEqual(generated.assets.run_worker_first,source.assets.run_worker_first);
   const r=await local.httpFetch('/games/santorini/index.html');assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(!(await r.text()).includes('SQL'));
  });
  await migrateIsolatedD1(local.db);const repo=new NotBggRepository(local.db),links=new NotBggLinkRepository(local.db);
  const game=(await repo.create({name:'Synthetic F1 primary',type:'boardgame',editorNotes:'PRIVATE_F1'},{actor:'synthetic',idempotencyKey:'f1-http'})).game;
  const execute=async(action:'propose'|'confirm'|'primary'|'revoke',extra:Record<string,unknown>={})=>{const s=await links.state(game.notBggId);return links.execute(game.notBggId,{action,expectedProfileRevision:1,expectedEventId:s.expectedEventId,reason:'synthetic HTTP regression',...(s.link?{linkId:s.link.id}:{}),...extra},'synthetic');};
  const all=async(primary:'bgg'|'notbgg',stage:string)=>{for(const lang of ['','/en'])for(const path of variants(lang))await check(path,primary,stage);};
  await t.test('unlinked aliases preserve actual static pages, query and canonical',()=>all('bgg','unlinked'));
  await execute('propose',{bggId:194655});
  await t.test('candidate never merges or redirects BGG to NotBGG',()=>all('bgg','candidate'));
  await execute('confirm');
  await t.test('confirmed NotBGG primary: every alias redirects directly to correct primary',()=>all('notbgg','linked-notbgg'));
  await t.test('HEAD aliases have the same temporary redirect semantics and no body',async()=>{for(const lang of ['','/en'])for(const path of variants(lang))await check(path,'notbgg','linked-head','HEAD');});
  await execute('primary',{primarySource:'bgg'});
  await t.test('BGG primary restores static content and one canonical on all aliases',()=>all('bgg','linked-bgg'));
  await execute('revoke');
  await t.test('revoked identities resolve independently on all BGG aliases',()=>all('bgg','revoked'));
  await execute('propose',{bggId:194655});await execute('confirm');await repo.archive(game.notBggId,{actor:'synthetic',expectedRevision:1});
  await t.test('archived NotBGG is not a redirect target and never leaks through aliases',async()=>{
   await all('bgg','archived');for(const lang of ['','/en']){const r=await local.httpFetch(lang+'/games/notbgg/000001');assert.equal(r.status,404);assert.ok(!(await r.text()).includes('PRIVATE_F1'));}
  });
  await t.test('CSS, JS and images stay byte-identical, asset-first, with zero D1 reads',async()=>{
   const files=await readdir('dist/client/_astro');
   const paths=[...['.css','.js'].map(ext=>'/_astro/'+files.find(f=>f.endsWith(ext))),'/favicon.svg'];
   for(const path of paths){
    const original=await readFile('dist/client'+path),r=await local.httpFetch(path);assert.equal(r.status,200);assert.ok(!r.headers.has('x-d7a-queries'));assert.deepEqual(Buffer.from(await r.arrayBuffer()),original);
    const encoded=path.replace(/[^/](?=[^/]*$)/,c=>'%'+c.charCodeAt(0).toString(16));const e=await local.httpFetch(encoded);assert.equal(e.status,200);assert.equal(e.headers.get('x-d7a-queries'),'0');assert.deepEqual(Buffer.from(await e.arrayBuffer()),original);
   }
   for(const path of ['/games/missing-f1.html','/games/santorini.js','/games/santorini/cover.png','/games/santorini%252Ehtml']){const r=await local.httpFetch(path);assert.equal(r.headers.get('x-d7a-queries'),'0');assert.notEqual(r.status,200);}
  });
  assert.equal(createHash('sha256').update(await readFile('src/data/bgg-cache.json')).digest('hex'),'1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91');
  const file='docs/d7a-local-evidence.json',e=JSON.parse(await readFile(file,'utf8'));
  e.f1Repair={status:'PASS',transport:'actual loopback HTTP; real production Worker/chunks/ASSETS; isolated synthetic D1',before:e.f1Repair?.before??e.routeMatrix.filter((r:any)=>r.workerFirst==='configured'),scenarioCount:rows.length,after:rows.filter(r=>['/games/santorini','/games/santorini.html','/games/santorini/index.html','/%67ames/santorini/','/en/games/santorini.html','/en/games/santorini/index.html','/en/games/santorini%2Findex.html'].includes(r.path)),staticAssets:'normal CSS/JS/favicon asset-first; encoded resources pass through Worker with zero D1; all bytes match dist/client',remoteTested:false};await writeFile(file,JSON.stringify(e,null,2));
 }finally{await local.dispose();}
});
