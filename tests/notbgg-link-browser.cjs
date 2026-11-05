const assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
 const {isolatedNotBggD1,migrateIsolatedD1}=await import('./helpers/notbgg-local-d1.ts');
 const {accessFixture}=await import('./helpers/notbgg-access-fixture.ts');
 const {adminPreview}=await import('./helpers/notbgg-admin-preview.ts');
 const {createLocalGamesPreview}=await import('../scripts/lib/local-games-preview.ts');
 const {authorizeAdminRequest}=await import('../src/lib/auth/admin-request.ts');
 const {handleNotBggLinkRequest}=await import('../src/lib/notbgg-link-api.ts');
 const {NotBggRepository}=await import('../src/lib/notbgg-repository.ts');
 const {NotBggLinkRepository}=await import('../src/lib/notbgg-link-repository.ts');
 const {CollectionV2Repository}=await import('../src/lib/collection-v2-repository.ts');
 const local=await isolatedNotBggD1(),auth=await accessFixture();let server,browser;
 try{
  await migrateIsolatedD1(local.db);const repo=new NotBggRepository(local.db),links=new NotBggLinkRepository(local.db),collection=new CollectionV2Repository(local.db);
  const original=(await repo.create({name:'Browser D6 original <script>safe</script>',type:'boardgame',editorNotes:'PRIVATE_D6_EDITOR',imageUrl:'https://synthetic.example/cover'},{actor:'seed',idempotencyKey:'d6-browser-source'})).game;
  const accessory=(await repo.create({name:'Browser D6 accessory',type:'boardgameaccessory',accessoryCategories:['storage'],relatedGameIds:[{source:'notbgg',notBggId:original.notBggId}]},{actor:'seed',idempotencyKey:'d6-browser-accessory'})).game;
  const input={displayName:'Personal collection label',acquisitionStatus:'owned',language:'zh-TW',priceMinor:200000,currency:'TWD',merchant:'PRIVATE_D6_MERCHANT',comment:'PRIVATE_D6_COMMENT'};
  const own=await collection.management.create({source:'notbgg',notBggId:original.notBggId},input,{actor:'seed',idempotencyKey:'d6-browser-own',scope:'production',createCopy:true});
  const bggOwn=await collection.management.create({source:'bgg',bggId:194655},{...input,displayName:'BGG collection original'},{actor:'seed',idempotencyKey:'d6-browser-bg-own',scope:'production',createCopy:true});
  const copyBefore=await collection.management.detail(own.collectionId,'production'),edgeBefore=(await local.db.prepare('SELECT * FROM site_game_relations').all()).results;
  const preview=await adminPreview('link'),publicPreview=await createLocalGamesPreview({publicDb:local.db}),jwt=await auth.token(),bindings={...auth.bindings,DB:local.db,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
  server=http.createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://'+req.headers.host),chunks=[];for await(const c of req)chunks.push(c);const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});let response;
   if(url.pathname.startsWith('/api/admin/'))response=await handleNotBggLinkRequest(request,bindings);
   else if(url.pathname==='/admin-fixture.js')response=new Response(preview.javascript,{headers:{'Content-Type':'text/javascript'}});
   else if(url.pathname==='/preview-games.js')response=new Response(publicPreview.javascript,{headers:{'Content-Type':'text/javascript'}});
   else if(url.pathname.startsWith('/admin/')){const allowed=await authorizeAdminRequest(request,bindings);response='admin'in allowed?new Response(await preview.html('edit',original.notBggId,url.searchParams.get('lang')==='en'?'en':'zh-TW'),{headers:{'Content-Type':'text/html; charset=utf-8'}}):new Response('Unauthorized',{status:allowed.status});}
   else{const redirect=await publicPreview.redirect(url);if(redirect)response=new Response(null,{status:307,headers:{Location:redirect}});else{const html=await publicPreview.html(url);response=new Response(html||'Not found',{status:html?200:404,headers:{'Content-Type':'text/html; charset=utf-8'}});}}
   response.headers.set('Cache-Control','no-store');res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){console.error(e);res.statusCode=500;res.end('Fixture unavailable');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.argv[3]});const anon=await browser.newContext();assert.equal((await(await anon.newPage()).goto(origin+'/admin/notbgg/000001/link')).status(),401);await anon.close();
  const context=await browser.newContext({viewport:{width:1440,height:1000},extraHTTPHeaders:{'Cf-Access-Jwt-Assertion':jwt}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"/>'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>document.querySelector('[data-game-result-count]')?.textContent),cards=()=>page.locator('[data-game-grid]>[data-game-card]');
  await page.goto(origin+'/admin/notbgg/000001/link?lang=en');await page.waitForFunction(()=>document.querySelector('[data-link-state]').textContent.includes('unlinked'));
  await page.locator('[name=bggId]').fill('999999999');await page.locator('[data-compare-form] button').click();await page.waitForFunction(()=>document.querySelector('[data-link-status]').textContent.includes('TARGET_NOT_FOUND'));
  await page.locator('[name=bggId]').fill('194655');await page.locator('[data-compare-form] button').click();await page.locator('[data-link-comparison] section').first().waitFor();assert.equal(await page.locator('[data-link-comparison] h2 script').count(),0);
  await page.locator('[name=reason]').fill('Manual comparison reason');await page.locator('[data-command=propose]').click();await page.waitForFunction(()=>document.querySelector('[data-link-state]').textContent.includes('candidate'));
  assert.equal((await links.state(original.notBggId)).state,'candidate');
  page.once('dialog',d=>d.dismiss());await page.locator('[data-command=confirm]').click();assert.equal((await links.state(original.notBggId)).state,'candidate');
  page.once('dialog',d=>d.accept());await page.locator('[data-command=confirm]').click();await page.waitForFunction(()=>document.querySelector('[data-link-state]').textContent.startsWith('linked'));
  assert.equal((await links.state(original.notBggId)).link.primary_source,'notbgg');await page.waitForFunction(()=>document.querySelectorAll('[data-link-history] li').length===2);
  await page.goto(origin+'/games?filter=all&q=%23194655');await ready();assert.equal(await cards().count(),1);assert.equal(await cards().first().getAttribute('data-source'),'notbgg');assert.equal(await cards().first().getAttribute('data-catalog-key'),original.notBggId);assert.ok(!(await page.content()).includes('PRIVATE_D6_'));
  await page.locator('[data-game-view=list]').click();const returnUrl=page.url();await cards().locator('a').click();assert.equal(new URL(page.url()).pathname,'/games/notbgg/000001');assert.match(await page.locator('[data-identity-notice]').textContent(),/194655/);assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),origin+'/games/notbgg/000001');
  await page.locator('[data-detail-back]').click();await ready();assert.equal(page.url(),returnUrl);
  await page.goto(origin+'/en/games/santorini');assert.equal(new URL(page.url()).pathname,'/en/games/notbgg/000001');assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),origin+'/en/games/notbgg/000001');
  await page.goto(origin+'/admin/notbgg/000001/link?lang=en');await page.waitForFunction(()=>document.querySelector('[data-link-state]').textContent.startsWith('linked'));await page.locator('[name=reason]').fill('Explicit BGG primary');await page.locator('[data-command=bgg]').click();await page.waitForFunction(()=>document.querySelector('[data-link-state]').textContent.includes(' · bgg ·'));
  await page.goto(origin+'/en/games/notbgg/000001');assert.equal(new URL(page.url()).pathname,'/en/games/santorini');assert.match(await page.locator('[data-identity-notice]').textContent(),/NotBGG:000001/);assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),origin+'/en/games/santorini');
  await page.goto(origin+'/games?filter=all&q=NotBGG%3A000001');await ready();assert.equal(await cards().count(),1);assert.equal(await cards().first().getAttribute('data-source'),'bgg');assert.equal(await cards().locator('a').getAttribute('href'),'/games/santorini');
  await page.goto(origin+'/en/collection');assert.equal(await page.locator('[data-collection-id="'+own.collectionId+'"] .cover-link').getAttribute('href'),'/en/games/santorini');assert.equal(await page.locator('[data-collection-id="'+bggOwn.collectionId+'"] .cover-link').getAttribute('href'),'/en/games/santorini');assert.ok(!(await page.content()).includes('PRIVATE_D6_'));
  assert.match(await page.locator('[data-collection-id="'+own.collectionId+'"] [data-collection-origin]').textContent(),/NotBGG:000001/);
  await page.goto(origin+'/games/notbgg/'+accessory.notBggId.slice(7));assert.equal(await page.locator('.related a').getAttribute('href'),'/games/santorini');
  await page.goto(origin+'/admin/notbgg/000001/link?lang=en');await page.waitForFunction(()=>document.querySelector('[data-link-state]').textContent.includes(' · bgg ·'));await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const latest=await links.state(original.notBggId);await links.execute(original.notBggId,{action:'primary',expectedProfileRevision:latest.original.revision,expectedEventId:latest.expectedEventId,linkId:latest.link.id,primarySource:'notbgg',reason:'other administrator'},'other');
  await page.locator('[name=reason]').fill('Revoke after checking');page.once('dialog',d=>d.accept());await page.locator('[data-command=revoke]').click();await page.waitForFunction(()=>document.querySelector('[data-link-status]').textContent.includes('409'));assert.equal((await links.state(original.notBggId)).state,'linked');
  await page.locator('[data-link-reload]').click();await page.waitForFunction(()=>document.querySelector('[data-link-status]').textContent==='Latest state loaded');page.once('dialog',d=>d.accept());await page.locator('[data-command=revoke]').click();await page.waitForFunction(()=>document.querySelector('[data-link-state]').textContent.startsWith('unlinked'));await page.waitForFunction(()=>document.querySelectorAll('[data-link-history] li').length>=5);
  await page.goto(origin+'/games?filter=all&page=35');await ready();assert.equal(await cards().count(),817);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.goto(origin+'/en/collection');assert.equal(await page.locator('[data-collection-id="'+own.collectionId+'"] .cover-link').getAttribute('href'),'/en/games/notbgg/000001');assert.equal(await page.locator('[data-collection-id="'+bggOwn.collectionId+'"] .cover-link').getAttribute('href'),'/en/games/santorini');
  assert.deepEqual(await collection.management.detail(own.collectionId,'production'),copyBefore);assert.deepEqual((await local.db.prepare('SELECT * FROM site_game_relations').all()).results,edgeBefore);
  await page.goto(origin+'/games/notbgg/000001');assert.match(await page.locator('h1').textContent(),/Browser D6 original/);
  await repo.archive(original.notBggId,{actor:'seed',expectedRevision:1});assert.equal((await page.goto(origin+'/games/notbgg/000001')).status(),404);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',desktop:true,mobile:true,checks:'candidate/confirm/cancel; primary switch; CAS conflict/reload; both aliases and canonical; custom slug; exact searches; Grid/List/URL/back; collection and edge preservation; revoke; archive/privacy; no name merge'}));
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));auth.restore();await local.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1});
