import test from 'node:test';
import assert from 'node:assert/strict';
import {d7aBuiltPreview} from './helpers/d7a-built-preview.ts';
import {migrateIsolatedD1} from './helpers/notbgg-local-d1.ts';

// Verify actual server HTML before any controller script runs.
test('catalog SSR reserves result text using the complete filtered count, not the first batch',async t=>{
 const preview=await d7aBuiltPreview();try{
  await migrateIsolatedD1(preview.db);
  for(const[path,expected]of [
   ['/games?filter=all','找到 815 款遊戲'],
   ['/en/games?filter=all&view=list','Found 815 games'],
   ['/games?filter=all&q=NO_MATCH_R3_984671','找到 0 款遊戲'],
   ['/en/games?filter=accessory','Found 1 games']
  ])await t.test(path,async()=>{
   const response=await preview.httpFetch(path);assert.equal(response.status,200);
   const html=await response.text();assert.equal(html.match(/data-game-result-count[^>]*>([^<]*)<\/p>/)?.[1],expected);
   assert.ok((html.replace(/<template[\s\S]*?<\/template>/g,'').match(/<article[^>]*data-game-card/g)??[]).length<=24);
  });
 }finally{await preview.dispose();}
});
