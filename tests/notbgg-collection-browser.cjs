const assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
 const {isolatedNotBggD1,migrateIsolatedD1}=await import('./helpers/notbgg-local-d1.ts');
 const {accessFixture}=await import('./helpers/notbgg-access-fixture.ts');
 const {adminPreview}=await import('./helpers/notbgg-admin-preview.ts');
 const {createLocalGamesPreview}=await import('../scripts/lib/local-games-preview.ts');
 const {authorizeAdminRequest}=await import('../src/lib/auth/admin-request.ts');
 const {handleCollectionAdminRequest}=await import('../src/lib/collection-admin-api.ts');
 const {CollectionV2Repository}=await import('../src/lib/collection-v2-repository.ts');
 const {NotBggRepository}=await import('../src/lib/notbgg-repository.ts');
 const local=await isolatedNotBggD1(),auth=await accessFixture();let server,browser;
 try{
  await migrateIsolatedD1(local.db);const bindings={...auth.bindings,DB:local.db,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}},preview=await adminPreview('collection'),publicPreview=await createLocalGamesPreview({publicDb:local.db}),jwt=await auth.token();
  const repo=new NotBggRepository(local.db),collection=new CollectionV2Repository(local.db);
  const base=(await repo.create({name:'Browser NotBGG base',type:'boardgame',imageUrl:'https://synthetic.example/cover',editorNotes:'PRIVATE_EDITOR_NOTE'},{actor:'seed',idempotencyKey:'d5-base'})).game;
  const kit=(await repo.create({name:'Browser NotBGG accessory',type:'boardgameaccessory',accessoryCategories:['storage']},{actor:'seed',idempotencyKey:'d5-kit'})).game;
  await local.db.prepare("INSERT INTO v2_games(bgg_id,primary_name,catalog_source) VALUES(205637,'BGG target','bgg') ON CONFLICT(bgg_id) DO NOTHING").run();
  server=http.createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://'+req.headers.host),chunks=[];for await(const c of req)chunks.push(c);
   const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});let response;
   if(url.pathname.startsWith('/api/admin/'))response=await handleCollectionAdminRequest(request,bindings);
   else if(url.pathname==='/admin-fixture.js')response=new Response(preview.javascript,{headers:{'Content-Type':'text/javascript'}});
   else if(url.pathname==='/preview-games.js')response=new Response(publicPreview.javascript,{headers:{'Content-Type':'text/javascript'}});
   else if(url.pathname.startsWith('/admin/')){const authorized=await authorizeAdminRequest(request,bindings);const rel=url.pathname.match(/^\/admin\/notbgg\/(\d+)\/relations$/),id=url.pathname.split('/').at(-1);
    response='admin'in authorized?new Response(await preview.html(rel?'relations':id==='new'?'new':/\d+/.test(id)?'edit':'list',rel?'NotBGG:'+rel[1]:id,url.searchParams.get('lang')==='en'?'en':'zh-TW'),{headers:{'Content-Type':'text/html; charset=utf-8'}}):new Response('Unauthorized',{status:authorized.status});
   }else{const html=await publicPreview.html(url);response=new Response(html||'Not found',{status:html?200:404,headers:{'Content-Type':'text/html; charset=utf-8'}});}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){console.error(e);res.statusCode=500;res.end('Fixture unavailable');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
  const unauthorized=await browser.newContext();assert.equal((await (await unauthorized.newPage()).goto(origin+'/admin/collection')).status(),401);await unauthorized.close();
  const context=await browser.newContext({viewport:{width:1440,height:1000},extraHTTPHeaders:{'Cf-Access-Jwt-Assertion':jwt}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"/>'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/games/notbgg/000001');await page.locator('[data-live-notbgg]').waitFor();await page.getByRole('link',{name:'管理員加入收藏'}).click();await page.locator('[data-game-results] button').waitFor();await page.locator('[data-game-results] button').first().click();
  await page.locator('[name=displayName]').fill('Private collection name');await page.locator('[name=language]').fill('zh-TW');await page.locator('[name=priceMinor]').fill('250000');await page.locator('[name=merchant]').fill('PRIVATE_BROWSER_SHOP');await page.locator('[name=purchaseDate]').fill('2026-11-01');await page.locator('[name=comment]').fill('PRIVATE_BROWSER_COMMENT');
  await page.locator('[data-collection-form]').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await page.waitForFunction(()=>document.querySelector('[data-admin-status]').textContent.includes('已儲存'));
  const id=Number(new URL(page.url()).pathname.split('/').at(-1));assert.ok(id);const data=await collection.management.detail(id,'production');assert.equal(data.copies.length,1);assert.equal(data.purchases[0].unit_price_minor,250000);
  await page.locator('[name=displayName]').fill('My pending edit');
  await collection.management.update(id,{displayName:'Other editor',acquisitionStatus:'owned',language:'zh-TW',priceMinor:250000,currency:'TWD',merchant:'PRIVATE_BROWSER_SHOP',purchaseDate:'2026-11-01'},{actor:'other',scope:'production',expectedRevision:1});
  await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('[data-admin-status]').textContent.includes('409'));assert.equal(await page.locator('[name=displayName]').inputValue(),'My pending edit');
  page.once('dialog',d=>d.accept());await page.locator('[data-admin-reload]').click();await page.waitForFunction(()=>document.querySelector('[name=displayName]').value==='Other editor');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[name=displayName]').fill('Mobile edit');await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('[data-admin-status]').textContent.includes('已儲存'));
  await page.goto(origin+'/en/collection');await page.locator('[data-collection-id="'+id+'"]').waitFor();assert.match(await page.locator('[data-collection-id="'+id+'"]').textContent(),/NotBGG:000001/);assert.equal(await page.locator('[data-collection-id="'+id+'"] img').getAttribute('src'),'https://synthetic.example/cover');assert.ok(!(await page.content()).includes('PRIVATE_BROWSER_'));assert.ok(!(await page.content()).includes('PRIVATE_EDITOR_NOTE'));
  await page.locator('[data-collection-id="'+id+'"] .cover-link').click();assert.equal(new URL(page.url()).pathname,'/en/games/notbgg/000001');
  await page.goto(origin+'/admin/notbgg/000002/relations?lang=en');await page.locator('[name=target]').fill('NotBGG:000001');await page.locator('[name=relationType]').selectOption('compatible_with');await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('[data-relation-list]').textContent.includes('compatible_with'));
  await page.locator('[name=target]').fill('BGG:205637');await page.locator('[name=relationType]').selectOption('accessory_for');await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-relation-list] .record').length===2);
  await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('[data-admin-status]').textContent.includes('DUPLICATE_RELATION'));
  await repo.archive(base.notBggId,{actor:'test',expectedRevision:1});await page.goto(origin+'/admin/collection/'+id+'?lang=en');await page.waitForFunction(()=>document.querySelector('[data-system]')?.textContent.includes('Game archived'));assert.equal((await collection.management.detail(id,'production')).copies.length,1);
  page.once('dialog',d=>d.accept());await page.locator('[data-archive]').click();await page.waitForFunction(()=>document.querySelector('[data-admin-status]').textContent==='Archived');assert.equal((await collection.management.detail(id,'production')).copies.length,1);
  await page.goto(origin+'/collection');assert.equal(await page.locator('[data-collection-id="'+id+'"]').count(),0);
  await page.goto(origin+'/admin/collection/new?scope=test&lang=en&game=NotBGG:000002');await page.locator('[data-game-results] button').waitFor();await page.locator('[data-game-results] button').first().click();await page.locator('[name=createCopy]').uncheck();await page.locator('[name=acquisitionStatus]').selectOption('wishlist');await page.locator('[name=wishlist]').check();await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('[data-admin-status]').textContent.includes('Saved collection'));
  assert.equal((await collection.getProductionItems()).filter(r=>r.game_id===kit.gameId).length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',desktop:true,mobile:true,checks:'signed Access; source detail→add; duplicate submit; purchase/language; edit/CAS; archive retention; public privacy/links; two relation types; scope isolation'}));
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));auth.restore();await local.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1});
