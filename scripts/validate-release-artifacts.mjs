// Read local build products and run the actual Worker with disposable local bindings only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'dotenv';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {migrateIsolatedD1} from '../tests/helpers/notbgg-local-d1.ts';
import {parseBggGameXml} from '../src/lib/bgg-parser.ts';
import {bggXml} from '../tests/helpers/bgg-sync-fixture.ts';

const root=path.resolve(process.argv[2]??'');if(!process.argv[2])throw new Error('Pass the isolated build directory');
const server=path.join(root,'dist/server'),client=path.join(root,'dist/client');
const config=JSON.parse(await fs.readFile(path.join(server,'wrangler.json'),'utf8'));
assert.equal(config.main,'entry.mjs');assert.equal(config.assets.binding,'ASSETS');
assert.ok(config.d1_databases.some(b=>b.binding==='DB'));assert.ok(config.kv_namespaces.some(b=>b.binding==='SESSION'));
assert.equal(config.images.binding,'IMAGES');assert.ok(config.ratelimits.some(b=>b.name==='NOTBGG_WRITE_LIMITER'));
const files=await fs.readdir(server,{recursive:true});
const texts=await Promise.all(files.filter(f=>/\.(mjs|js)$/.test(f)).map(async f=>({file:f,text:await fs.readFile(path.join(server,f),'utf8')})));
const manifest=texts.find(f=>f.text.includes('"component": "src/pages/games/bgg/[id].astro"'))?.text;assert.ok(manifest,'Worker route manifest exists');
for(const component of ['src/pages/index.astro','src/pages/collection.astro','src/pages/games.astro','src/pages/games/[slug].astro','src/pages/games/bgg/[id].astro','src/pages/games/notbgg/[id].astro','src/pages/en/games/bgg/[id].astro']){
 const pos=manifest.indexOf('"component": "'+component+'"');assert.ok(pos>=0,component);assert.ok(manifest.slice(pos,pos+component.length+120).includes('"prerender": false'),component+' remains SSR');
}
const clientFiles=await fs.readdir(client,{recursive:true});assert.ok(!clientFiles.includes('games/index.html'));assert.ok(!clientFiles.includes('collection/index.html'));
const secretValues=[];
for(const file of ['.env','.dev.vars']){try{for(const [name,value]of Object.entries(parse(await fs.readFile(file))))if(/TOKEN|SECRET|KEY/.test(name)&&value.length>=12)secretValues.push({name,value});}catch(error){if(error.code!=='ENOENT')throw error;}}
let scanned=0;const leaks=[];
for(const [directory,list]of [[server,files],[client,clientFiles]])for(const file of list.filter(f=>/\.(?:mjs|js|json|html|css|map|txt)$/.test(f))){
 const text=await fs.readFile(path.join(directory,file),'utf8');scanned++;
 for(const {name,value}of secretValues)if(text.includes(value))leaks.push({setting:name,file});
}
assert.equal(leaks.length,0,'No actual local secret values may enter Worker/client artifacts');
console.log(JSON.stringify({artifactChecks:'PASS',dynamicRoutes:'PASS',bindingNames:'PASS',scannedFiles:scanned,secretValueMatches:leaks.length}));

const directory=await fs.mkdtemp(path.join(root,'worker-smoke-'));
const modules=[texts.find(m=>m.file==='entry.mjs'),...texts.filter(m=>m.file!=='entry.mjs'&&!m.file.startsWith('.prerender'))].map(m=>({type:'ESModule',path:path.join(server,m.file),contents:m.text}));
const runtime=new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:server,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
 d1Databases:{DB:'release-isolated-'+crypto.randomUUID()},kvNamespaces:['SESSION'],ratelimits:{NOTBGG_WRITE_LIMITER:{namespace_id:'1001',simple:{limit:30,period:60}}},
 assets:{directory:client,binding:'ASSETS',run_worker_first:config.assets.run_worker_first,routerConfig:{has_user_worker:true}},resourcePersistencePath:directory,resourceTmpPath:path.join(directory,'tmp'),telemetry:{enabled:false},
 outboundService:()=>new Response('External network disabled',{status:403})}));
try{
 const db=await runtime.getD1Database('DB');
 const before=await runtime.dispatchFetch('http://localhost/games/bgg/987654321',{redirect:'manual'});if(before.status!==503)console.log('Isolated Worker error: '+(await before.text()).slice(0,1600));assert.equal(before.status,503,'Missing local schema is a service failure, not 404');
 await migrateIsolatedD1(db);
 const metadata=parseBggGameXml(bggXml(987654321));
 await db.batch([
  db.prepare("INSERT INTO bgg_games(bgg_id,name,cache_json,last_success_at,sync_status) VALUES(?,?,?,CURRENT_TIMESTAMP,'success')").bind(metadata.bggId,metadata.name,JSON.stringify(metadata)),
  db.prepare("INSERT INTO v2_games(id,bgg_id,primary_name) VALUES(1,987654321,'Synthetic public title')"),
  db.prepare("INSERT INTO v2_collection_items(game_id,display_name,acquisition_status) VALUES(1,'Synthetic public collection','owned')")]);
 const results=[];
 for(const [route,status]of [['/',200],['/games',200],['/collection',200],['/games/bgg/987654321',200],['/en/games/bgg/987654321',200],['/games/bgg/987654322',404],['/api/public/catalog',200],['/sitemap.xml',200],['/robots.txt',200],['/about/',200],['/admin/bgg',401],['/api/admin/bgg',401],['/api/admin/purchases',401]]){
  const response=await runtime.dispatchFetch('http://localhost'+route,{redirect:'manual'});assert.equal(response.status,status,route);const body=await response.text();
  if(route==='/games/bgg/987654321')assert.ok(body.includes(metadata.name));results.push({route,status:response.status});
 }
 const alias=await runtime.dispatchFetch('http://localhost/games/bgg-987654321',{redirect:'manual'});assert.equal(alias.status,307);assert.ok(alias.headers.get('Location')?.includes('/games/bgg/987654321'));
 console.log(JSON.stringify({builtWorkerSmoke:'PASS',externalNetwork:'disabled',routes:results,aliasStatus:alias.status}));
}finally{await runtime.dispose();}
