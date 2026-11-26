import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { changeComponentApplicability } from '../src/lib/component-applicability.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

const files = readdirSync('migrations').filter(file => /^\d{4}_.*\.sql$/.test(file)).sort();
const seed = `
    INSERT INTO v2_collection_items(id, display_name, record_scope) VALUES (1, 'Synthetic', 'test');
    INSERT INTO v2_owned_copies(id, collection_item_id, edition) VALUES (1, 1, 'A'), (2, 1, 'B');
    INSERT INTO v2_component_definitions(id, collection_item_id, component_name, component_type,
        quantity_unit, physical_creation_token, physical_revision, expected_quantity)
    VALUES (1, 1, 'Cards', 'card', 'card', printf('%064x', 1), 1, 20);
    INSERT INTO v2_physical_component_sources(definition_id, collection_item_id, record_scope,
        creation_token, actor, request_digest, signature)
    VALUES (1, 1, 'test', printf('%064x', 1), 'synthetic', printf('%064x', 2), printf('%064x', 3));
`;

for (const sequential of [false, true]) {
    test(`0026 preserves date, generation, applicability, and sleeve guards (${sequential ? 'filename order' : 'production upgrade'})`, async t => {
        assert.deepEqual(files.map(file => Number(file.slice(0, 4))), Array.from({ length: 26 }, (_, i) => i + 1));
        const db = new DatabaseSync(':memory:');
        t.after(() => db.close());
        const apply = (file: string) => db.exec(readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));
        if (sequential) {
            files.forEach(apply);
            db.exec(seed);
            db.exec('INSERT INTO v2_copy_components(owned_copy_id, component_definition_id) VALUES (1, 1)');
        } else {
            [...files.slice(0, 23), files[24], files[23]].forEach(apply);
            db.exec(seed);
            db.exec(`INSERT INTO v2_copy_components(owned_copy_id, component_definition_id, actual_quantity, count_revision, last_checked_at)
                VALUES (1, 1, 5, 1, '2026-01-05 03:00:00')`);
            apply(files[25]);
            assert.equal(db.prepare('SELECT last_checked_at FROM v2_copy_components').get()?.last_checked_at, '2026-01-05 03:00:00');
        }
        assert.equal(db.prepare('SELECT counted_on FROM v2_copy_components').get()?.counted_on, null);
        const insert = db.prepare('INSERT INTO v2_copy_components(owned_copy_id, component_definition_id, count_revision, counted_on) VALUES (2, 1, ?, ?)');
        for (const invalid of ['2026-1-05', '2026-02-30', '1999-12-31', 'not-a-date']) {
            assert.throws(() => insert.run(0, invalid), /CHECK constraint failed/);
        }
        for (const invalid of [null, '9999-01-01']) {
            assert.throws(() => insert.run(1, invalid), /COUNT_DATE_INVALID/);
            assert.throws(() => db.prepare('UPDATE v2_copy_components SET counted_on=?, count_revision=count_revision+1').run(invalid),
                /COUNT_DATE_INVALID/);
        }
        assert.throws(() => db.exec("UPDATE v2_copy_components SET counted_on='2026-01-05'"), /COUNT_DATE_INVALID/);
        insert.run(0, null);
        db.exec("UPDATE v2_copy_components SET actual_quantity=6, count_revision=count_revision+1, counted_on='2026-01-05' WHERE owned_copy_id=2");
        assert.throws(() => db.exec('UPDATE v2_copy_components SET counted_on=NULL WHERE owned_copy_id=2'), /COUNT_DATE_INVALID/);
        const generation = () => Number(db.prepare('SELECT generation FROM d1_quantity_collection_generation WHERE collection_id=1').get()?.generation);
        const previous = generation();
        db.exec("UPDATE v2_copy_components SET actual_quantity=7, count_revision=count_revision+1, counted_on='2026-01-04' WHERE owned_copy_id=2");
        assert.equal(generation(), previous + 1);
        await changeComponentApplicability(sqliteD1(db), { collectionId: 1, copyId: 2, definitionId: 1, definitionRevision: 1,
            signature: '3'.padStart(64, '0'), revision: 0, next: 'not_applicable', actor: 'synthetic' });
        assert.equal(db.prepare('SELECT not_applicable FROM v2_component_applicability_current').get()?.not_applicable, 1);
        assert.equal(db.prepare('SELECT counted_on FROM v2_copy_components WHERE owned_copy_id=2').get()?.counted_on, '2026-01-04');
        db.exec(`
            INSERT INTO v2_sleeve_sizes(id, width_tenth_mm, height_tenth_mm) VALUES (1, 631, 881);
            INSERT INTO v2_sleeve_products(id, size_id, product_name, sheets_per_pack) VALUES (1, 1, 'Pack', 100);
            INSERT INTO v2_sleeve_inventory_transactions(product_id, transaction_type, transaction_date, quantity_sheets)
            VALUES (1, 'GIFT', '2026-01-05', 7);
        `);
        assert.equal(db.prepare('SELECT balance_sheets FROM v2_sleeve_inventory_balance').get()?.balance_sheets, 7);
        assert.throws(() => db.exec('UPDATE v2_sleeve_inventory_transactions SET quantity_sheets=8'), /SLEEVE_TRANSACTION_IMMUTABLE/);
        assert.throws(() => db.exec('DELETE FROM v2_sleeve_inventory_transactions'), /SLEEVE_TRANSACTION_IMMUTABLE/);
        assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
        assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    });
}
