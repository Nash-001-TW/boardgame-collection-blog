const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {chromium}=require(process.argv[2]);
(async()=>{
 const {createLocalGamesPreview}=await import('../scripts/lib/local-games-preview.ts');const preview=await createLocalGamesPreview();
 const {getGames}=await import('../src/lib/games.ts');const arcs=getGames().find(g=>g.bggId===359871);
 const output=fs.mkdtempSync(path.join(process.argv[4],'game-detail-v2-'));
 const browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(route.request().resourceType()==='image'){const landscape=[arcs.bgg.image,arcs.bgg.thumbnail].includes(url.href);return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${landscape?600:400}" height="${landscape?300:560}"><rect width="100%" height="100%" fill="#284f68"/><text x="24" y="65" fill="#f4e5c3" font-size="25">OFFLINE COVER</text><text x="24" y="105" fill="white" font-size="18">Synthetic image</text></svg>`});}if(url.hostname!=='bgg.test')return route.abort();if(url.pathname==='/preview-games.js')return route.fulfill({contentType:'text/javascript',body:preview.javascript});const html=await preview.html(url);return route.fulfill({contentType:'text/html; charset=utf-8',body:html||'Not found'});});
 await page.goto('http://bgg.test/games/bgg-205637');
 const rows=page.locator('[data-relation-list]>li');assert.equal(await rows.count(),20);
 const relations=page.locator('[data-detail-relations]');
 assert.match(await page.locator('[data-relation-filter="all"]').textContent(),/117/);
 assert.match(await page.locator('[data-relation-filter="expansions"]').textContent(),/116/);
 assert.match(await page.locator('[data-relation-filter="implementations"]').textContent(),/1/);
 assert.equal(await page.locator('[data-relation-filter="other"]').count(),0);
 assert.equal(await relations.locator('details').count(),0);
 assert.doesNotMatch(await relations.textContent(),/inbound|explicit|derived|unknown|conflict|directionStatus|directionBasis|方向待確認|資料來源/);
 for(const [query,id,label] of [['A Light in the Fog','327293','擴充'],['Revised Core Set','359609','版本關聯'],['Alice in Wonderland','379286','擴充']]){
  await page.locator('[data-relation-search]').fill(query);
  assert.equal(await page.locator(`[data-relation-id="${id}"] a small`).textContent(),label);
  assert.equal(await rows.count(),1);
 }
 await page.locator('[data-relation-search]').fill('');
 await page.locator('[data-relation-filter="expansions"]').click();assert.match(await page.locator('[data-relation-count]').textContent(),/20 \/ 116/);
 await page.locator('[data-relation-filter="all"]').click();
 await page.goto('http://bgg.test/games/bgg-327293');assert.equal(await page.locator('[data-relation-id="205637"] a small').textContent(),'本體');
 await page.goto('http://bgg.test/games/bgg-205637');
 assert.match(await page.locator('[data-detail-v2] h1').textContent(),/Arkham|詭鎮|魔鎮|阿卡姆/);
 await page.locator('[data-cover-open]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('[data-cover-dialog]').evaluate(d=>d.open),true);await page.keyboard.press('Escape');assert.equal(await page.locator('[data-cover-dialog]').evaluate(d=>d.open),false);
 await page.locator('[data-cover-open]').click();await page.locator('[data-cover-close]').click();assert.equal(await page.locator('[data-cover-dialog]').evaluate(d=>d.open),false);
 await page.locator('[data-description] summary').click();assert.equal(await page.locator('[data-description]').evaluate(d=>d.open),true);await page.locator('[data-description] summary').click();
 await page.locator('[data-relation-more]').click();assert.equal(await rows.count(),40);
 await page.locator('[data-relation-search]').fill('Dunwich');assert.ok(await rows.count()>0);assert.ok(await rows.count()<=20);assert.ok((await rows.locator('strong').allTextContents()).every(n=>/dunwich/i.test(n)));
 await page.locator('[data-relation-search]').fill('');await page.locator('[data-relation-filter="implementations"]').click();assert.ok((await rows.locator('a small').allTextContents()).every(n=>/版本/.test(n)));
 await page.locator('[data-relation-filter="all"]').click();assert.equal(await rows.count(),20);assert.equal(await rows.evaluateAll(rs=>new Set(rs.map(r=>r.dataset.relationId)).size),20);
 await page.locator('[data-relation-list]').evaluate(el=>el.scrollTop=0);await page.evaluate(()=>scrollTo(0,0));if(process.env.C4_SCREENSHOTS)await page.screenshot({path:path.join(output,'desktop-arkham-full.png'),fullPage:true});
 await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(process.env.C4_SCREENSHOTS)await page.screenshot({path:path.join(output,'mobile-arkham-full.png'),fullPage:true});
 await page.locator('.cat-mobile-menu summary').click();await page.locator('.cat-mobile-languages a[href="/en/games/bgg-205637"]').click();await page.waitForURL('http://bgg.test/en/games/bgg-205637');
 assert.match(await page.locator('.rank-list').textContent(),/Thematic Rank/);assert.match(await page.locator('.metadata').textContent(),/Cooperative Game/);
 await page.goto('http://bgg.test/en/games/frosthaven');
 for(const [size,total] of [['50','52'],['100','27'],['200','14']]){await page.locator('[data-sleeve-pack-size]').selectOption(size);assert.equal(await page.locator('[data-sleeve-total-packs]').textContent(),total);const actual=await page.locator('[data-sleeve-packs]').allTextContents();assert.equal(actual.map(Number).reduce((n,x)=>n+x,0),Number(total));}
 await page.locator('#game-sleeves').screenshot({path:path.join(output,'frosthaven-sleeves-200.png')});
 await page.waitForFunction(()=>document.querySelector('[data-cover-open] img').naturalWidth>0);
 assert.ok(await page.locator('[data-cover-open] img').evaluate(img=>getComputedStyle(img).objectFit==='contain' && img.getBoundingClientRect().height>0));
 await page.goto('http://bgg.test/en/games/bgg-359871');await page.waitForFunction(()=>document.querySelector('[data-cover-open] img').naturalWidth>0);
 assert.ok(await page.locator('[data-cover-open] img').evaluate(img=>getComputedStyle(img).objectFit==='contain' && img.getBoundingClientRect().height>0));
 await page.goto('http://bgg.test/en/games/bgg-448621');assert.equal(await page.locator('[data-relation-list]').count(),0);assert.match(await page.locator('[data-detail-sleeves]').textContent(),/No sleeve data/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.addInitScript(()=>{window.IntersectionObserver=undefined;});
 await page.goto('http://bgg.test/games?q=Arkham&filter=all&view=list&page=2');await page.waitForFunction(()=>document.querySelector('[data-game-grid]')?.children.length===48);
 const listUrl=page.url();await page.evaluate(()=>scrollTo({top:700,behavior:'instant'}));await page.waitForFunction(()=>scrollY>500);const beforeY=await page.evaluate(()=>scrollY);
 const target=await page.locator('[data-game-grid] a[href]').evaluateAll(links=>links.find(a=>a.getBoundingClientRect().top>0&&a.getBoundingClientRect().top<innerHeight-130)?.getAttribute('href'));
 assert.ok(target);await page.locator(`[data-game-grid] a[href="${target}"]`).click();await page.waitForSelector('[data-detail-v2]');
 const historyCount=await page.evaluate(()=>history.length);await page.locator('.section-nav a[href="#game-sleeves"]').click();assert.equal(await page.evaluate(()=>history.length),historyCount);
 await page.locator('[data-detail-back]').click();await page.waitForURL(listUrl);await page.waitForFunction(()=>document.querySelector('[data-game-grid]')?.children.length===48);await page.waitForFunction(y=>Math.abs(scrollY-y)<180,beforeY);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',output,arkhamRelations:117,initial:20,more:40,sleeveTotals:{50:52,100:27,200:14},covers:'Synthetic offline images'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
