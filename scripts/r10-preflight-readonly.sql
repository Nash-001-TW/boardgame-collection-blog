-- Read-only aggregate audit; no private names, amounts, order references or notes.
SELECT COUNT(*) orders_total FROM v2_purchase_orders;
SELECT currency_code,COUNT(*) order_count FROM v2_purchase_orders GROUP BY currency_code;
SELECT COUNT(*) lines_total,SUM(CASE WHEN typeof(unit_price_minor)<>'integer' THEN 1 ELSE 0 END) noninteger_prices FROM v2_purchase_order_lines;
SELECT line_type,COUNT(*) unassigned_lines,COUNT(DISTINCT purchase_order_id) unassigned_orders FROM v2_purchase_order_lines WHERE collection_item_id IS NULL GROUP BY line_type;
SELECT CASE WHEN o.status IN('paid','partially_received','completed') THEN 'included' ELSE 'excluded' END cost_group,COUNT(*) overallocated_orders FROM v2_purchase_orders o JOIN v2_purchase_order_reconciliation r ON r.purchase_order_id=o.id WHERE r.unallocated_minor<0 GROUP BY cost_group;
SELECT COUNT(*) included_allocations,COUNT(DISTINCT o.id) orders_count,
 COALESCE(SUM(CASE WHEN c.wishlist=1 OR c.acquisition_status='wishlist' THEN 1 ELSE 0 END),0) wishlist_allocations,
 COALESCE(SUM(CASE WHEN m.archived_at IS NOT NULL THEN 1 ELSE 0 END),0) archived_allocations
FROM v2_purchase_allocations a JOIN v2_purchase_orders o ON o.id=a.purchase_order_id
LEFT JOIN v2_owned_copies p ON p.id=a.owned_copy_id
LEFT JOIN v2_collection_items c ON c.id=COALESCE(a.collection_item_id,p.collection_item_id)
LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
WHERE o.status IN('paid','partially_received','completed');
WITH direct_orders AS(SELECT DISTINCT purchase_order_id FROM v2_purchase_allocations WHERE allocation_method='direct'),
flags AS(SELECT o.id,CASE WHEN o.admin_managed<>1
 OR EXISTS(SELECT 1 FROM v2_acquisitions q JOIN v2_purchase_order_lines l ON l.id=q.purchase_order_line_id WHERE l.purchase_order_id=o.id)
 OR EXISTS(SELECT 1 FROM v2_sleeve_inventory_transactions t JOIN v2_purchase_order_lines l ON l.id=t.purchase_order_line_id WHERE l.purchase_order_id=o.id)
 OR (SELECT COUNT(*) FROM v2_purchase_allocations a WHERE a.purchase_order_id=o.id)<>(SELECT COUNT(*) FROM v2_purchase_order_lines l WHERE l.purchase_order_id=o.id)
 OR EXISTS(SELECT 1 FROM v2_purchase_order_lines l WHERE l.purchase_order_id=o.id AND (l.line_number<>(SELECT COUNT(*) FROM v2_purchase_order_lines l2 WHERE l2.purchase_order_id=o.id AND l2.line_number<=l.line_number) OR (SELECT COUNT(*) FROM v2_purchase_allocations a WHERE a.purchase_order_id=o.id AND a.purchase_order_line_id=l.id AND a.collection_item_id=l.collection_item_id AND a.owned_copy_id IS NULL)<>1))
 THEN 'locked' ELSE 'editable' END editor_state FROM v2_purchase_orders o JOIN direct_orders d ON d.purchase_order_id=o.id)
SELECT editor_state,COUNT(*) direct_orders FROM flags GROUP BY editor_state;
