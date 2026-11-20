import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedNotBggD1,migrateIsolatedD1} from './helpers/notbgg-local-d1.ts';
import {readPublicBrowse,readPublicOverview} from '../src/lib/public-site-data.ts';
test('public bounded CTE/JSON queries work with the isolated D1-compatible SQLite runtime',async()=>{
 const local=await isolatedNotBggD1();try{
  await migrateIsolatedD1(local.db);
  const data=await readPublicBrowse(local.db,new URLSearchParams(),'en');assert.equal(data.cards.length,20);assert.ok(data.total>20);
  assert.deepEqual(await readPublicOverview(local.db),{records:0,owned:0,wishlist:0,preordered:0});
  assert.equal((await readPublicBrowse(local.db,new URLSearchParams(),'en',true)).cards.length,0);
 }finally{await local.dispose();}
});
