-- Read-only pre/post migration integrity snapshot. No private row details.
SELECT id,name,applied_at FROM d1_migrations ORDER BY id;
SELECT
 (SELECT COUNT(*) FROM v2_games) AS games,
 (SELECT COUNT(*) FROM v2_collection_items) AS collection_items,
 (SELECT COUNT(*) FROM v2_owned_copies) AS owned_copies,
 (SELECT COUNT(*) FROM v2_purchase_orders) AS purchase_orders,
 (SELECT COUNT(*) FROM v2_purchase_order_lines) AS purchase_order_lines,
 (SELECT COUNT(*) FROM v2_acquisitions) AS acquisitions,
 (SELECT COUNT(*) FROM v2_purchase_allocations) AS purchase_allocations;
SELECT record_scope,COUNT(*) AS count FROM v2_collection_items GROUP BY record_scope;
SELECT COUNT(*) AS orphan_game_refs FROM v2_collection_items c
LEFT JOIN v2_games g ON g.id=c.game_id WHERE c.game_id IS NOT NULL AND g.id IS NULL;
SELECT COUNT(*) AS null_game_refs FROM v2_collection_items WHERE game_id IS NULL;
SELECT COUNT(*) AS orphan_copy_refs FROM v2_owned_copies p
LEFT JOIN v2_collection_items c ON c.id=p.collection_item_id WHERE c.id IS NULL;
SELECT COUNT(*) AS orphan_order_line_refs FROM v2_purchase_order_lines l
LEFT JOIN v2_purchase_orders o ON o.id=l.purchase_order_id WHERE o.id IS NULL;
SELECT COUNT(*) AS orphan_acquisition_copy_refs FROM v2_acquisitions a
LEFT JOIN v2_owned_copies c ON c.id=a.owned_copy_id WHERE c.id IS NULL;
SELECT type,name,tbl_name FROM sqlite_schema
WHERE name LIKE 'notbgg_%' OR name LIKE 'site_%' OR name LIKE 'v2_collection_%'
ORDER BY type,name;
PRAGMA foreign_key_check;
PRAGMA quick_check;
