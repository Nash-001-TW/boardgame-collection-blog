-- Read-only aggregate audit. No private row payloads, no schema or data writes.
SELECT
 (SELECT COUNT(*) FROM collection_items) AS v1_collections,
 (SELECT COUNT(*) FROM v2_collection_items) AS v2_collections,
 (SELECT COUNT(*) FROM collection_components) AS v1_components,
 (SELECT COUNT(*) FROM v2_component_definitions) AS v2_definitions,
 (SELECT COUNT(*) FROM sleeve_sizes) AS v1_sizes,
 (SELECT COUNT(*) FROM v2_sleeve_sizes) AS v2_sizes,
 (SELECT COUNT(*) FROM sleeve_requirements) AS v1_requirements,
 (SELECT COUNT(*) FROM v2_sleeve_requirements) AS v2_requirements,
 (SELECT COUNT(*) FROM sleeve_products) AS v1_products,
 (SELECT COUNT(*) FROM v2_sleeve_products) AS v2_products,
 (SELECT COUNT(*) FROM sleeve_inventory_transactions) AS v1_transactions,
 (SELECT COUNT(*) FROM v2_sleeve_inventory_transactions) AS v2_transactions;

WITH sources(source_table, source_id, target_table) AS (
 SELECT 'collection_items',CAST(id AS TEXT),'v2_collection_items' FROM collection_items
 UNION ALL SELECT 'collection_components',CAST(id AS TEXT),'v2_component_definitions' FROM collection_components
 UNION ALL SELECT 'sleeve_sizes',CAST(id AS TEXT),'v2_sleeve_sizes' FROM sleeve_sizes
 UNION ALL SELECT 'sleeve_requirements',CAST(id AS TEXT),'v2_sleeve_requirements' FROM sleeve_requirements
), audited AS (
 SELECT s.*, (SELECT COUNT(*) FROM v2_legacy_id_map m
 WHERE m.legacy_table=s.source_table AND m.legacy_id=s.source_id AND m.target_table=s.target_table) AS mapping_count
 FROM sources s
)
SELECT source_table,COUNT(*) AS source_rows,
 SUM(CASE WHEN mapping_count=0 THEN 1 ELSE 0 END) AS missing_mappings,
 SUM(CASE WHEN mapping_count>1 THEN 1 ELSE 0 END) AS ambiguous_mappings
FROM audited GROUP BY source_table;

WITH targets(target_table,target_id) AS (
 SELECT 'v2_collection_items',id FROM v2_collection_items
 UNION ALL SELECT 'v2_component_definitions',id FROM v2_component_definitions
 UNION ALL SELECT 'v2_sleeve_sizes',id FROM v2_sleeve_sizes
 UNION ALL SELECT 'v2_sleeve_requirements',id FROM v2_sleeve_requirements
)
SELECT m.target_table,COUNT(*) AS dangling_target_mappings
FROM v2_legacy_id_map m LEFT JOIN targets t ON t.target_table=m.target_table AND t.target_id=m.target_id
WHERE m.target_table IN ('v2_collection_items','v2_component_definitions','v2_sleeve_sizes','v2_sleeve_requirements')
AND t.target_id IS NULL GROUP BY m.target_table;

SELECT 'collection_common_fields' AS check_name,COUNT(*) AS mismatches
FROM collection_items s JOIN v2_legacy_id_map m
 ON m.legacy_table='collection_items' AND m.legacy_id=CAST(s.id AS TEXT) AND m.target_table='v2_collection_items'
JOIN v2_collection_items t ON t.id=m.target_id
WHERE t.display_name IS NOT s.display_name OR t.wishlist IS NOT s.wishlist
 OR t.created_at IS NOT s.created_at
 OR t.item_type IS NOT CASE WHEN s.item_type IN ('base','expansion','bundle','accessory','storage','promo','other') THEN s.item_type ELSE 'unknown' END
 OR t.acquisition_status IS NOT CASE WHEN s.acquisition_status IN ('owned','preordered','wishlist','not_owned','unknown') THEN s.acquisition_status ELSE 'unknown' END;

SELECT 'component_common_fields' AS check_name,COUNT(*) AS mismatches
FROM collection_components s JOIN v2_legacy_id_map m
 ON m.legacy_table='collection_components' AND m.legacy_id=CAST(s.id AS TEXT) AND m.target_table='v2_component_definitions'
JOIN v2_component_definitions t ON t.id=m.target_id
WHERE t.component_name IS NOT s.component_name OR t.expected_quantity IS NOT s.quantity
 OR t.quantity_unit IS NOT CASE WHEN s.quantity_unit IN ('piece','card','tile','die','sheet','box','pack','set','other') THEN s.quantity_unit ELSE 'other' END
 OR NOT EXISTS(SELECT 1 FROM v2_legacy_id_map p WHERE p.legacy_table='collection_items'
 AND p.legacy_id=CAST(s.collection_item_id AS TEXT) AND p.target_table='v2_collection_items' AND p.target_id=t.collection_item_id);

SELECT 'size_dimensions' AS check_name,COUNT(*) AS mismatches
FROM sleeve_sizes s JOIN v2_legacy_id_map m
 ON m.legacy_table='sleeve_sizes' AND m.legacy_id=CAST(s.id AS TEXT) AND m.target_table='v2_sleeve_sizes'
JOIN v2_sleeve_sizes t ON t.id=m.target_id
WHERE t.width_tenth_mm IS NOT s.width_tenth_mm OR t.height_tenth_mm IS NOT s.height_tenth_mm;

SELECT 'requirement_common_fields' AS check_name,COUNT(*) AS mismatches
FROM sleeve_requirements s JOIN v2_legacy_id_map m
 ON m.legacy_table='sleeve_requirements' AND m.legacy_id=CAST(s.id AS TEXT) AND m.target_table='v2_sleeve_requirements'
JOIN v2_sleeve_requirements t ON t.id=m.target_id
WHERE t.source_key IS NOT s.source_key OR t.quantity_sheets IS NOT s.quantity_sheets
 OR t.source_fragment IS NOT s.source_fragment OR t.assignment_status IS NOT s.assignment_status OR t.notes IS NOT s.notes
 OR NOT EXISTS(SELECT 1 FROM v2_legacy_id_map p WHERE p.legacy_table='collection_items'
 AND p.legacy_id=CAST(s.collection_item_id AS TEXT) AND p.target_table='v2_collection_items' AND p.target_id=t.collection_item_id)
 OR NOT EXISTS(SELECT 1 FROM v2_legacy_id_map z WHERE z.legacy_table='sleeve_sizes'
 AND z.legacy_id=CAST(s.size_id AS TEXT) AND z.target_table='v2_sleeve_sizes' AND z.target_id=t.size_id)
 OR (s.component_id IS NULL AND t.component_definition_id IS NOT NULL)
 OR (s.component_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM v2_legacy_id_map c
 WHERE c.legacy_table='collection_components' AND c.legacy_id=CAST(s.component_id AS TEXT)
 AND c.target_table='v2_component_definitions' AND c.target_id=t.component_definition_id));
