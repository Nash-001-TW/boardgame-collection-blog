import assert from 'node:assert/strict';
import test from 'node:test';
import {relationPageContext} from '../src/lib/relation-page-context';
import {currentAdminItem} from '../src/lib/admin-shell-controller';

for (const [query, domain, item, title, trail] of [
  ['', null, 'bgg', 'BGG 同步與快取', ['遊戲資料', 'BGG 同步與快取']],
  ['?domain=collection&source=12', null, 'bgg', 'BGG 同步與快取', ['遊戲資料', 'BGG 同步與快取']],
  ['?view=unknown&domain=collection', null, 'bgg', 'BGG 同步與快取', ['遊戲資料', 'BGG 同步與快取']],
  ['?view=relations', 'game', 'relations', '遊戲關聯管理', ['遊戲資料', '遊戲關聯']],
  ['?view=relations&domain=game', 'game', 'relations', '遊戲關聯管理', ['遊戲資料', '遊戲關聯']],
  ['?view=relations&domain=unknown', 'game', 'relations', '遊戲關聯管理', ['遊戲資料', '遊戲關聯']],
  ['?view=relations&domain=collection&source=12&relationTarget=34&after=56', 'collection', 'collection-relations', '收藏組合管理', ['收藏', '收藏組合']],
] as const) {
  test('page context and sidebar agree for ' + (query || 'the cache entry'), () => {
    const url = new URL('https://example.test/admin/bgg' + query);
    assert.deepEqual(relationPageContext(url), {domain, lang: 'zh-TW', title, breadcrumb: trail});
    assert.equal(currentAdminItem(url), item);
  });
}

test('English uses the same collection context', () => {
  const url = new URL('https://example.test/admin/bgg?view=relations&domain=collection&lang=en');
  assert.deepEqual(relationPageContext(url), {
    domain: 'collection', lang: 'en', title: 'Collection combination management',
    breadcrumb: ['Collection', 'Collection combinations'],
  });
});
