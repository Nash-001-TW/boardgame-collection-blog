import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isolatedNotBggD1,migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';
import { NotBggRepository } from '../src/lib/notbgg-repository.ts';
import { PublicNotBggReader,PublicNotBggUnavailable,loadPublicCatalog,safeImage } from '../src/lib/notbgg-public.ts';
import { getGames } from '../src/lib/games.ts';
import { accessoryCategories } from '../src/lib/notbgg-contract.ts';
import { matchesCatalogSearch } from '../src/lib/catalog-browsing.ts';
import { readBrowserUrl,writeBrowserUrl } from '../src/lib/game-browser-url.ts';
import { readCatalogUrl,selectCatalogEntries } from '../src/lib/catalog-selection.ts';
import { buildCatalogPayload } from '../src/lib/catalog-payload.ts';
import type { CatalogRecord } from '../src/lib/catalog-payload.ts';

test('public NotBGG uses fresh isolated D1, source-safe compact DTOs and live archive visibility',async t=>{
 const local=await isolatedNotBggD1(),db=local.db,repo=new NotBggRepository(db),reader=new PublicNotBggReader(db),bgg=getGames();
 const ctx=(idempotencyKey:string)=>({actor:'PRIVATE_ACTOR',idempotencyKey});
 let game:Awaited<ReturnType<typeof repo.create>>['game'];
 try{
  await migrateIsolatedD1(db);
  await t.test('empty NotBGG leaves all 815 BGG entries, source-qualified identities',async()=>{
   const result=await loadPublicCatalog(bgg,db,'zh-TW');assert.equal(result.notBggAvailable,true);assert.equal(result.payload.records.length,815);
   assert.equal(new Set(result.payload.records.map(r=>r.dataset.catalogKey)).size,815);
  });
  await t.test('one creation adds one public item without rebuild, compact excludes private and long fields',async()=>{
   game=(await repo.create({name:'Synthetic <script>name</script>',type:'boardgame',alternateNames:['Alias'],description:'LONG_PUBLIC_DESCRIPTION',editorNotes:'PRIVATE_NOTE',mechanics:['Custom Mechanic'],minPlayers:2,maxPlayers:4,minPlaytime:10,maxPlaytime:30},ctx('PRIVATE_KEY'))).game;
   const result=await loadPublicCatalog(bgg,db,'zh-TW'),json=JSON.stringify(result.payload),r=result.payload.records.at(-1)!;
   assert.equal(result.payload.records.length,816);assert.equal(r.dataset.catalogKey,'NotBGG:000001');assert.equal(r.dataset.bggId,'');assert.equal(r.dataset.itemType,'base');
   assert.equal(r.time,'10–30');assert.equal(r.dataset.bggRating,'');assert.equal(r.dataset.weight,'');
   for(const secret of ['PRIVATE_NOTE','PRIVATE_ACTOR','PRIVATE_KEY','LONG_PUBLIC_DESCRIPTION','editorNotes','request_hash','revision'])assert.ok(!json.includes(secret),secret);
   assert.equal(r.dataset.mechanics,'notbgg:custom%20mechanic');assert.ok(!/^\d+$/.test(r.dataset.mechanics));
   assert.equal(matchesCatalogSearch(r.dataset,'NotBGG:000001'),true);assert.equal(matchesCatalogSearch(r.dataset,'NotBGG:00001'),false);assert.equal(matchesCatalogSearch(r.dataset,'Alias'),true);
   assert.equal(matchesCatalogSearch(r.dataset,'#1'),false);assert.equal(matchesCatalogSearch({bggId:'205637'},'#205637'),true);
  });
  await t.test('public projection does not SELECT private columns and catalog uses one query',async()=>{
   const queries:string[]=[];
   const counted={prepare(sql:string){queries.push(sql);return db.prepare(sql);}} as D1Database;
   await new PublicNotBggReader(counted).catalog('en');assert.equal(queries.length,1);
   for(const sql of queries)assert.doesNotMatch(sql,/editor_notes|snapshot_json|created_by|request_key|n\.\*/);
  });
  await t.test('detail whitelist preserves public fields, nulls and bilingual route',async()=>{
   const result=await reader.detail(game.notBggId,bgg,'en');assert.ok(result);assert.equal(result.game.href,'/en/games/notbgg/000001');assert.equal(result.game.description,'LONG_PUBLIC_DESCRIPTION');
   assert.equal(result.game.yearPublished,null);assert.equal(result.game.bgg,null);assert.equal(result.game.playerAdvice,null);
   assert.ok(!JSON.stringify(result).includes('PRIVATE_'));assert.ok(!JSON.stringify(result).includes('gameId'));
  });
  await t.test('three types and all eight multi-select accessory categories remain independent of BGG relations',async()=>{
   await repo.create({name:'Synthetic expansion',type:'boardgameexpansion'},ctx('expansion'));
   await db.prepare("INSERT INTO v2_games(bgg_id,primary_name,catalog_source) VALUES (205637,'Existing BGG','bgg')").run();
   const kit=(await repo.create({name:'Synthetic accessory',type:'boardgameaccessory',accessoryCategories:[...accessoryCategories],relatedGameIds:[{source:'notbgg',notBggId:game.notBggId},{source:'bgg',bggId:205637}],contents:'Public contents',editorNotes:'PRIVATE_KIT'},ctx('kit'))).game;
   const result=await reader.catalog('en');assert.deepEqual(new Set(result.records.map(r=>r.dataset.itemType)),new Set(['base','expansion','accessory']));
   const r=result.records.find(r=>r.dataset.notBggId===kit.notBggId)!;for(const cat of accessoryCategories)assert.ok(r.dataset.accessoryCategories.split(',').includes(cat));
   assert.equal(r.dataset.minPlayers,'');assert.equal(r.dataset.maxTime,'');assert.equal(r.expansions,0);
   const detail=await reader.detail(kit.notBggId,bgg,'zh-TW');assert.ok(detail);assert.equal(detail.game.play,null);assert.equal(detail.related.length,2);assert.equal(detail.game.accessory?.categories.length,8);assert.equal(detail.game.accessory?.relatedGames.length,2);
   assert.ok(detail.related.some(g=>g.key==='BGG:205637'&&g.href.includes('/games/')));
   await repo.archive(game.notBggId,{actor:'PRIVATE_ACTOR',expectedRevision:1});
   const archivedTarget=await reader.detail(kit.notBggId,bgg,'en');assert.equal(archivedTarget!.related.length,1);assert.equal(archivedTarget!.game.accessory?.relatedGames.length,1);
  });
  await t.test('archive disappears from both catalog and detail, preserves original identity/history',async()=>{
   assert.equal(await reader.detail(game.notBggId,bgg,'zh-TW'),null);assert.ok(!(await reader.catalog('en')).records.some(r=>r.dataset.notBggId===game.notBggId));
   assert.equal((await repo.getRevisionHistory(game.notBggId)).length,2);assert.ok(await repo.getByNotBggId(game.notBggId));
  });
  await t.test('update is visible on next request without application cache',async()=>{
   const exp=(await repo.list({query:'Synthetic expansion'})).items[0];await repo.update(exp.notBggId,{name:'Changed expansion'},{actor:'PRIVATE_ACTOR',expectedRevision:1});
   assert.ok((await reader.catalog('en')).records.some(r=>r.dataset.name==='Changed expansion'));
  });
  await t.test('D6 confirmed mappings retain raw profiles and merge only at public catalog projection',async()=>{
   const exp=(await repo.list({query:'Changed expansion'})).items[0],target=await db.prepare('SELECT id FROM v2_games WHERE bgg_id=205637').first<{id:number}>();
   await db.prepare("INSERT INTO notbgg_bgg_links(seq,candidate_bgg_id,bgg_game_id,status,created_by) VALUES (?,205637,?,'pending','test')").bind(Number(exp.notBggId.slice(7)),target!.id).run();
   assert.ok((await reader.catalog('en')).records.some(r=>r.dataset.notBggId===exp.notBggId));
   await db.prepare("UPDATE notbgg_bgg_links SET status='linked',confirmed_by='test',linked_at=CURRENT_TIMESTAMP WHERE seq=?").bind(Number(exp.notBggId.slice(7))).run();
   assert.ok((await reader.catalog('en')).records.some(r=>r.dataset.notBggId===exp.notBggId));assert.ok(await reader.detail(exp.notBggId,bgg,'en'));
   const merged=await loadPublicCatalog(bgg,db,'en');assert.equal(merged.payload.records.filter(r=>r.dataset.bggId==='205637').length,1);
   assert.equal((await repo.getByNotBggId(exp.notBggId))!.name,'Changed expansion');
  });
 }finally{await local.dispose();}
});

