-- Migration 0012: V1 collection and sleeve requirements -> V2
-- Additive only. No V1 changes. Do not include TEST_0011 data in mappings.
-- Requires migrations 0007-0011. Run on local D1 first.

-- BGG catalog: one row per BGG ID, only those referenced by collection items.
INSERT INTO v2_games (bgg_id, primary_name, game_type, standalone_status, catalog_source)
SELECT DISTINCT g.bgg_id, g.name,
  CASE WHEN g.is_expansion = 1 THEN 'expansion'
       WHEN g.game_type IN ('base','expansion','standalone','accessory','bundle','other') THEN g.game_type
       ELSE 'unknown' END,
  'unknown', 'bgg'
FROM bgg_games g JOIN collection_items c ON c.bgg_id = g.bgg_id
WHERE NOT EXISTS (SELECT 1 FROM v2_games v WHERE v.bgg_id = g.bgg_id);

INSERT OR IGNORE INTO v2_legacy_id_map (legacy_table, legacy_id, target_table, target_id, conversion_status, notes)
SELECT 'bgg_games', CAST(g.bgg_id AS TEXT), 'v2_games', v.id, 'mapped', 'Migration 0012: BGG ID match'
FROM bgg_games g JOIN collection_items c ON c.bgg_id = g.bgg_id
JOIN v2_games v ON v.bgg_id = g.bgg_id;

-- Each V1 collection row gets its own V2 collection row. Do not dedupe by display name.
INSERT INTO v2_collection_items (game_id, display_name, item_type, acquisition_status, wishlist, notes, created_at, updated_at)
SELECT v.id, c.display_name,
  CASE WHEN c.item_type IN ('base','expansion','bundle','accessory','storage','promo','other') THEN c.item_type ELSE 'unknown' END,
  CASE WHEN c.acquisition_status IN ('owned','preordered','wishlist','not_owned','unknown') THEN c.acquisition_status ELSE 'unknown' END,
  c.wishlist,
  json_object('migration','0012','legacy_table','collection_items','legacy_id',c.id,
    'source_key',c.source_key,'source_row',c.source_row,'source_serial',c.source_serial,
    'match_status',c.match_status,'owned',c.owned,'catalog_status',c.catalog_status,
    'factory_seal_status',c.factory_seal_status,'legacy_notes',c.notes),
  c.created_at, c.updated_at
FROM collection_items c
LEFT JOIN v2_games v ON v.bgg_id = c.bgg_id
WHERE NOT EXISTS (
  SELECT 1 FROM v2_legacy_id_map m
  WHERE m.legacy_table='collection_items' AND m.legacy_id=CAST(c.id AS TEXT)
    AND m.target_table='v2_collection_items'
)
AND NOT EXISTS (
  SELECT 1 FROM v2_collection_items x
  WHERE json_valid(x.notes) AND json_extract(x.notes,'$.migration')='0012'
    AND json_extract(x.notes,'$.legacy_table')='collection_items'
    AND json_extract(x.notes,'$.legacy_id')=c.id
);

-- Backfill maps using unique migration metadata; also supports reruns after interrupted imports.
INSERT OR IGNORE INTO v2_legacy_id_map (legacy_table, legacy_id, target_table, target_id, conversion_status, notes)
SELECT 'collection_items', CAST(c.id AS TEXT), 'v2_collection_items', v.id, 'mapped', 'Migration 0012: original source_key=' || c.source_key
FROM collection_items c JOIN v2_collection_items v
 ON json_valid(v.notes) AND json_extract(v.notes,'$.migration')='0012'
 AND json_extract(v.notes,'$.legacy_table')='collection_items'
 AND json_extract(v.notes,'$.legacy_id')=c.id;

-- Legacy component_type denotes product categories, not physical component kinds.
-- Preserve original fields as JSON and use 'other' rather than guessing 'card' etc.
INSERT INTO v2_component_definitions (collection_item_id, component_name, component_type, expected_quantity, quantity_unit, notes)
SELECT im.target_id, cc.component_name, 'other', cc.quantity,
 CASE WHEN cc.quantity_unit IN ('piece','card','tile','die','sheet','box','pack','set','other') THEN cc.quantity_unit ELSE 'other' END,
 json_object('migration','0012','legacy_table','collection_components','legacy_id',cc.id,
  'legacy_component_type',cc.component_type,'legacy_bgg_id',cc.bgg_id,
  'legacy_owned',cc.owned,'legacy_match_status',cc.match_status,
  'legacy_quantity_unit',cc.quantity_unit,'legacy_notes',cc.notes)
