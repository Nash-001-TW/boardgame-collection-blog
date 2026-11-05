// Real Astro components/controllers with a fresh isolated local D1. All external images are synthetic.
const assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require(process.argv[2]||'playwright');
(async()=>{
 const {isolatedNotBggD1,migrateIsolatedD1}=await import('./helpers/notbgg-local-d1.ts');
 const {NotBggRepository}=await import('../src/lib/notbgg-repository.ts');
 const {createLocalGamesPreview}=await import('../scripts/lib/local-games-preview.ts');
 const {accessoryCategories}=await import('../src/lib/notbgg-contract.ts');
 const local=await isolatedNotBggD1();let browser,server;
 try{
  await migrateIsolatedD1(local.db);const repo=new NotBggRepository(local.db),preview=await createLocalGamesPreview({publicDb:local.db});
  server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://'+req.headers.host);
   if(url.pathname==='/preview-games.js'){res.setHeader('Content-Type','text/javascript');res.end(preview.javascript);return;}
   const html=await preview.html(url);res.writeHead(html?200:404,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html||'Game not found');
  }catch(e){console.error(e);res.statusCode=500;res.end('Unavailable');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.argv[3]});const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const requests=[];await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin===origin)return r.continue();requests.push(url.href);
   if(url.hostname==='synthetic.example'&&url.pathname.includes('fail'))return r.fulfill({status:404,body:'Unavailable'});
   return r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#5a7c90"/></svg>'});});
  await context.addInitScript(()=>{window.metrics={lcp:null,cls:0};new PerformanceObserver(l=>{for(const e of l.getEntries())window.metrics.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.metrics.cls+=e.value}).observe({type:'layout-shift',buffered:true});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cards=()=>page.locator('[data-game-grid] > [data-game-card]');
  async function ready(){await page.waitForFunction(()=>document.querySelector('[data-game-result-count]')?.textContent);}
  async function search(value){await page.locator('[data-game-search]').fill(value);await page.waitForTimeout(300);}
  await page.goto(origin+'/games?filter=all');await ready();assert.equal(await cards().count(),24);assert.match(await page.locator('[data-game-result-count]').textContent(),/815/);
  const initial=await page.evaluate(()=>({dcl:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,...window.metrics}));
  const ctx=key=>({actor:'PRIVATE_PUBLIC_BROWSER_ACTOR',idempotencyKey:key});
  const base=(await repo.create({name:'AAA Synthetic public <img onerror=alert(1)>',type:'boardgame',alternateNames:['Synthetic alias'],minPlayers:2,maxPlayers:4,minPlaytime:10,maxPlaytime:30,description:'<script>alert(1)</script> SAFE TEXT',editorNotes:'PRIVATE_PUBLIC_BROWSER_NOTE',imageUrl:'https://synthetic.example/full',thumbnailUrl:'https://synthetic.example/thumb',mechanics:['Synthetic mechanic']},ctx('base'))).game;
  await repo.create({name:'Synthetic expansion',type:'boardgameexpansion'},ctx('exp'));
  await local.db.prepare("INSERT INTO v2_games(bgg_id,primary_name,catalog_source) VALUES (205637,'Existing BGG','bgg')").run();
  const kit=(await repo.create({name:'Synthetic accessory '+('很長的名稱'.repeat(12)),type:'boardgameaccessory',accessoryCategories:[...accessoryCategories],relatedGameIds:[{source:'notbgg',notBggId:base.notBggId},{source:'bgg',bggId:205637}],contents:'Synthetic contents',imageUrl:'https://synthetic.example/fail-full',thumbnailUrl:'https://synthetic.example/fail-thumb',editorNotes:'PRIVATE_KIT'},ctx('kit'))).game;
  await page.reload();await ready();assert.match(await page.locator('[data-game-result-count]').textContent(),/818/);assert.equal(await cards().count(),24);
  const moreStart=performance.now();await page.locator('[data-load-more]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-game-grid] > [data-game-card]').length===48);const moreMs=performance.now()-moreStart;
  // Explicit page restores all entries; source keys never collide.
  await page.goto(origin+'/games?filter=all&page=35');await ready();assert.equal(await cards().count(),818);
  assert.equal(await cards().evaluateAll(nodes=>new Set(nodes.map(n=>n.dataset.catalogKey)).size),818);
  const accessoryCard=page.locator(`[data-game-grid] > [data-catalog-key="${kit.notBggId}"]`);
  await accessoryCard.scrollIntoViewIfNeeded();const previousY=await accessoryCard.evaluate(el=>el.getBoundingClientRect().top);
  await accessoryCard.locator('a').click();await page.locator('[data-live-notbgg]').waitFor();
  await page.locator('[data-detail-back]').click();await ready();await page.waitForTimeout(200);
  assert.equal(await cards().count(),818);assert.ok(Math.abs(await accessoryCard.evaluate(el=>el.getBoundingClientRect().top)-previousY)<60,'source-qualified scroll anchor restored');
  await page.goForward();await page.locator('[data-live-notbgg]').waitFor();await page.goBack();await ready();assert.equal(await cards().count(),818);
  await page.goto(origin+'/games');await ready();const searchStart=performance.now();await search(base.notBggId);assert.equal(await cards().count(),1);const searchMs=performance.now()-searchStart;
  assert.equal(await cards().first().getAttribute('data-catalog-key'),base.notBggId);assert.equal(await cards().locator('h2 img').count(),0);
  await page.waitForFunction(()=>document.querySelector('[data-game-card] img')?.complete);const imagesBefore=requests.length;
  await page.locator('[data-game-view=list]').click();await page.locator('[data-game-view=grid]').click();assert.equal(requests.length,imagesBefore);
  await page.locator('[data-game-view=list]').click();assert.equal(await cards().locator('[data-catalog-id]').textContent(),base.notBggId);assert.equal(await cards().locator('[data-bgg-fact]').isVisible(),false);
  const returnUrl=page.url();await cards().locator('a').click();await page.locator('[data-live-notbgg]').waitFor();assert.match(await page.locator('h1').textContent(),/Synthetic/);assert.equal(await page.locator('[data-live-notbgg] script').count(),0);assert.ok(!(await page.content()).includes('PRIVATE_PUBLIC_BROWSER_NOTE'));assert.match(await page.locator('.plain-text').first().textContent(),/<script>/);
  await page.locator('[data-detail-back]').click();await ready();assert.equal(page.url(),returnUrl);assert.equal(await cards().count(),1);
  await search('#205637');assert.equal(await cards().count(),1);assert.equal(await cards().first().getAttribute('data-bgg-id'),'205637');
  await page.locator('[data-game-reset]').click();await page.locator('[data-game-advanced]').evaluate(el=>el.open=true);
  for(const category of accessoryCategories){await page.locator('[data-game-accessory]').selectOption(category);assert.equal(await cards().count(),1);assert.equal(await cards().first().getAttribute('data-catalog-key'),kit.notBggId);assert.ok(new URL(page.url()).searchParams.get('accessory')===category);}
  await page.reload();await ready();assert.equal(await page.locator('[data-game-accessory]').inputValue(),'other');assert.equal(await cards().count(),1);
  await page.locator('[data-game-view=list]').click();assert.equal(await cards().locator('[data-play-fact]:visible').count(),0);assert.equal(await cards().locator('[data-bgg-fact]:visible').count(),0);
  await page.waitForFunction(()=>document.querySelector('[data-game-card] [data-image-placeholder]')?.textContent.includes('無法'));
  await page.locator('[data-game-clear-advanced]').click();assert.equal(await page.locator('[data-game-accessory]').inputValue(),'');
  await page.locator('[data-game-filter=all]').click();
  for(const sort of ['name-asc','name-desc','year-desc','year-asc','bgg-rating-desc','weight-desc']){await page.locator('[data-game-sort]').selectOption(sort);assert.equal(await cards().count(),24);if(['bgg-rating-desc','weight-desc'].includes(sort))assert.equal(await cards().first().getAttribute('data-source'),'bgg');}
  await page.goto(origin+'/en/games?filter=all&q='+kit.notBggId);await ready();await cards().locator('a').click();await page.locator('[data-live-notbgg]').waitFor();assert.equal(await page.locator('[data-live-notbgg] .related a').count(),2);assert.match(await page.locator('[data-live-notbgg]').textContent(),/Accessory categories/);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[data-detail-back]').click();await ready();assert.equal(await cards().count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[data-game-search]').fill('no such game');await page.waitForTimeout(300);assert.equal(await cards().count(),0);assert.match(await page.locator('[data-load-status]').textContent(),/No/);
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:100000,connectionType:'cellular3g'});
  await page.goto(origin+'/games?q='+base.notBggId);await ready();assert.equal(await cards().count(),1);
  await page.locator('[data-game-view=list]').click();assert.equal(await page.locator('[data-game-browser]').getAttribute('data-view'),'list');
  const slow=await page.evaluate(()=>({dcl:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,...window.metrics}));
  assert.ok(slow.cls<0.05,'SSR exact-search state should not replace the default grid after slow hydration');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await cdp.detach();
  // Archive is visible on the next request and direct URLs return no private data.
  await repo.archive(kit.notBggId,{actor:'test',expectedRevision:1});const response=await page.goto(origin+'/games/notbgg/'+kit.notBggId.slice(7));assert.equal(response.status(),404);assert.ok(!(await page.content()).includes('PRIVATE_KIT'));
  await page.goto(origin+'/games?filter=all');await ready();assert.match(await page.locator('[data-game-result-count]').textContent(),/817/);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',checks:'815→818→817; 24→48→818; identities; all types; eight categories; exact searches; six sorts; nulls; Grid/List image reuse; detail XSS/privacy; bilingual; mobile; URL/back; archive404; mobile slow network',localComponentPreview:{initial,loadMoreMs:moreMs,searchIncludingDebounceMs:searchMs,slow150ms1_6Mbps:slow},externalImages:'synthetic only; real BGG network tested separately'},null,2));
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await local.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1});
