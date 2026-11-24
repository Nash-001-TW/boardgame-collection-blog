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
  assert.equal(current('/admin/collection?status=borrowed'), 'collection');
  assert.equal(current('/admin/collection/1/copies?status=owned'), 'collection');
  assert.equal(current('/admin/collection/components/manage?collection=1'), 'components');
  assert.equal(current('/admin/collection/components/classification'), 'classification');
});

test('Sleeve requirements, BGG views and NotBGG details select their own entries', () => {
  assert.equal(current('/admin/sleeves/requirements'), 'requirements');
  assert.equal(current('/admin/bgg?view=relations'), 'relations');
  assert.equal(current('/admin/bgg'), 'bgg');
  assert.equal(current('/admin/notbgg/000001/link'), 'notbgg');
  assert.equal(current('/admin/notbgg/000001/relations'), 'notbgg');
});

test('Filter navigation retains its query and appends the English preference', () => {
  const [, collection] = adminNavigation;
  assert.equal(adminNavigationHref(collection.items[1], 'en'), '/admin/collection?status=owned&lang=en');
  assert.equal(adminNavigationHref(collection.items[2], 'zh-TW'), '/admin/collection?wishlist=1');
  assert.equal(adminNavigationHref(collection.items[3], 'zh-TW'), '/admin/collection?status=preordered');
});