test('missing/failing D1 is generic and BGG remains explicitly partial; URLs reject unsafe protocols',async()=>{
 const bgg=getGames();assert.equal((await loadPublicCatalog(bgg,undefined,'en')).notBggAvailable,false);
 await assert.rejects(new PublicNotBggReader(undefined).catalog('en'),PublicNotBggUnavailable);
 const failing={prepare(){throw new Error('PRIVATE SQL PASSWORD');}} as unknown as D1Database;
 await assert.rejects(new PublicNotBggReader(failing).catalog('en'),e=>e instanceof PublicNotBggUnavailable&&!e.message.includes('PRIVATE'));
 assert.equal(safeImage('javascript:alert(1)'),null);assert.equal(safeImage('https://user:secret@example.com'),null);assert.equal(safeImage('https://example.com/image'),'https://example.com/image');
});
test('accessory URL roundtrip owns only catalog parameters; static BGG detail routes remain static',async()=>{
 const choices={parameters:['q','filter','view','accessory'],defaultSort:'name-asc',filters:['base','all','accessory'],sorts:['name-asc'],players:[],times:[],weights:[],mechanics:[],mechanicTags:[],categories:[],accessories:[...accessoryCategories]};
 const url=new URL('https://example.com/games?filter=accessory&accessory=promo&view=list&q=NotBGG%3A000001'),state=readBrowserUrl(url,choices);
 assert.equal(state.accessory,'promo');assert.equal(readBrowserUrl(writeBrowserUrl(url,state,'name-asc',choices.parameters),choices).accessory,'promo');
 for(const p of ['src/pages/games/[slug].astro','src/pages/en/games/[slug].astro']){const code=await readFile(p,'utf8');assert.match(code,/getStaticPaths/);assert.doesNotMatch(code,/prerender\s*=\s*false/);}
 for(const p of ['src/pages/games.astro','src/pages/en/games.astro','src/pages/games/notbgg/[id].astro','src/pages/en/games/notbgg/[id].astro'])assert.match(await readFile(p,'utf8'),/prerender\s*=\s*false/);
 assert.equal(createHash('sha256').update(await readFile('src/data/bgg-cache.json')).digest('hex'),'1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91');
});
test('shared SSR/browser selection covers six sorts, missing-last, combined filters and deterministic source ties',()=>{
 const payload=buildCatalogPayload(getGames(),'en');
 const rows:CatalogRecord[]=[...payload.records,{...payload.records[0],dataset:{catalogKey:'NotBGG:000001',notBggId:'NotBGG:000001',name:'AAA missing',itemType:'base',year:'',bggRating:'',weight:'',minPlayers:'2',maxPlayers:'4',maxTime:'30',mechanics:'notbgg:custom'}}];
 for(const sort of ['name-asc','name-desc','year-desc','year-asc','bgg-rating-desc','weight-desc']){
  const state=readCatalogUrl(new URL(`https://example.com/games?filter=all&sort=${sort}`),payload.mechanics),result=selectCatalogEntries(rows,state,'en');assert.equal(result.length,816);
  const key=sort.startsWith('year-')?'year':sort==='bgg-rating-desc'?'bggRating':sort==='weight-desc'?'weight':null;
  if(key){let missing=false,last:number|null=null;for(const row of result){const value:number=Number(row.dataset[key]);if(!value){missing=true;continue;}assert.equal(missing,false,'missing statistics sort after real values');if(last!==null)assert.ok(sort==='year-asc'?value>=last:value<=last);last=value;}}
 }
 const state=readCatalogUrl(new URL('https://example.com/games?q=NotBGG:000001&players=3&time=30&mechanic=notbgg:custom'),{'notbgg:custom':'Custom'});
 assert.equal(selectCatalogEntries(rows,state,'en').length,1);state.players='5';assert.equal(selectCatalogEntries(rows,state,'en').length,0);
 const tied:CatalogRecord[]=rows.slice(-1).map(r=>({...r,dataset:{...r.dataset,name:'Same'}}));tied.push({...tied[0],dataset:{...tied[0].dataset,catalogKey:'BGG:1',notBggId:'',bggId:'1'}});
 assert.deepEqual(selectCatalogEntries(tied,readCatalogUrl(new URL('https://example.com/games?filter=all'),{}),'en').map(r=>r.dataset.catalogKey),['BGG:1','NotBGG:000001']);
 assert.equal(readCatalogUrl(new URL('https://example.com/games?accessory=storage'),{}).filter,'accessory');
});
