import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionRelationTypes, gameRelationTypes } from '../src/lib/relation-admin';
import { relationChoiceLabel, relationEndpointLabel, relationSourceLabel, relationTypeLabel } from '../src/lib/relation-labels';

test('every supported relation type has a Chinese and English label', () => {
  for (const type of new Set([...collectionRelationTypes, ...gameRelationTypes])) {
    assert.match(relationTypeLabel(type, 'zh-TW'), /\p{Script=Han}/u);
    assert.match(relationTypeLabel(type, 'en'), /^[A-Z]/);
  }
  assert.equal(relationSourceLabel('manual', 'zh-TW'), '手動');
  assert.equal(relationSourceLabel('manual', 'en'), 'Manual');
  assert.equal(relationSourceLabel('bgg', 'zh-TW'), 'BGG');
});

test('relation endpoints show verified names and identities or a missing-ID label', () => {
  const choice = { id: 5, display_name: '玩家桌墊', record_scope: 'production' };
  assert.equal(relationChoiceLabel(choice, false, 'zh-TW'), '玩家桌墊（#5）');
  assert.equal(relationChoiceLabel({ ...choice, record_scope: 'test' }, false, 'zh-TW'), '玩家桌墊（#5） · 測試');
  assert.equal(relationEndpointLabel(5, undefined, false, 'zh-TW'), '#5（已封存或找不到）');
  assert.equal(relationEndpointLabel(5, undefined, false, 'en'), '#5 (archived or not found)');
  assert.equal(relationEndpointLabel(5, { primary_name: 'Base', bgg_id: 42 }, true, 'en'), 'Base (BGG:42)');
  assert.equal(relationEndpointLabel(5, { primary_name: '配件', seq: 42 }, true, 'zh-TW'), '配件（NotBGG:000042）');
});

test('compiled relation page renders scoped filters, known names and retained targets', async t => {
  const { sleeveWorkflowFixture } = await import('./helpers/sleeve-workflow-fixture');
  const { seedBggRelations } = await import('./helpers/bgg-sync-fixture');
  const { dashboardPreview } = await import('./helpers/admin-dashboard-preview');
  const { accessFixture } = await import('./helpers/notbgg-access-fixture');
  const fixture = await sleeveWorkflowFixture();
  t.after(() => fixture.sqlite.close());
  const auth = await accessFixture();
  t.after(auth.restore);
  seedBggRelations(fixture.sqlite);
  fixture.sqlite.exec(`
    INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type)
    VALUES (402,401,'expansion_of'),(404,401,'accessory_for');
    INSERT INTO v2_collection_management(collection_item_id,archived_at) VALUES (404,CURRENT_TIMESTAMP);
  `);
  const render = await dashboardPreview({ ...auth.bindings, DB: fixture.db });
  const headers = { 'Cf-Access-Jwt-Assertion': await auth.token() };
  const page = async (query: string) => {
    const response = await render(new Request('https://admin.example.test/admin/bgg?view=relations&domain=collection' + query, { headers }));
    assert.equal(response.status, 200);
    return response.text();
  };
  const base = await page('&source=401');
  assert.match(base, /Expansion copy（#402） → Base copy（#401）/);
  assert.match(base, /#404（已封存或找不到） → Base copy（#401）/);
  assert.match(base, /擴充 → 主遊戲 · 手動 · 已確認/);
  assert.match(base.match(/<select[^>]* name="source"[^>]*>.*?<\/select>/s)?.[0] ?? '', /<select[^>]* name="source"[^>]*>.*?<option[^>]* value="401"[^>]* selected[^>]*>Base copy（#401）/s);
  const create = (html: string) => html.match(/<form[^>]*data-new-collection-relation[^>]*>.*?<\/form>/s)?.[0] ?? '';
  assert.match(create(base), /<select[^>]* name="sourceId"[^>]*>\s*<option[^>]* value=""[^>]*>/);
  assert.match(create(base), /<select[^>]* name="targetId"[^>]*>.*?<option[^>]* value="401" data-item-type="base" selected[^>]*>/s);
  const expansion = await page('&source=402');
  assert.doesNotMatch(expansion, /#404（已封存或找不到）/);
  assert.match(create(expansion), /<select[^>]* name="sourceId"[^>]*>.*?<option[^>]* value="402" data-item-type="expansion" selected[^>]*>/s);
  const retained = create(await page('&source=402&relationTarget=401'));
  assert.match(retained, /<select[^>]* name="sourceId"[^>]*>\s*<option[^>]* value=""[^>]*>/);
  assert.match(retained, /<select[^>]* name="targetId"[^>]*>.*?<option[^>]* value="401" data-item-type="base" selected[^>]*>/s);
});
