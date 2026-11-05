import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isolatedNotBggD1,migrateIsolatedD1} from './helpers/notbgg-local-d1.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';
import {NotBggLinkRepository} from '../src/lib/notbgg-link-repository.ts';
import {loadPublicCatalog,PublicNotBggReader} from '../src/lib/notbgg-public.ts';
import {CollectionV2Repository} from '../src/lib/collection-v2-repository.ts';
import {adaptCollectionV2Rows} from '../src/lib/collection-v2-adapter.ts';
import {getGames} from '../src/lib/games.ts';
import {matchesCatalogSearch} from '../src/lib/catalog-browsing.ts';
import {handleNotBggLinkRequest} from '../src/lib/notbgg-link-api.ts';
import {publicIdentityIndex} from '../src/lib/identity-resolution.ts';

test('D6 atomic commands, identity projection, reversible aliases, collection/edge preservation and Access',async t=>{
 const local=await isolatedNotBggD1(),db=local.db,auth=await accessFixture();
 try{
  await migrateIsolatedD1(db);const repo=new NotBggRepository(db),links=new NotBggLinkRepository(db),collection=new CollectionV2Repository(db),games=getGames();
  const first=(await repo.create({name:'Synthetic source',type:'boardgame',editorNotes:'PRIVATE_D6_NOTE',mechanics:['Custom type'],yearPublished:2020},{actor:'seed',idempotencyKey:'link-source'})).game;
  const second=(await repo.create({name:'Synthetic source',type:'boardgame'},{actor:'seed',idempotencyKey:'link-other'})).game;
  const accessory=(await repo.create({name:'Unlinkable accessory',type:'boardgameaccessory',accessoryCategories:['storage'],relatedGameIds:[{source:'notbgg',notBggId:first.notBggId}]},{actor:'seed',idempotencyKey:'link-accessory'})).game;
  const created=await collection.management.create({source:'notbgg',notBggId:first.notBggId},{displayName:'Personal label',acquisitionStatus:'owned',language:'zh-TW',priceMinor:150000,currency:'TWD',merchant:'PRIVATE_MERCHANT',comment:'PRIVATE_COMMENT'},{actor:'seed',idempotencyKey:'link-collection',scope:'test',createCopy:true});
  const original=await collection.management.detail(created.collectionId,'test'),originalSource=await repo.getByNotBggId(first.notBggId),edgeRows=(await db.prepare('SELECT * FROM site_game_relations').all()).results;
  const command=async(id:typeof first.notBggId,action:'propose'|'confirm'|'primary'|'revoke',extra:Record<string,unknown>={})=>{const s=await links.state(id);return links.execute(id,{action,expectedProfileRevision:1,expectedEventId:s.expectedEventId,reason:'PRIVATE_AUDIT_REASON',...(s.link?{linkId:s.link.id}:{}),...extra},'verified-actor');};
  await t.test('same names never merge; invalid and absent targets reject; candidate does not deduplicate',async()=>{
   assert.equal((await loadPublicCatalog(games,db,'en')).payload.records.length,818);
   await assert.rejects(command(first.notBggId,'propose',{bggId:0}),/INVALID_BGG_ID/);await assert.rejects(command(first.notBggId,'propose',{bggId:999999999}),/TARGET_NOT_FOUND/);
   const state=await command(first.notBggId,'propose',{bggId:194655});assert.equal(state.state,'candidate');assert.equal(state.original.linkStatus,'pending');assert.equal((await loadPublicCatalog(games,db,'en')).payload.records.length,818);
   const comparison=await links.comparison(first.notBggId,194655);assert.equal(comparison.compatible,true);assert.equal(comparison.bgg.ref.source,'bgg');
   const pending=await links.state(first.notBggId);await assert.rejects(new NotBggLinkRepository(db,games.filter(g=>g.bggId!==194655)).execute(first.notBggId,{action:'confirm',expectedProfileRevision:1,expectedEventId:pending.expectedEventId,linkId:pending.link!.id,reason:'target vanished'},'test'),/TARGET_NOT_FOUND/);
  });
  await t.test('accessory/base mismatch cannot confirm; no forced exception or automatic import',async()=>{
   await command(accessory.notBggId,'propose',{bggId:194655});await assert.rejects(command(accessory.notBggId,'confirm'),/TYPE_MISMATCH/);await command(accessory.notBggId,'revoke');
  });
  await t.test('confirmation defaults NotBGG, preserves raw data and produces one stable group with both exact IDs',async()=>{
   const state=await command(first.notBggId,'confirm');assert.equal(state.link!.primary_source,'notbgg');assert.equal(state.state,'linked');
   const catalog=await loadPublicCatalog(games,db,'en'),group=catalog.payload.records.filter(r=>r.dataset.notBggId===first.notBggId);assert.equal(catalog.payload.records.length,817);assert.equal(group.length,1);assert.equal(group[0].dataset.name,'Synthetic source');assert.equal(group[0].dataset.bggRating,'');
   assert.ok(matchesCatalogSearch(group[0].dataset,'#194655'));assert.ok(matchesCatalogSearch(group[0].dataset,first.notBggId));assert.equal(group[0].dataset.catalogKey,first.notBggId);
   for(const word of ['PRIVATE_D6_NOTE','PRIVATE_AUDIT_REASON','verified-actor'])assert.ok(!JSON.stringify(catalog).includes(word));
   assert.equal((await repo.getByNotBggId(first.notBggId))!.revision,originalSource!.revision);assert.equal((await repo.getByNotBggId(first.notBggId))!.editorNotes,'PRIVATE_D6_NOTE');
   await assert.rejects(command(first.notBggId,'confirm'),/INVALID_TRANSITION/);
   await assert.rejects(repo.update(first.notBggId,{type:'boardgameexpansion'},{actor:'editor',expectedRevision:1}),/Revision changed/);
  });
  await t.test('one-to-one enforced, explicit primary switch only changes projection',async()=>{
   await command(second.notBggId,'propose',{bggId:194655});await assert.rejects(command(second.notBggId,'confirm'),/CONFLICT/);
   await command(first.notBggId,'primary',{primarySource:'bgg'});const catalog=await loadPublicCatalog(games,db,'en'),card=catalog.payload.records.find(r=>r.dataset.notBggId===first.notBggId)!;
   assert.equal(card.dataset.source,'bgg');assert.equal(card.href,'/en/games/santorini');assert.equal(card.dataset.catalogKey,first.notBggId);assert.equal(catalog.payload.records.length,817);
   const details=await new PublicNotBggReader(db).detail(accessory.notBggId,games,'en');assert.equal(details!.related[0].href,'/en/games/santorini');assert.equal(details!.related[0].originalKey,first.notBggId);
   assert.deepEqual((await db.prepare('SELECT * FROM site_game_relations').all()).results,edgeRows);
   assert.deepEqual(await collection.management.detail(created.collectionId,'test'),original);
   const state=await links.state(first.notBggId),missing=new NotBggLinkRepository(db,games.filter(g=>g.bggId!==194655));
   await missing.execute(first.notBggId,{action:'primary',expectedProfileRevision:1,expectedEventId:state.expectedEventId,linkId:state.link!.id,primarySource:'notbgg',reason:'recover missing source'},'test');
   const restored=await links.state(first.notBggId);await assert.rejects(missing.execute(first.notBggId,{action:'primary',expectedProfileRevision:1,expectedEventId:restored.expectedEventId,linkId:restored.link!.id,primarySource:'bgg',reason:'invalid source'},'test'),/TARGET_NOT_FOUND/);
   await command(first.notBggId,'primary',{primarySource:'bgg'});
  });
  await t.test('production collection projection follows primary while original source and scope stay intact',async()=>{
   const beforeCount=(await collection.getProductionItems()).length;
   const id=(await collection.management.create({source:'notbgg',notBggId:first.notBggId},{displayName:'Keep my personal label',acquisitionStatus:'wishlist'},{actor:'seed',idempotencyKey:'projection-production-local',scope:'production',createCopy:false})).collectionId;
   const row=(await collection.getProductionItems()).find(r=>r.id===id)!;const dto=adaptCollectionV2Rows([row],'en')[0];assert.equal(dto.notBggId,first.notBggId);assert.equal(dto.gameId,first.gameId);assert.equal(dto.gameUrl,'/en/games/santorini');assert.equal(dto.displayName,'Keep my personal label');assert.equal(dto.resolvedIdentityKey,'BGG:194655');
   assert.equal((await collection.getProductionItems()).length,beforeCount+1);assert.ok(!JSON.stringify(dto).includes('PRIVATE_'));
   await command(first.notBggId,'primary',{primarySource:'notbgg'});assert.equal(adaptCollectionV2Rows((await collection.getProductionItems()).filter(r=>r.id===id),'en')[0].gameUrl,'/en/games/notbgg/000001');
  });
  await t.test('late audit failure rolls back source switch, no fake successful event',async()=>{
   const before=await links.state(first.notBggId),history=await links.history(first.notBggId);
   await db.prepare("CREATE TRIGGER d6_fail_audit BEFORE INSERT ON notbgg_link_events WHEN NEW.action='primary_source_changed' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").run();
   await assert.rejects(command(first.notBggId,'primary',{primarySource:'bgg'}),/STORAGE/);assert.deepEqual(await links.state(first.notBggId),before);assert.deepEqual(await links.history(first.notBggId),history);await db.prepare('DROP TRIGGER d6_fail_audit').run();
  });
  await t.test('ACTUAL overlapping source switches use event CAS; exactly one winner',async()=>{
   const state=await links.state(first.notBggId),cmd={action:'primary' as const,expectedProfileRevision:1,expectedEventId:state.expectedEventId,linkId:state.link!.id,primarySource:'bgg' as const,reason:'race'};
   const results=await Promise.allSettled([links.execute(first.notBggId,cmd,'a'),links.execute(first.notBggId,cmd,'b')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  });
  await t.test('revoke restores independent sources and original collection/edge identities without deleting history',async()=>{
   const historyBefore=(await links.history(first.notBggId)).length;await command(first.notBggId,'revoke');assert.equal((await links.state(first.notBggId)).state,'unlinked');assert.equal((await links.history(first.notBggId)).length,historyBefore+1);
   const catalog=await loadPublicCatalog(games,db,'en');assert.equal(catalog.payload.records.length,818);assert.equal(catalog.payload.records.filter(r=>matchesCatalogSearch(r.dataset,'#194655')).length,1);assert.equal(catalog.payload.records.filter(r=>matchesCatalogSearch(r.dataset,first.notBggId)).length,1);
   assert.deepEqual(await collection.management.detail(created.collectionId,'test'),original);assert.deepEqual((await db.prepare('SELECT * FROM site_game_relations').all()).results,edgeRows);
   const details=await new PublicNotBggReader(db).detail(accessory.notBggId,games,'en');assert.equal(details!.related[0].href,'/en/games/notbgg/000001');
  });
  await t.test('ACTUAL competing confirmations for same BGG have one winner and complete audit',async()=>{
   await command(first.notBggId,'propose',{bggId:194655});const a=await links.state(first.notBggId),b=await links.state(second.notBggId);
   const results=await Promise.allSettled([links.execute(first.notBggId,{action:'confirm',expectedProfileRevision:1,expectedEventId:a.expectedEventId,linkId:a.link!.id,reason:'a'},'a'),links.execute(second.notBggId,{action:'confirm',expectedProfileRevision:1,expectedEventId:b.expectedEventId,linkId:b.link!.id,reason:'b'},'b')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(Number((await db.prepare("SELECT count(*) n FROM notbgg_bgg_links WHERE status='linked'").first<{n:number}>())!.n),1);
   assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  });
  await t.test('archived profiles are excluded from public identities and raw detail; no admin data leak',async()=>{
   await repo.archive(first.notBggId,{actor:'seed',expectedRevision:1});assert.equal((await publicIdentityIndex(db,games)).byNotBgg.has(first.notBggId),false);assert.equal(await new PublicNotBggReader(db).detail(first.notBggId,games,'en'),null);
  });
  await t.test('independent API denies anonymous/forged/unauthorized, CSRF, system fields, bad JSON and missing binding',async()=>{
   const jwt=await auth.token(),origin='https://fixture.example',path='/api/admin/notbgg/NotBGG%3A000002/link',bindings={...auth.bindings,DB:db,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
   const call=(method='GET',body?:unknown,token:string|null=jwt,headers:Record<string,string>={})=>handleNotBggLinkRequest(new Request(origin+path,{method,headers:{...(token?{'Cf-Access-Jwt-Assertion':token}:{}),Origin:origin,'X-NotBGG-Request':'1','Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}),bindings);
   assert.equal((await call('GET',undefined,null)).status,401);assert.equal((await call('GET',undefined,await auth.token({wrongKey:true}))).status,401);assert.equal((await call('GET',undefined,await auth.token({email:'other@example.test'}))).status,403);
   assert.equal((await call('POST',{},jwt,{Origin:'https://evil.example'})).status,403);assert.equal((await call('POST',{actor:'fake'})).status,400);assert.equal((await call('POST',{},jwt,{'Content-Type':'text/plain'})).status,415);
   assert.equal((await handleNotBggLinkRequest(new Request(origin+path,{headers:{'Cf-Access-Jwt-Assertion':jwt}}),auth.bindings)).status,503);
  });
  assert.equal(createHash('sha256').update(await readFile('src/data/bgg-cache.json')).digest('hex'),'1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91');
 }finally{auth.restore();await local.dispose();}
});

test('real Worker gateway: original static BGG assets, 307 aliases, absolute canonical and bilingual custom slug',async()=>{
 const bundle=await build({entryPoints:['src/worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',plugins:[{name:'static-handler-fixture',setup(b){b.onResolve({filter:/^@astrojs\/cloudflare\/handler$/},()=>({path:'handler',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export async function handle(request){if(request.headers.has('if-none-match'))return new Response(null,{status:304});return new Response('<html><head><link rel="canonical" href="/old"></head><body><article data-detail-v2>STATIC BGG CONTENT</article></body></html>',{headers:{'Content-Type':'text/html','ETag':'static'}})}` }));}}]});
 const local=await isolatedNotBggD1(bundle.outputFiles[0].text);try{
  const unavailable=await local.fetch('https://fixture.example/games/santorini');assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes('SQL'));
  await migrateIsolatedD1(local.db);const repo=new NotBggRepository(local.db),links=new NotBggLinkRepository(local.db),game=(await repo.create({name:'Gateway original',type:'boardgame'},{actor:'seed',idempotencyKey:'gateway-game'})).game;
  const execute=async(action:'propose'|'confirm'|'primary'|'revoke',extra:Record<string,unknown>={})=>{const s=await links.state(game.notBggId);return links.execute(game.notBggId,{action,expectedProfileRevision:1,expectedEventId:s.expectedEventId,reason:'test',...(s.link?{linkId:s.link.id}:{}),...extra},'test');};
  let response=await local.fetch('https://fixture.example/games/santorini',{'If-None-Match':'static'});assert.equal(response.status,200);assert.equal(response.headers.get('ETag'),null);assert.match(await response.text(),/canonical" href="https:\/\/fixture.example\/games\/santorini/);
  await execute('propose',{bggId:194655});await execute('confirm');response=await local.fetch('https://fixture.example/en/games/santorini?q=hello');assert.equal(response.status,307);assert.equal(response.headers.get('Location'),'https://fixture.example/en/games/notbgg/000001?q=hello');assert.equal(response.headers.get('Cache-Control'),'no-store');
  await execute('primary',{primarySource:'bgg'});response=await local.fetch('https://fixture.example/en/games/santorini');assert.equal(response.status,200);const html=await response.text();assert.match(html,/STATIC BGG CONTENT/);assert.match(html,/NotBGG:000001/);assert.equal((html.match(/rel="canonical"/g)??[]).length,1);assert.match(html,/https:\/\/fixture.example\/en\/games\/santorini/);
  await execute('revoke');response=await local.fetch('https://fixture.example/games/santorini');assert.equal(response.status,200);assert.ok(!(await response.text()).includes('NotBGG:000001'));
 }finally{await local.dispose();}
});
test('D6 commands fail closed before 0016; no unsafe fallback to application-only concurrency checks',async()=>{
 const local=await isolatedNotBggD1();try{await migrateIsolatedD1(local.db,'0015_notbgg_collection.sql');const game=(await new NotBggRepository(local.db).create({name:'Pre-D6 schema',type:'boardgame'},{actor:'seed',idempotencyKey:'pre-schema'})).game;
  await assert.rejects(new NotBggLinkRepository(local.db).execute(game.notBggId,{action:'propose',expectedProfileRevision:1,expectedEventId:0,reason:'must not write',bggId:194655},'test'),/SCHEMA_NOT_READY/);
  assert.equal((await local.db.prepare('SELECT count(*) n FROM notbgg_bgg_links').first<{n:number}>())!.n,0);
 }finally{await local.dispose();}
});
test('confirmation rejects a profile edited after human comparison, even when mapping event version is unchanged',async()=>{
 const local=await isolatedNotBggD1();try{await migrateIsolatedD1(local.db);const repo=new NotBggRepository(local.db),links=new NotBggLinkRepository(local.db),game=(await repo.create({name:'Before comparison',type:'boardgame'},{actor:'seed',idempotencyKey:'profile-race'})).game;
  await links.execute(game.notBggId,{action:'propose',expectedProfileRevision:1,expectedEventId:0,bggId:194655,reason:'candidate'},'test');
  const state=await links.state(game.notBggId),comparison=await links.comparison(game.notBggId,194655);
  await repo.update(game.notBggId,{name:'Edited after comparison'},{actor:'other',expectedRevision:1});
  await assert.rejects(links.execute(game.notBggId,{action:'confirm',expectedProfileRevision:comparison.originalRevision,expectedEventId:state.expectedEventId,linkId:state.link!.id,reason:'stale comparison'},'test'),/CONFLICT/);
  assert.equal((await links.state(game.notBggId)).state,'candidate');assert.equal((await links.history(game.notBggId)).length,1);
  const confirmed=await links.execute(game.notBggId,{action:'confirm',expectedProfileRevision:2,expectedEventId:state.expectedEventId,linkId:state.link!.id,reason:'compared latest data'},'test');assert.equal(confirmed.state,'linked');
 }finally{await local.dispose();}
});
test('ACTUAL same-record concurrent confirm/revoke returns one success and a conflict, never a fake event or 500',async()=>{
 const local=await isolatedNotBggD1();try{await migrateIsolatedD1(local.db);const repo=new NotBggRepository(local.db),links=new NotBggLinkRepository(local.db),game=(await repo.create({name:'Concurrent commands',type:'boardgame'},{actor:'seed',idempotencyKey:'same-record-race'})).game;
  await links.execute(game.notBggId,{action:'propose',expectedProfileRevision:1,expectedEventId:0,bggId:194655,reason:'candidate'},'test');
  for(const action of ['confirm','revoke'] as const){const state=await links.state(game.notBggId),cmd={action,expectedProfileRevision:1,expectedEventId:state.expectedEventId,linkId:state.link!.id,reason:'concurrent '+action};
   const results=await Promise.allSettled([links.execute(game.notBggId,cmd,'a'),links.execute(game.notBggId,cmd,'b')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const failure=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failure.reason.code,'CONFLICT');
  }
  assert.equal((await links.state(game.notBggId)).state,'unlinked');assert.deepEqual((await links.history(game.notBggId)).map(r=>r.action),['proposed','confirmed','revoked']);
 }finally{await local.dispose();}
});