FROM collection_components cc
JOIN v2_legacy_id_map im ON im.legacy_table='collection_items' AND im.legacy_id=CAST(cc.collection_item_id AS TEXT)
 AND im.target_table='v2_collection_items'
WHERE NOT EXISTS (
 SELECT 1 FROM v2_legacy_id_map m WHERE m.legacy_table='collection_components'
 AND m.legacy_id=CAST(cc.id AS TEXT) AND m.target_table='v2_component_definitions'
)
AND NOT EXISTS (
 SELECT 1 FROM v2_component_definitions d WHERE json_valid(d.notes)
 AND json_extract(d.notes,'$.migration')='0012'
 AND json_extract(d.notes,'$.legacy_table')='collection_components'
 AND json_extract(d.notes,'$.legacy_id')=cc.id
);

INSERT OR IGNORE INTO v2_legacy_id_map (legacy_table, legacy_id, target_table, target_id, conversion_status, notes)
SELECT 'collection_components', CAST(cc.id AS TEXT), 'v2_component_definitions', d.id, 'mapped', 'Migration 0012: category converted to other'
FROM collection_components cc JOIN v2_component_definitions d
 ON json_valid(d.notes) AND json_extract(d.notes,'$.migration')='0012'
 AND json_extract(d.notes,'$.legacy_table')='collection_components'
 AND json_extract(d.notes,'$.legacy_id')=cc.id;

-- Sizes are dimension-unique. Existing TEST_0011 635x880 size is reused safely.
INSERT OR IGNORE INTO v2_sleeve_sizes (width_tenth_mm, height_tenth_mm, label)
SELECT width_tenth_mm, height_tenth_mm, label FROM sleeve_sizes;

INSERT OR IGNORE INTO v2_legacy_id_map (legacy_table, legacy_id, target_table, target_id, conversion_status, notes)
SELECT 'sleeve_sizes', CAST(s.id AS TEXT), 'v2_sleeve_sizes', v.id, 'mapped', 'Migration 0012: dimension match'
FROM sleeve_sizes s JOIN v2_sleeve_sizes v
 ON v.width_tenth_mm=s.width_tenth_mm AND v.height_tenth_mm=s.height_tenth_mm;

-- Requirement copy link remains NULL: V1 requirements were item-level, not copy-level.
INSERT INTO v2_sleeve_requirements
 (source_key, collection_item_id, owned_copy_id, component_definition_id, size_id,
  quantity_sheets, source_fragment, assignment_status, notes, created_at, updated_at)
SELECT r.source_key, im.target_id, NULL, cm.target_id, sm.target_id,
 r.quantity_sheets, r.source_fragment, r.assignment_status, r.notes, r.created_at, r.updated_at
FROM sleeve_requirements r
JOIN v2_legacy_id_map im ON im.legacy_table='collection_items' AND im.legacy_id=CAST(r.collection_item_id AS TEXT)
 AND im.target_table='v2_collection_items'
JOIN v2_legacy_id_map sm ON sm.legacy_table='sleeve_sizes' AND sm.legacy_id=CAST(r.size_id AS TEXT)
 AND sm.target_table='v2_sleeve_sizes'
LEFT JOIN v2_legacy_id_map cm ON cm.legacy_table='collection_components'
 AND cm.legacy_id=CAST(r.component_id AS TEXT) AND cm.target_table='v2_component_definitions'
WHERE NOT EXISTS (SELECT 1 FROM v2_sleeve_requirements x WHERE x.source_key=r.source_key);

INSERT OR IGNORE INTO v2_legacy_id_map (legacy_table, legacy_id, target_table, target_id, conversion_status, notes)
SELECT 'sleeve_requirements', CAST(r.id AS TEXT), 'v2_sleeve_requirements', v.id, 'mapped', 'Migration 0012: source_key match'
FROM sleeve_requirements r JOIN v2_sleeve_requirements v ON v.source_key=r.source_key;

-- No legacy records are deleted. Check results with 0012 verification queries.
