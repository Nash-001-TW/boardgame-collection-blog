import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { deserializeGameRef, formatNotBggId, gameCatalogKey, isNotBggId, notBggRouteSegment, parseGameRef, serializeGameRef } from '../src/lib/game-identity.ts';
import { validateCreateNotBggGame as create, validateUpdateNotBggGame as update, NotBggValidationError, notBggLimits } from '../src/lib/notbgg-validation.ts';
import { accessoryCategories, notBggGameTypes } from '../src/lib/notbgg-contract.ts';
import type { CreateNotBggGameInput, UpdateNotBggGameInput, NotBggGame } from '../src/lib/notbgg-contract.ts';
import { bggGameViewModel, notBggGameViewModel } from '../src/lib/game-view-model.ts';
import { getGames } from '../src/lib/games.ts';
import { buildCatalogPayload } from '../src/lib/catalog-payload.ts';

function fixture(input: CreateNotBggGameInput = { name: 'Synthetic game', type: 'boardgame' }): NotBggGame {
    return { ...create(input), gameId: 77, notBggId: formatNotBggId(1), source: 'notbgg', createdAt: '2026-11-04T00:00:00Z',
        updatedAt: '2026-11-04T00:00:00Z', revision: 1, archivedAt: null, linkStatus: 'unlinked', linkedBggId: null,
        linkedAt: null, primarySource: 'notbgg' };
}
const invalid = (input: unknown) => assert.throws(() => create(input), NotBggValidationError);

test('source identity round trips and never collides on the numeric suffix', () => {
    const bgg = parseGameRef({ source: 'bgg', bggId: 1 }), manual = parseGameRef({ source: 'notbgg', notBggId: 'NotBGG:000001' });
    assert.notEqual(gameCatalogKey(bgg), gameCatalogKey(manual));
    for (const ref of [bgg, manual]) assert.deepEqual(deserializeGameRef(serializeGameRef(ref)), ref);
    assert.equal(bgg.source === 'bgg' && typeof bgg.bggId, 'number');
});
test('NotBGG padding expands beyond six digits without changing existing identity', () => {
    for (const [seq, id] of [[1, 'NotBGG:000001'], [999999, 'NotBGG:999999'], [1000000, 'NotBGG:1000000'], [Number.MAX_SAFE_INTEGER, `NotBGG:${Number.MAX_SAFE_INTEGER}`]] as const) {
        assert.equal(formatNotBggId(seq), id); assert.ok(isNotBggId(id)); assert.equal(notBggRouteSegment(formatNotBggId(seq)), id.slice(7));
    }
});
test('invalid and noncanonical source identities are rejected', () => {
    for (const id of ['NotBGG:0', 'NotBGG:000000', 'notbgg:000001', 'NotBGG:1', 'NotBGG:0000001', 'NotBGG:01000000',
        'NotBGG:000001\n', 'NotBGG:1e6', 'NotBGG:9007199254740992', 'BGG:0', 'BGG:01', 'BGG:1\n', 'BGG:1.0', '205637', 1, null]) {
        assert.throws(() => deserializeGameRef(id));
    }
    for (const seq of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => formatNotBggId(seq));
    for (const ref of [{ source: 'bgg', bggId: '1' }, { source: 'bgg', bggId: 0 }, { source: 'bgg', bggId: 1, notBggId: 'NotBGG:000001' },
        { source: 'notbgg', notBggId: 'NotBGG:1' }, {}, [], null]) assert.throws(() => parseGameRef(ref));
});

