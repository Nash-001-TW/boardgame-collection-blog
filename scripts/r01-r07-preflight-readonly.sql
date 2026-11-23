SELECT 'totals' AS section,
 (SELECT COUNT(*) FROM v2_collection_items) AS collections,
 (SELECT COUNT(*) FROM v2_owned_copies) AS copies,
 (SELECT COUNT(*) FROM v2_component_definitions) AS definitions,
 (SELECT COUNT(*) FROM v2_physical_component_sources) AS physical_sources,
 (SELECT COUNT(*) FROM v2_copy_components) AS copy_components,
 (SELECT COUNT(*) FROM v2_component_issues) AS issues,
 (SELECT COUNT(*) FROM v2_copy_condition_tags) AS condition_tags,
 (SELECT COUNT(*) FROM v2_copy_condition_history) AS condition_history;
SELECT 'component_status' AS section,c.record_scope,cc.inspection_status,COUNT(*) AS row_count
 FROM v2_copy_components cc JOIN v2_owned_copies p ON p.id=cc.owned_copy_id JOIN v2_collection_items c ON c.id=p.collection_item_id
 GROUP BY c.record_scope,cc.inspection_status;
SELECT 'checked_values' AS section,COUNT(*) AS checked_total,
 COALESCE(SUM(CASE WHEN actual_quantity=0 THEN 1 ELSE 0 END),0) AS checked_zero,
 COALESCE(SUM(CASE WHEN actual_quantity IS NULL THEN 1 ELSE 0 END),0) AS checked_null
 FROM v2_copy_components WHERE inspection_status='checked';
SELECT 'copy_status' AS section,c.record_scope,p.inventory_status,p.inspection_status,COUNT(*) AS row_count,
 MIN(p.created_at) AS first_created_at,MAX(p.created_at) AS last_created_at
 FROM v2_owned_copies p JOIN v2_collection_items c ON c.id=p.collection_item_id GROUP BY c.record_scope,p.inventory_status,p.inspection_status;
WITH per_copy AS(SELECT p.id,c.record_scope,p.inventory_status,
 COUNT(k.id) AS recorded_components,
 SUM(CASE WHEN k.id IS NOT NULL AND (k.inspection_status<>'checked' OR k.actual_quantity IS NULL) THEN 1 ELSE 0 END) AS unfinished_recorded
 FROM v2_owned_copies p JOIN v2_collection_items c ON c.id=p.collection_item_id LEFT JOIN v2_copy_components k ON k.owned_copy_id=p.id
 GROUP BY p.id)
SELECT 'unfinished_recorded' AS section,record_scope,inventory_status,
 CASE WHEN recorded_components=0 THEN 'no_component_rows' WHEN unfinished_recorded>0 THEN 'has_unfinished_rows' ELSE 'recorded_rows_checked' END AS recorded_state,COUNT(*) AS copy_count
 FROM per_copy GROUP BY record_scope,inventory_status,recorded_state;
SELECT 'unresolved_issues' AS section,i.issue_type,i.issue_status,
 CASE WHEN i.copy_component_id IS NULL THEN 'copy_only' ELSE 'component_linked' END AS link_kind,COUNT(*) AS row_count
 FROM v2_component_issues i WHERE i.issue_status IN('open','in_progress') GROUP BY i.issue_type,i.issue_status,link_kind;
SELECT 'definition_provenance' AS section,
 CASE WHEN d.physical_creation_token IS NOT NULL THEN 'physical_token'
 WHEN d.notes IS NULL THEN 'no_notes' WHEN json_valid(d.notes)=0 THEN 'invalid_json'
 WHEN json_extract(d.notes,'$.migration')='0012' AND json_extract(d.notes,'$.legacy_table')='collection_components' THEN 'migration_claim'
 ELSE 'other_notes' END AS source_kind,COUNT(*) AS row_count FROM v2_component_definitions d GROUP BY source_kind;
SELECT 'definition_type' AS section,component_type,quantity_unit,COUNT(*) AS row_count FROM v2_component_definitions GROUP BY component_type,quantity_unit;
SELECT 'physical_candidates' AS section,COUNT(*) AS candidate_count FROM v2_physical_component_candidates;
SELECT 'sleeve_use' AS section,
 (SELECT COUNT(*) FROM v2_sleeve_inventory_transactions WHERE transaction_type='USE') AS use_transactions,
 (SELECT COUNT(*) FROM v2_sleeve_inventory_transactions t WHERE t.transaction_type='USE' AND NOT EXISTS(SELECT 1 FROM v2_sleeve_applications a WHERE a.inventory_transaction_id=t.id)) AS unlinked_use,
 (SELECT COUNT(*) FROM v2_sleeve_applications) AS applications,
 (SELECT COUNT(*) FROM v2_sleeve_applications WHERE requirement_id IS NULL) AS unmapped_applications;
SELECT 'bundle_features' AS section,
 CASE WHEN c.game_id IS NULL THEN 'no_identity' ELSE 'has_identity' END AS identity_kind,
 CASE WHEN m.archived_at IS NULL THEN 'active' ELSE 'archived' END AS archive_state,
 CASE WHEN EXISTS(SELECT 1 FROM v2_owned_copies p WHERE p.collection_item_id=c.id) THEN 'has_copies' ELSE 'no_copies' END AS copy_state,
 CASE WHEN EXISTS(SELECT 1 FROM v2_component_definitions d WHERE d.collection_item_id=c.id) THEN 'has_definitions' ELSE 'no_definitions' END AS definition_state,
 COUNT(*) AS collection_count FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id WHERE c.item_type='bundle'
 GROUP BY identity_kind,archive_state,copy_state,definition_state;
SELECT 'copy_dates' AS section,
 (SELECT COUNT(*) FROM v2_owned_copies WHERE condition_checked_at IS NOT NULL) AS manual_date_count,
 (SELECT COUNT(*) FROM v2_copy_components WHERE last_checked_at IS NOT NULL) AS component_date_count,
 (SELECT COUNT(*) FROM v2_owned_copies WHERE condition_details IS NOT NULL AND length(trim(condition_details))>0) AS private_details_count;
