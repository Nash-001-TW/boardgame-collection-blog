import assert from 'node:assert/strict';
import test from 'node:test';
import { adminNavigation, adminNavigationHref, currentAdminItem } from '../src/lib/admin-shell-controller';

const current = (path: string) => currentAdminItem(new URL(path, 'https://admin.example'));

test('Overview matches only its own route and accepts a trailing slash', () => {
  assert.equal(current('/admin/?lang=en'), 'overview');
  assert.equal(current('/admin/unknown'), undefined);
});

test('Collection filters select one current item and preserve the parent for detail pages', () => {
  assert.equal(current('/admin/collection?status=owned'), 'owned');
  assert.equal(current('/admin/collection?wishlist=1'), 'wishlist');
  assert.equal(current('/admin/collection?status=preordered'), 'preordered');
  assert.equal(current('/admin/collection?tab=owned'), 'owned');
  assert.equal(current('/admin/collection?tab=wishlist'), 'wishlist');
  assert.equal(current('/admin/collection?tab=preordered'), 'preordered');
  assert.equal(current('/admin/collection?tab=all&status=owned'), 'collection');
  assert.equal(current('/admin/collection?status=borrowed'), 'collection');
  assert.equal(current('/admin/collection/1/copies?status=owned'), 'collection');
  assert.equal(current('/admin/collection/1/components'), 'collection');
  assert.ok(!adminNavigation.some(group => group.items.some((item: {id: string}) => item.id === 'components')));
  assert.equal(current('/admin/collection/components/classification'), 'classification');
});

test('Sleeve management, collection tabs, BGG views and NotBGG details select their entries', () => {
  assert.equal(current('/admin/sleeves'), 'sleeves');
  assert.equal(current('/admin/collection/1/sleeves'), 'collection');
  assert.equal(current('/admin/collection/1/purchases'), 'collection');
  assert.ok(!adminNavigation.some(group => group.items.some(item => item.path === '/admin/sleeves' + '/requirements')));
  assert.equal(current('/admin/bgg?view=relations'), 'relations');
  assert.equal(current('/admin/bgg'), 'bgg');
  assert.equal(current('/admin/notbgg/000001/link'), 'notbgg');
  assert.equal(current('/admin/notbgg/000001/relations'), 'notbgg');
});

test('Filter navigation retains its query and appends the English preference', () => {
  const [, collection] = adminNavigation;
  assert.equal(adminNavigationHref(collection.items[1], 'en'), '/admin/collection?tab=owned&lang=en');
  assert.equal(adminNavigationHref(collection.items[2], 'zh-TW'), '/admin/collection?tab=wishlist');
  assert.equal(adminNavigationHref(collection.items[3], 'zh-TW'), '/admin/collection?tab=preordered');
});