test('create validates required fields and normalizes optional unknowns', () => {
    const game = create({ name: '  Example  ', type: 'boardgame' });
    assert.equal(game.name, 'Example'); assert.equal(game.minPlayers, null); assert.equal(game.yearPublished, null);
    assert.equal(game.description, null); assert.deepEqual(game.mechanics, []);
    for (const row of [{}, { name: 'X' }, { type: 'boardgame' }, { name: ' ', type: 'boardgame' },
        { name: 'X', type: 'accessory' }, null, [], { name: 1, type: 'boardgame' }]) invalid(row);
});
test('create and update reject EVERY noneditable/system/statistic/official-relation field', () => {
    const current = create({ name: 'X', type: 'boardgame' });
    for (const field of ['notBggId', 'gameId', 'source', 'createdAt', 'updatedAt', 'revision', 'archivedAt', 'linkStatus',
        'linkedBggId', 'linkedAt', 'primarySource', 'expectedRevision', 'bggId', 'bgg', 'averageRating', 'usersRated', 'bggRating',
        'overallRank', 'categoryRanks', 'averageWeight', 'complexity', 'expansions', 'implementations', 'compilations', 'isExpansion', 'unknownField']) {
        invalid({ name: 'X', type: 'boardgame', [field]: null });
        assert.throws(() => update({ [field]: null }, current), NotBggValidationError);
    }
    invalid(JSON.parse('{"name":"X","type":"boardgame","__proto__":{}}'));
    invalid({ name: 'X', type: 'boardgame', [Symbol('hidden')]: 1 });
});
test('numbers do not coerce strings, zero sentinels, fractional or nonfinite values', () => {
    for (const field of ['yearPublished', 'minPlayers', 'maxPlayers', 'minPlaytime', 'maxPlaytime']) {
        for (const value of [0, -1, 1.2, NaN, Infinity, '2', '', false, undefined, Number.MAX_SAFE_INTEGER]) invalid({ name: 'X', type: 'boardgame', [field]: value });
        assert.equal(create({ name: 'X', type: 'boardgame', [field]: null })[field as 'minPlayers'], null);
    }
    assert.equal(create({ name: 'X', type: 'boardgame', minAge: 0 }).minAge, 0);
    invalid({ name: 'X', type: 'boardgame', minAge: 201 });
    invalid({ name: 'X', type: 'boardgame', minAge: -1 });
});
test('player/time bounds and editor recommendations are checked against the complete next state', () => {
    invalid({ name: 'X', type: 'boardgame', minPlayers: 4, maxPlayers: 2 });
    invalid({ name: 'X', type: 'boardgame', minPlaytime: 60, maxPlaytime: 30 });
    invalid({ name: 'X', type: 'boardgame', minPlayers: 2, maxPlayers: 4, recommendedPlayers: [5] });
    invalid({ name: 'X', type: 'boardgame', recommendedPlayers: [null] });
    const game = create({ name: 'X', type: 'boardgame', minPlayers: 2, maxPlayers: 4, minPlaytime: 10, maxPlaytime: 20, recommendedPlayers: [2, 4, 2] });
    assert.deepEqual(game.recommendedPlayers, [2, 4]);
    assert.throws(() => update({ minPlayers: 5 }, game), NotBggValidationError);
    assert.throws(() => update({ maxPlaytime: 5 }, game), NotBggValidationError);
    assert.throws(() => update({}, game), NotBggValidationError);
    assert.equal(update({ maxPlayers: 5 }, game).minPlayers, 2);
    assert.equal(game.maxPlayers, 4); // validator never mutates the current revision
});
test('accessory categories are multiselect, deduplicated and cannot be used on ordinary games', () => {
    const row = create({ name: 'Kit', type: 'boardgameaccessory', accessoryCategories: [...accessoryCategories, 'promo'], contents: 'Tokens' });
    assert.deepEqual(row.accessoryCategories, accessoryCategories);
    invalid({ name: 'X', type: 'boardgameaccessory', accessoryCategories: ['invalid'] });
    for (const type of ['boardgame', 'boardgameexpansion']) {
        for (const extras of [{ accessoryCategories: ['promo'] }, { contents: 'Kit' }, { relatedGameIds: [{ source: 'bgg', bggId: 1 }] }]) invalid({ name: 'X', type, ...extras });
    }
});
test('accessories reject inapplicable player/time/recommendation data; type changes must clear it', () => {
    for (const field of ['minPlayers', 'maxPlayers', 'minPlaytime', 'maxPlaytime', 'recommendedPlayers']) {
        invalid({ name: 'X', type: 'boardgameaccessory', [field]: field === 'recommendedPlayers' ? [2] : 2 });
    }
    const game = create({ name: 'X', type: 'boardgame', minPlayers: 1 });
    assert.throws(() => update({ type: 'boardgameaccessory' }, game), NotBggValidationError);
    assert.equal(update({ type: 'boardgameaccessory', minPlayers: null }, game).minPlayers, null);
});
test('mixed-source accessory targets deduplicate by full identity, not suffix', () => {
    const row = create({ name: 'X', type: 'boardgameaccessory', relatedGameIds: [
        { source: 'bgg', bggId: 1 }, { source: 'notbgg', notBggId: 'NotBGG:000001' }, { source: 'bgg', bggId: 1 }] });
    assert.equal(row.relatedGameIds.length, 2);
    invalid({ name: 'X', type: 'boardgameaccessory', relatedGameIds: ['1'] });
});
test('URLs permit absolute HTTP(S) only, never embedded credentials or script/data URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:image/png,x', 'ftp://x/a', '/relative', 'https://user:pass@example.com', 'not a url']) {
        invalid({ name: 'X', type: 'boardgame', imageUrl: value });
        invalid({ name: 'X', type: 'boardgame', referenceUrls: [value] });
    }
    const row = create({ name: 'X', type: 'boardgame', imageUrl: ' https://example.com ', referenceUrls: ['https://example.com', 'https://example.com/'] });
    assert.equal(row.imageUrl, 'https://example.com/'); assert.deepEqual(row.referenceUrls, ['https://example.com/']);
});
test('string/list limits, deduplication and custom labels cannot fabricate BGG taxonomy IDs', () => {
    const row = create({ name: 'X', type: 'boardgame', mechanics: [' Drafting ', 'drafting', 'Co-op'], alternateNames: ['Alias', 'Alias'] });
    assert.deepEqual(row.mechanics, ['Drafting', 'Co-op']); assert.deepEqual(row.alternateNames, ['Alias']);
    invalid({ name: 'X'.repeat(notBggLimits.name + 1), type: 'boardgame' });
    invalid({ name: 'X', type: 'boardgame', mechanics: [{ id: 10, name: 'Fake BGG' }] });
    invalid({ name: 'X', type: 'boardgame', mechanics: Array(101).fill('A') });
    invalid({ name: 'X', type: 'boardgame', mechanics: new Array(1) });
    const sparseWithExtraKey = Object.assign(new Array(1), { extra: 'not an array entry' });
    invalid({ name: 'X', type: 'boardgame', mechanics: sparseWithExtraKey });
    invalid({ name: 'X', type: 'boardgame', editorNotes: 'X'.repeat(10001) });
});

