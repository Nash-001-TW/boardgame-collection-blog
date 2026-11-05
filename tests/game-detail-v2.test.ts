import assert from 'node:assert/strict';
import test from 'node:test';
import { descriptionParagraphs,positiveNumber,numberRange,rankLabel } from '../src/lib/game-detail-presentation.ts';
import { detailRelations } from '../src/lib/detail-relations.ts';
import { getGames } from '../src/lib/games.ts';
import { getGameSleeves,getSleevePackCount } from '../src/lib/game-sleeves.ts';
test('description projects HTML/entities to inert readable paragraphs without losing line breaks',()=>{
 assert.deepEqual(descriptionParagraphs('A &amp; B<br>line<p>Next &quot;text&quot;</p><script>alert(1)</script>'),['A & B\nline','Next "text"']);
 assert.deepEqual(descriptionParagraphs('&lt;img src=x onerror=alert(1)&gt;Safe'),['Safe']);
 assert.deepEqual(descriptionParagraphs(''),[]);
 assert.deepEqual(descriptionParagraphs('10 &lt; 20 &amp; 30 &gt; 5'),['10 < 20 & 30 > 5']);
});
test('detail formatting handles missing values, ranks and locale fallbacks',()=>{
 assert.equal(positiveNumber(12345),'12,345');assert.equal(positiveNumber(8.123,2),'8.12');assert.equal(positiveNumber(0),'—');assert.equal(numberRange(0,0),'—');assert.equal(numberRange(2,2),'2');
 const rank={id:5496,name:'thematic',friendlyName:'Thematic Rank'};
 assert.equal(rankLabel(rank,'zh-TW'),'主題遊戲排名');assert.equal(rankLabel(rank,'en'),'Thematic Rank');assert.equal(rankLabel({...rank,name:'unknown'},'zh-TW'),'Thematic Rank');
});
test('117 Arkham relations retain their evidence, IDs are unique and routes remain localized',()=>{
 const games=getGames(),game=games.find(g=>g.bggId===205637)!;
 const rows=detailRelations(game,games,'en');assert.equal(rows.length,117);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
 assert.ok(rows.every(r=>r.sources.length&&r.sources.every(s=>s.includes('inbound='))));
 assert.ok(rows.filter(r=>r.internal).every(r=>r.href.startsWith('/en/games/')));
 const retaliation=detailRelations(games.find(g=>g.bggId===381248)!,games,'en');assert.equal(retaliation.find(r=>r.id===451355)!.internal,false);
});
test('sleeves round each physical size separately at 50/100/200 and never pool counts',()=>{
 const rows=getGameSleeves(295770)!.cardSets[0].cardTypes;
 assert.equal(rows.reduce((n,r)=>n+r.count,0),2547);
 for(const [size,expected] of [[50,52],[100,27],[200,14]])assert.equal(rows.reduce((n,r)=>n+getSleevePackCount(r.count,size),0),expected);
 assert.equal(getSleevePackCount(1,100)+getSleevePackCount(1,100),2);
 assert.equal(getGameSleeves(205637),undefined);
});
test('relation display deduplicates IDs without erasing raw kinds or inventing direction',()=>{
 const sample=getGames()[0];
 const game={...sample,bggId:999991,bgg:{...sample.bgg!,bggId:999991,expansions:[{id:999992,name:'Related Promo'}],implementations:[{id:999992,name:'Related Promo',inbound:false}],compilations:[]}};
 const target={...sample,bggId:999992,slug:'target',bgg:{...sample.bgg!,bggId:999992,expansions:[],implementations:[],compilations:[]}};
 const rows=detailRelations(game,[game,target],'en');assert.equal(rows.length,1);
 assert.ok(rows[0].kinds.includes('expansions'));assert.ok(rows[0].kinds.includes('implementations'));assert.ok(!('other' in rows[0].directions));
 assert.equal(rows[0].sources.length,2);assert.ok(rows[0].sources.some(s=>s.includes('inbound=UNKNOWN')));
});
