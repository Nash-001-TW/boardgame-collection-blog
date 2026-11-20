import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {seedBggRelations,bggXml} from './helpers/bgg-sync-fixture.ts';
import {readPublicBgg,readPublicBrowse,publicBggHref,bggRouteId,readPublicNotBgg,readPublicOverview} from '../src/lib/public-site-data.ts';
import {syncBggBatch} from '../src/lib/bgg-sync-admin.ts';
import {normalizePublicRoute} from '../src/lib/public-route-normalization.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';
import {readPublicGameCollection} from '../src/lib/public-game-collection.ts';
import {readPublicLiveRelations} from '../src/lib/public-live-relations.ts';
import {publicSitemap} from '../src/lib/public-sitemap.ts';
import {publicSitePreview} from './helpers/public-site-preview.ts';
import {getGames} from '../src/lib/games.ts';

test('public site sources, bounded queries and dynamic routes',async t=>{
 const f=await sleeveWorkflowFixture();
 try{
 seedBggRelations(f.sqlite);const secret=crypto.randomUUID()+crypto.randomUUID(),bindings:{DB?:D1Database}={DB:f.db};let failure=false;
 const sync=async(ids:number[])=>{f.sqlite.exec('UPDATE v2_bgg_sync_gate SET next_allowed=0');return syncBggBatch(f.db,secret,'fixture',crypto.randomUUID(),ids,{sleep:async()=>{},fetcher:async url=>failure?new Response('unavailable',{status:503}):new Response(bggXml(Number(new URL(String(url)).searchParams.get('id'))).replace(/Fixture \d+/,'AAA Shared Game'))});};
 const original=getGames().find(g=>g.bggId===f.bggId)!;
 const notbgg=(await new NotBggRepository(f.db).create({name:'Public custom game',type:'boardgame',editorNotes:'PRIVATE_EDITOR',description:'Public custom description'},{actor:'fixture',idempotencyKey:'public-custom-game'})).game;
 await t.test('live success replaces static metadata immediately and failures preserve it',async()=>{
  assert.equal((await readPublicBgg(f.db,f.bggId,'en'))!.game!.name,original.name);
  await sync([f.bggId,900001,900002]);
  assert.equal((await readPublicBgg(f.db,f.bggId,'en'))!.game!.name,'AAA Shared Game');assert.equal((await readPublicBgg(f.db,900001,'en'))!.game!.bgg.designers[0].name,'Designer');
  failure=true;await sync([f.bggId]);assert.equal((await readPublicBgg(f.db,f.bggId,'en'))!.game!.name,'AAA Shared Game');failure=false;
 });
 await t.test('qualified new IDs have collision-free routes; test-only / archived / cache-only records stay private',async()=>{
  assert.equal(publicBggHref(900001,'en'),'/en/games/bgg/900001');assert.notEqual(publicBggHref(900001,'en'),publicBggHref(900002,'en'));assert.equal(bggRouteId(original.slug),f.bggId);
  await sync([900999]);assert.equal(await readPublicBgg(f.db,900999,'en'),null);
  f.sqlite.exec("INSERT INTO v2_games(id,bgg_id,primary_name) VALUES(999,900999,'PRIVATE_GAME');INSERT INTO v2_collection_items(id,game_id,display_name,record_scope) VALUES(999,999,'PRIVATE_TEST','test')");
  assert.equal(await readPublicBgg(f.db,900999,'en'),null);f.sqlite.exec("UPDATE v2_collection_items SET record_scope='production' WHERE id=999;INSERT INTO v2_collection_management(collection_item_id,archived_at) VALUES(999,CURRENT_TIMESTAMP)");assert.equal(await readPublicBgg(f.db,900999,'en'),null);
  assert.equal(await readPublicBgg(f.db,999998,'en'),null);
  assert.equal(normalizePublicRoute(new Request('http://localhost/en/games/'+original.slug+'.html?sort=year')),'/en/games/'+original.slug);
  assert.equal(normalizePublicRoute(new Request('http://localhost/games/bgg-900001')),'/games/bgg/900001');
 });
 await t.test('bounded search/filter/sort/pagination with no personal metadata',async()=>{
  const insert=f.sqlite.prepare("INSERT INTO v2_collection_items(id,game_id,display_name,acquisition_status,wishlist,notes) VALUES(?,1,?,'owned',1,'PRIVATE_PRICE_AND_NOTES')");for(let i=0;i<45;i++)insert.run(1000+i,'Public row '+String(i).padStart(2,'0'));
  const first=await readPublicBrowse(f.db,new URLSearchParams({q:'Public row',status:'wishlist'}),'en',true),second=await readPublicBrowse(f.db,new URLSearchParams({q:'Public row',status:'wishlist',page:'2'}),'en',true);
  assert.equal(first.total,45);assert.equal(first.cards.length,20);assert.equal(second.cards.length,20);assert.ok(!first.cards.some(a=>second.cards.some(b=>a.collectionId===b.collectionId)));
  const games=await readPublicBrowse(f.db,new URLSearchParams({q:'AAA Shared',source:'bgg',sort:'rating',players:'2'}),'en');assert.equal(games.cards.length,3);assert.ok(games.cards.some(c=>c.href==='/en/games/bgg/900001'));
  const advanced=await readPublicBrowse(f.db,new URLSearchParams({q:'AAA Shared',time:'31-60',weight:'2-3',mechanic:'5',sort:'bgg-rating-desc',view:'list'}),'en');assert.equal(advanced.cards.length,3);
  assert.equal((await readPublicBrowse(f.db,new URLSearchParams({q:'AAA Shared',time:'over120'}),'en')).cards.length,0);
  assert.ok(!JSON.stringify(first).includes('PRIVATE'));assert.ok(!JSON.stringify(first).includes('notes'));assert.ok(!JSON.stringify(first).includes('personalRating'));assert.ok(!JSON.stringify(first).includes(secret));
  await assert.rejects(readPublicBrowse(f.db,new URLSearchParams({page:'1001'}),'en'));
  const counts=await readPublicOverview(f.db);assert.ok(counts.records>=45);assert.ok(counts.wishlist>=45);
 });
 await t.test('confirmed identities deduplicate, pending identities do not claim routes',async()=>{
  f.sqlite.prepare("INSERT INTO notbgg_bgg_links(seq,candidate_bgg_id,status,created_by) VALUES(?,900001,'pending','fixture')").run(Number(notbgg.notBggId.slice(7)));
  assert.equal((await readPublicBrowse(f.db,new URLSearchParams({q:'AAA Shared'}),'en')).cards.length,3);
  f.sqlite.exec("UPDATE notbgg_bgg_links SET status='linked',primary_source='notbgg',bgg_game_id=401,confirmed_by='fixture',linked_at=CURRENT_TIMESTAMP");
  assert.equal((await readPublicBgg(f.db,900001,'en'))!.redirect,'/en/games/notbgg/'+notbgg.notBggId.slice(7));assert.equal((await readPublicBrowse(f.db,new URLSearchParams({q:'AAA Shared'}),'en')).cards.length,2);
  f.sqlite.exec("UPDATE notbgg_bgg_links SET primary_source='bgg'");assert.equal((await readPublicNotBgg(f.db,Number(notbgg.notBggId.slice(7)),'en')).redirect,'/en/games/bgg/900001');
 });
 await t.test('new BGG pages can query sleeves and relations without publishing private targets',async()=>{
  const detail=await readPublicGameCollection(f.db,'BGG:900001',f.secret);assert.ok(detail.collections.some(c=>c.id===401));
  f.sqlite.exec("INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type,relation_source,admin_confirmed) VALUES(401,999,'other','manual',1)");
  const relations=await readPublicLiveRelations(f.db,'BGG:900001','en');assert.ok(!JSON.stringify(relations).includes('PRIVATE'));assert.ok(!relations.relations.some(r=>r.href.endsWith('/900999')));
  await assert.rejects(readPublicLiveRelations(f.db,'BGG:900999','en'));
 });
 const preview=await publicSitePreview(bindings);
 await t.test('real Astro routes render updated data, SEO, 404 and distinct 503 errors',async()=>{
  const page=await preview.render(new Request('http://localhost/en/games/bgg/900001'));assert.equal(page.status,200);assert.equal(page.headers.get('Cache-Control'),'no-store');const html=await page.text();assert.ok(html.includes('AAA Shared Game'));assert.ok(html.includes('rel="canonical"'));assert.ok(html.includes('og:description'));assert.ok(!html.includes(secret));assert.ok(!html.includes('PRIVATE_EDITOR'));
  assert.equal((await preview.render(new Request('http://localhost/en/games/bgg/900999'))).status,404);
  assert.equal((await preview.render(new Request('http://localhost/en/games/'+original.slug))).status,200);
  assert.equal((await preview.render(new Request('http://localhost/games/'+original.slug+'.html'))).status,307);
  const custom=await preview.render(new Request('http://localhost/en/games/notbgg/'+notbgg.notBggId.slice(7)));assert.equal(custom.status,307);assert.ok(custom.headers.get('Location')?.includes('/games/bgg/900001'));
  bindings.DB={prepare:()=>{throw new Error('PRIVATE_FAILURE');}} as unknown as D1Database;
  assert.equal((await preview.render(new Request('http://localhost/en/games/bgg/900001'))).status,503);const failed=await preview.render(new Request('http://localhost/en/collection'));assert.equal(failed.status,503);const body=await failed.text();assert.ok(!body.includes('No matching records'));assert.ok(!body.includes('PRIVATE_FAILURE'));bindings.DB=f.db;
 });
 await t.test('sitemap is dynamic, bounded, excludes administration and distinguishes failures',async()=>{
  const index=await publicSitemap(f.db,'http://localhost');assert.equal(index.status,200);assert.ok((await index.text()).includes('<sitemapindex'));
  const page=await publicSitemap(f.db,'http://localhost',1),xml=await page.text();assert.equal(page.status,200);assert.ok(!xml.includes('/admin'));assert.ok(!xml.includes('PRIVATE'));assert.ok(!xml.includes('900999'));
  assert.equal((await publicSitemap(undefined,'http://localhost')).status,503);
 });
 }finally{f.sqlite.close();}
});