test('NotBGG VM supports all three types, nulls, independent advice and source-labelled taxonomy', () => {
    for (const type of notBggGameTypes) {
        const game = fixture({ name: 'Synthetic', type, mechanics: ['My mechanic'], editorNotes: 'PRIVATE',
            ...(type === 'boardgameaccessory' ? { accessoryCategories: ['storage' as const] } : { recommendedPlayers: [2] }) });
        const vm = notBggGameViewModel(game);
        assert.equal(vm.key, 'NotBGG:000001'); assert.equal(vm.yearPublished, null); assert.equal(vm.bgg, null);
        assert.equal(vm.href, '/games/notbgg/000001'); assert.equal(notBggGameViewModel(game, 'en').href, '/en/games/notbgg/000001');
        assert.deepEqual(vm.mechanics, [{ source: 'notbgg', name: 'My mechanic' }]);
        assert.ok(!JSON.stringify(vm).includes('PRIVATE')); assert.ok(!('editorNotes' in vm));
        if (type === 'boardgameaccessory') { assert.equal(vm.play, null); assert.equal(vm.playerAdvice, null); assert.equal(vm.type, 'accessory'); }
        else { assert.equal(vm.play?.minPlayers, null); assert.equal(vm.playerAdvice?.source, 'editor-recommended'); }
    }
    assert.equal(notBggGameViewModel(fixture()).playerAdvice, null);
});
test('VM image choices preserve thumbnail-first catalog, primary full image and fallback', () => {
    const vm = notBggGameViewModel(fixture({ name: 'X', type: 'boardgame', imageUrl: 'https://example.com/full', thumbnailUrl: 'https://example.com/thumb' }));
    assert.deepEqual(vm.images, { primary: 'https://example.com/full', thumbnail: 'https://example.com/thumb', catalog: 'https://example.com/thumb', fallback: 'https://example.com/full' });
    assert.deepEqual(notBggGameViewModel(fixture()).images, { primary: null, thumbnail: null, catalog: null, fallback: null });
});
test('BGG adapter preserves existing catalog projection, numeric identity, localization and untouched official evidence for every entry', () => {
    const games = getGames(), before = JSON.stringify(games);
    for (const lang of ['en', 'zh-TW'] as const) {
        const payload = buildCatalogPayload(games, lang);
        for (const [i, game] of games.entries()) {
            const vm = bggGameViewModel(game, lang), old = payload.records[i];
            assert.equal(vm.name, old.dataset.name); assert.equal(vm.type, old.dataset.itemType);
            assert.equal(vm.href, old.href || null); assert.equal(vm.images.catalog, old.image || null); assert.equal(vm.images.fallback, old.fallback || null);
            assert.deepEqual(vm.ref, { source: 'bgg', bggId: game.bggId }); assert.equal(vm.bgg, game.bgg);
            assert.deepEqual(vm.mechanics.map(t => t.source === 'bgg' ? t.bggId : null), game.bgg?.mechanics.map(t => t.id) ?? []);
        }
    }
    assert.equal(JSON.stringify(games), before);
    const arkham = bggGameViewModel(games.find(g => g.bggId === 205637)!);
    assert.equal(arkham.playerAdvice?.source, 'bgg-community-best'); assert.deepEqual(arkham.playerAdvice?.counts, arkham.bgg?.bestPlayerCounts);
});
test('BGG registrations without details retain null data and no invented detail URL', () => {
    const vm = bggGameViewModel({ bggId: 123, slug: 'pending', name: 'Pending', bgg: null });
    assert.equal(vm.href, null); assert.equal(vm.bgg, null); assert.equal(vm.play?.minPlayers, null);
});
test('linking metadata does not overwrite original NotBGG provenance or invent BGG statistics', () => {
    const game = { ...fixture(), linkStatus: 'linked' as const, linkedBggId: 205637, linkedAt: '2026-11-04T01:00:00Z', primarySource: 'bgg' as const };
    const vm = notBggGameViewModel(game); assert.equal(vm.ref.source, 'notbgg'); assert.equal(vm.bgg, null);
});
test('D2 promotes only the new migration and retains the NotBGG storage structure', () => {
    const config = JSON.parse(fs.readFileSync('wrangler.json', 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(config.d1_databases[0].migrations_dir, './migrations');
    assert.deepEqual(fs.readdirSync('migrations').filter(file => file.startsWith('0014')), ['0014_notbgg.sql']);
    const sql = fs.readFileSync('migrations/0014_notbgg.sql', 'utf8');
    for (const table of ['notbgg_ids', 'notbgg_games', 'notbgg_game_revisions', 'notbgg_accessory_categories', 'site_game_relations', 'notbgg_bgg_links', 'notbgg_link_events']) assert.ok(sql.includes(`CREATE TABLE ${table}`));
    assert.match(sql, /AUTOINCREMENT/); assert.match(sql, /WHERE status='linked'/); assert.match(sql, /ON DELETE RESTRICT/);
    assert.doesNotMatch(sql, /^(?:INSERT|UPDATE|DELETE|DROP|ALTER)\s/im);
});

// Compile-time boundary checks, never executed and never persisted.
function inputTypeChecks() {
    // @ts-expect-error backend identity cannot be provided by a create form
    const createInput: CreateNotBggGameInput = { name: 'X', type: 'boardgame', notBggId: 'NotBGG:000001' };
    // @ts-expect-error revision is a separate concurrency precondition, not editable data
    const updateInput: UpdateNotBggGameInput = { revision: 2 };
    // @ts-expect-error a numeric BGG identity must not become a string union
    const ref: import('../src/lib/game-identity').GameRef = { source: 'bgg', bggId: '1' };
    return [createInput, updateInput, ref];
}
void inputTypeChecks;
