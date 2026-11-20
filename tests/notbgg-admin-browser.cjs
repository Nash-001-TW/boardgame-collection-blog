// Local real component + signed JWT + isolated D1 only. No production origin or auth bypass.
const assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
 const {isolatedNotBggD1,migrateIsolatedD1}=await import('./helpers/notbgg-local-d1.ts');
 const {accessFixture}=await import('./helpers/notbgg-access-fixture.ts');
 const {adminPreview}=await import('./helpers/notbgg-admin-preview.ts');
 const {authorizeAdminRequest}=await import('../src/lib/auth/admin-request.ts');
 const {handleNotBggAdminRequest}=await import('../src/lib/notbgg-admin-api.ts');
 const {NotBggRepository}=await import('../src/lib/notbgg-repository.ts');
 const local=await isolatedNotBggD1(),auth=await accessFixture();let server,browser;
 try{
  await migrateIsolatedD1(local.db);const bindings={...auth.bindings,DB:local.db,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}},preview=await adminPreview(),jwt=await auth.token();
  const repo=new NotBggRepository(local.db);
  await local.db.prepare("INSERT INTO v2_games(bgg_id,primary_name,catalog_source) VALUES (205637,'Synthetic registered BGG','bgg')").run();
  server=http.createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://'+req.headers.host);const body=[];for await(const chunk of req)body.push(chunk);
   const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(body)});
   let response;
   if(url.pathname.startsWith('/api/admin/notbgg'))response=await handleNotBggAdminRequest(request,bindings);
   else if(url.pathname==='/preview-image.svg')response=new Response('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#0f6b5c"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});
   else if(url.pathname==='/admin-fixture.js')response=new Response(preview.javascript,{headers:{'Content-Type':'text/javascript'}});
   else if(url.pathname.startsWith('/admin/notbgg')){
    const authorized=await authorizeAdminRequest(request,bindings);
    response='admin'in authorized?new Response(await preview.html(url.pathname.endsWith('/new')?'new':url.pathname==='/admin/notbgg'?'list':'edit',
     url.pathname==='/admin/notbgg'||url.pathname.endsWith('/new')?'':'NotBGG:'+url.pathname.split('/').at(-1),url.searchParams.get('lang')==='en'?'en':'zh-TW'),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}):new Response('Unauthorized',{status:authorized.status});
   }else response=new Response('Not found',{status:404});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.statusCode=500;res.end('Local fixture failed');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Taipei',extraHTTPHeaders:{'Cf-Access-Jwt-Assertion':jwt}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const save=page.locator('[data-save]'),type=page.locator('[name=type]');
  await page.goto(origin+'/admin/notbgg/new');if(process.env.NOTBGG_CAPTURE_DIR)await page.screenshot({path:process.env.NOTBGG_CAPTURE_DIR+'/notbgg-desktop.png'});await page.locator('[name=name]').fill('Browser <img src=x onerror=alert(1)>');
  assert.equal(await page.locator('[data-editor]').evaluate(f=>new Set(Array.from(f.querySelectorAll('[name]'),x=>x.name)).size),24);
  const preserved={alternateNames:'Alias one\n別名',description:'Synthetic description',yearPublished:'2026',minAge:'0',minPlaytime:'30',maxPlaytime:'60',recommendedPlayers:'2, 3',designers:'Designer A',artists:'Artist A',publishers:'Publisher A',categories:'Category A',mechanics:'Mechanic A',families:'Family A',imageUrl:'https://example.invalid/image.png',thumbnailUrl:'https://example.invalid/thumb.png',referenceUrls:'https://example.invalid/reference'};
  for(const [key,value] of Object.entries(preserved))await page.locator('[name='+key+']').fill(value);
  await page.locator('[name=minPlayers]').fill('2');await page.locator('[name=maxPlayers]').fill('4');
  page.once('dialog',d=>d.dismiss());await type.selectOption('boardgameaccessory');
  assert.equal(await type.inputValue(),'boardgame');assert.equal(await page.locator('[name=minPlayers]').inputValue(),'2');
  page.once('dialog',d=>d.accept());await type.selectOption('boardgameaccessory');
  assert.equal(await page.locator('[data-group=play]').isVisible(),false);assert.equal(await page.locator('[name=minPlayers]').inputValue(),'');
  await save.click();assert.match(await page.locator('[data-error=accessoryCategories]').textContent(),/檢查/);
  await page.locator('[value=storage]').check();await page.locator('[value=promo]').check();
  await page.locator('[name=relatedGameIds]').fill('NotBGG:888888');await save.click();
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('尚未登記'));
  await page.locator('[name=contents]').fill('Synthetic accessory contents');await page.locator('[name=relatedGameIds]').fill('BGG:205637');await page.locator('[name=editorNotes]').fill('PRIVATE BROWSER NOTE');
  // Two synchronous submits still have only one active request and one creation key.
  await page.locator('[data-editor]').evaluate(form=>{form.requestSubmit();form.requestSubmit()});
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('已儲存 NotBGG:000001'));
  assert.equal((await repo.list({includeArchived:true})).items.length,1);
  assert.equal(await page.locator('[data-system]').textContent().then(s=>s.includes('Revision1')),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const retained=await repo.getByNotBggId('NotBGG:000001');
  assert.equal(retained.minPlayers,null);assert.equal(retained.recommendedPlayers,null);assert.equal(retained.minPlaytime,null);
  for(const key of ['designers','artists','publishers','categories','mechanics','families'])assert.deepEqual(retained[key],[preserved[key]]);
  assert.deepEqual(retained.alternateNames,['Alias one','別名']);assert.equal(retained.description,preserved.description);assert.equal(retained.yearPublished,2026);assert.equal(retained.minAge,0);
  assert.equal(retained.contents,'Synthetic accessory contents');assert.deepEqual(retained.relatedGameIds,[{source:'bgg',bggId:205637}]);
  for(const key of ['imageUrl','thumbnailUrl'])assert.equal(retained[key],preserved[key]);assert.deepEqual(retained.referenceUrls,[preserved.referenceUrls]);
  await page.locator('[name=description]').fill('Discard this draft');assert.equal(await page.locator('[data-archive]').isDisabled(),true);
  page.once('dialog',d=>d.accept());await page.locator('[data-discard]').click();assert.equal(await page.locator('[name=description]').inputValue(),preserved.description);assert.equal(await page.locator('[data-archive]').isEnabled(),true);
  // Presentation refinements must never write or change form dirty state by themselves.
  const presentationRequests=[];const trackRequest=r=>{if(r.url().includes('/api/admin/')&&r.method()!=='GET')presentationRequests.push(r.method());};page.on('request',trackRequest);
  const cover=page.locator('[data-image-preview=imageUrl]'),thumb=page.locator('[data-image-preview=thumbnailUrl]');
  const previewButton=cover.locator('[data-preview-refresh]');assert.equal(await page.locator('[data-dirty-state]').getAttribute('data-dirty'),'false');
  await previewButton.click();await page.waitForFunction(()=>document.querySelector('[data-image-preview=imageUrl]').dataset.state==='failed');
  assert.equal(await page.locator('[data-dirty-state]').getAttribute('data-dirty'),'false');assert.equal(await page.locator('[name=imageUrl]').inputValue(),preserved.imageUrl);
  for(const invalid of ['javascript:alert(1)','data:image/png;base64,AAAA','file:///tmp/x.png','https://user:pass@example.invalid/a.png']){
   await page.locator('[name=imageUrl]').fill(invalid);await previewButton.click();assert.equal(await cover.getAttribute('data-state'),'invalid');assert.equal(await cover.locator('img').count(),0);
  }
  await page.locator('[name=imageUrl]').fill(origin+'/preview-image.svg');const dirtyBeforePreview=await page.locator('[data-dirty-state]').getAttribute('data-dirty');await previewButton.click();
  await page.waitForFunction(()=>document.querySelector('[data-image-preview=imageUrl]').dataset.state==='loaded');assert.equal(await page.locator('[data-dirty-state]').getAttribute('data-dirty'),dirtyBeforePreview);
  assert.equal(await cover.locator('img').getAttribute('referrerpolicy'),'no-referrer');
  await context.route('https://preview-images.example.test/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="green"/></svg>'}));
  await page.locator('[name=thumbnailUrl]').fill('https://preview-images.example.test/thumb.svg');await thumb.locator('[data-preview-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-image-preview=thumbnailUrl]').dataset.state==='loaded');
  await page.locator('[name=imageUrl]').fill(origin+'/preview-missing.png');await previewButton.click();await page.waitForFunction(()=>document.querySelector('[data-image-preview=imageUrl]').dataset.state==='failed');assert.match(await cover.textContent(),/無法載入圖片/);
  await page.locator('[name=imageUrl]').fill('');await previewButton.click();assert.equal(await cover.getAttribute('data-state'),'empty');
  assert.equal(presentationRequests.length,0);page.removeListener('request',trackRequest);
  page.once('dialog',d=>d.accept());await page.locator('[data-discard]').click();assert.equal(await page.locator('[data-dirty-state]').getAttribute('data-dirty'),'false');
  assert.equal(await page.locator('[data-status]').getAttribute('data-tone'),'success');
  const time=page.locator('[data-system] time').first();assert.equal(await time.getAttribute('title'),retained.createdAt);
  assert.equal(await time.evaluate(el=>el.textContent===new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(el.dataset.rawTime))),true);
  const west=await browser.newContext({timezoneId:'America/Los_Angeles',extraHTTPHeaders:{'Cf-Access-Jwt-Assertion':jwt}});await west.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const westPage=await west.newPage();await westPage.goto(origin+'/admin/notbgg/000001');await westPage.locator('[data-system] time').first().waitFor();assert.notEqual(await westPage.locator('[data-system] time').first().textContent(),await time.textContent());assert.equal(await westPage.locator('[data-system] time').first().getAttribute('title'),retained.createdAt);await west.close();
  for(const [width,height] of [[1366,768],[1920,1080]]){
   await page.setViewportSize({width,height});await page.locator('[data-section-link=sources]').click();
   await page.waitForFunction(()=>document.querySelector('[data-section-link=sources]').getAttribute('aria-current')==='location');
   assert.equal(await page.evaluate(()=>{const section=document.querySelector('#section-sources').getBoundingClientRect(),head=document.querySelector('.editor-heading').getBoundingClientRect();return section.top>=head.bottom-1&&section.top<innerHeight}),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.NOTBGG_CAPTURE_DIR)await page.screenshot({path:process.env.NOTBGG_CAPTURE_DIR+'/sources-'+width+'.png'});
   await page.locator('#section-publication').evaluate(el=>el.scrollIntoView({block:'start'}));await page.waitForFunction(()=>document.querySelector('[data-section-link=publication]').getAttribute('aria-current')==='location');
   await page.locator('[data-editor-tab=history]').click();await page.waitForTimeout(50);assert.equal(await page.locator('[data-editor-tab=history]').getAttribute('aria-selected'),'true');await page.locator('[data-editor-tab=basic]').click();
  }
  await page.setViewportSize({width:1440,height:1000});
  // Conflict uses a separate real repository writer, preserving the user's input.
  await repo.update('NotBGG:000001',{name:'Other editor'},{actor:'other-verified-operator',expectedRevision:1});
  await page.locator('[name=name]').fill('My unsaved edit');await save.click();
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('其他操作修改'));
  assert.equal(await page.locator('[name=name]').inputValue(),'My unsaved edit');assert.equal(await page.locator('[data-status]').getAttribute('data-tone'),'error');
  assert.equal((await repo.getByNotBggId('NotBGG:000001')).name,'Other editor');
  page.once('dialog',d=>d.accept());await page.locator('[data-reload]').click();
  await page.waitForFunction(()=>document.querySelector('[name=name]').value==='Other editor');
  // Switching out of accessory also requires confirmation and preserves data on cancel.
  page.once('dialog',d=>d.dismiss());await type.selectOption('boardgame');assert.equal(await type.inputValue(),'boardgameaccessory');
  assert.equal(await page.locator('[value=storage]').isChecked(),true);
  await page.locator('[data-editor-tab=basic]').focus();await page.locator('[data-editor-tab=basic]').press('End');assert.equal(await page.locator('[data-editor-tab=history]').getAttribute('aria-selected'),'true');await page.locator('[data-history-load]').click();await page.locator('[data-history] summary').first().waitFor();
  assert.equal(await page.locator('[data-history] summary').count(),2);assert.equal(await page.locator('[data-history] img').count(),0);assert.match(await page.locator('[data-history]').textContent(),/verified-admin-subject/);
  await page.locator('[data-editor-tab=basic]').click();await page.setViewportSize({width:390,height:844});if(process.env.NOTBGG_CAPTURE_DIR)await page.screenshot({path:process.env.NOTBGG_CAPTURE_DIR+'/notbgg-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  page.once('dialog',d=>d.dismiss());await page.locator('[data-archive]').click();assert.equal((await repo.getByNotBggId('NotBGG:000001')).archivedAt,null);
  page.once('dialog',d=>d.accept());await page.locator('[data-archive]').click();
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('已封存'));
  assert.equal(await save.isDisabled(),true);assert.equal(await page.locator('[name=name]').isDisabled(),true);assert.equal(await page.locator('[data-archived-notice]').isVisible(),true);assert.ok((await repo.getByNotBggId('NotBGG:000001')).archivedAt);assert.equal((await repo.getRevisionHistory('NotBGG:000001')).length,3);
  await Promise.all(Array.from({length:21},(_,i)=>repo.create({name:'Page fixture '+i,type:'boardgame'},{actor:'test-seed',idempotencyKey:'browser-page-'+i})));
  await page.goto(origin+'/admin/notbgg?lang=en');await page.locator('[name=includeArchived]').check();await page.locator('[data-search-form] button').click();
  await page.waitForFunction(()=>document.querySelector('[data-list]').textContent.includes('Archived'));assert.match(await page.locator('[data-list]').textContent(),/Archived/);
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('20 records'));await page.locator('[data-next]').click();
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('2 records'));assert.equal(await page.locator('[data-list] a').count(),2);
  await page.locator('[data-prev]').click();await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('20 records'));
  await page.locator('[name=q]').fill('NotBGG:000001');await page.locator('[name=q]').press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('1 records'));
  assert.equal(await page.locator('[data-list] a').count(),1);assert.ok(!(await page.locator('[data-list]').textContent()).includes('PRIVATE BROWSER NOTE'));
  await page.goto(origin+'/admin/notbgg/888888');await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('找不到'));assert.equal(await save.isDisabled(),true);
  await page.goto(origin+'/admin/notbgg/new?lang=en');assert.equal(await page.locator('[data-heading-name]').textContent(),'New NotBGG game');assert.equal(await page.locator('[data-editor-tab=history]').isDisabled(),true);
  const noJs=await browser.newContext({javaScriptEnabled:false,extraHTTPHeaders:{'Cf-Access-Jwt-Assertion':jwt}});const basic=await noJs.newPage();await basic.goto(origin+'/admin/notbgg/new');assert.equal(await basic.locator('[data-save]').isDisabled(),true);await noJs.close();
  // beforeunload is tested with a real input gesture and a cancelled navigation.
  await page.goto(origin+'/admin/notbgg/new');await page.locator('[name=name]').fill('Unsaved draft');await page.locator('[name=name]').press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'alternateNames');
  const unload=page.waitForEvent('dialog');const leaving=page.locator('nav a').nth(1).click({noWaitAfter:true});
  const dialog=await unload;assert.equal(dialog.type(),'beforeunload');await dialog.dismiss();await leaving;
  assert.equal(await page.locator('[name=name]').inputValue(),'Unsaved draft');
  assert.deepEqual(errors,[]);
  const anonymous=await browser.newContext();const denied=await anonymous.newPage();assert.equal((await denied.goto(origin+'/admin/notbgg')).status(),401);await anonymous.close();
  console.log(JSON.stringify({result:'PASS',cases:['HTTP(S) previews/invalid/error/no-write/no-dirty','1366x768 and 1920x1080 scroll and tabs','local time in Taipei and Los Angeles','desktop/mobile real component','confirmed type clearing/cancellation','required categories','mixed identity references','duplicate submit','revision conflict/reload','read-only private history','archive confirmation/history','search','beforeunload','anonymous denied'],browserErrors:errors.length}));
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await local.dispose();auth.restore()}
})().catch(error=>{console.error(error);process.exitCode=1});
