-- Existing applications remain untouched and unassigned to requirements.
ALTER TABLE v2_sleeve_applications ADD COLUMN requirement_id INTEGER
 REFERENCES v2_sleeve_requirements(id) ON DELETE RESTRICT;
CREATE INDEX idx_v2_application_requirement ON v2_sleeve_applications(requirement_id,owned_copy_id);
CREATE TABLE v2_sleeve_workflow_commands (
 request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, actor TEXT NOT NULL,
 result_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
CREATE TRIGGER v2_sleeve_workflow_no_update BEFORE UPDATE ON v2_sleeve_workflow_commands
BEGIN SELECT RAISE(ABORT,'SLEEVE_WORKFLOW_IMMUTABLE'); END;
CREATE TRIGGER v2_sleeve_workflow_no_delete BEFORE DELETE ON v2_sleeve_workflow_commands
BEGIN SELECT RAISE(ABORT,'SLEEVE_WORKFLOW_IMMUTABLE'); END;
CREATE TRIGGER v2_application_requirement_validate BEFORE INSERT ON v2_sleeve_applications
WHEN NEW.requirement_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'SLEEVE_WORKFLOW_STATE_CHANGED') WHERE NOT EXISTS (
  SELECT 1 FROM v2_sleeve_requirements r
  JOIN v2_owned_copies c ON c.id=NEW.owned_copy_id AND c.collection_item_id=r.collection_item_id
  JOIN v2_sleeve_inventory_transactions t ON t.id=NEW.inventory_transaction_id
  JOIN v2_sleeve_products p ON p.id=t.product_id AND p.size_id=r.size_id
  JOIN v2_copy_components cc ON cc.id=NEW.copy_component_id AND cc.owned_copy_id=c.id
    AND cc.component_definition_id=r.component_definition_id
  WHERE r.id=NEW.requirement_id AND (r.owned_copy_id IS NULL OR r.owned_copy_id=c.id)
   AND t.collection_item_id=r.collection_item_id
   AND NEW.quantity_sheets+COALESCE((SELECT SUM(a.quantity_sheets) FROM v2_sleeve_applications a
     WHERE a.requirement_id=r.id AND a.owned_copy_id=c.id),0)<=r.quantity_sheets
 );
END;
-- Freeze all requirement fields after recorded usage. Legacy applications cannot be mapped
-- reliably, so conservatively freeze requirements for that collection as well.
CREATE TRIGGER v2_requirement_used_no_update BEFORE UPDATE ON v2_sleeve_requirements
WHEN EXISTS (SELECT 1 FROM v2_sleeve_applications a JOIN v2_owned_copies c ON c.id=a.owned_copy_id
 WHERE a.requirement_id=OLD.id OR (a.requirement_id IS NULL AND c.collection_item_id=OLD.collection_item_id))
BEGIN SELECT RAISE(ABORT,'SLEEVE_REQUIREMENT_IN_USE'); END;
CREATE TRIGGER v2_requirement_used_no_delete BEFORE DELETE ON v2_sleeve_requirements
WHEN EXISTS (SELECT 1 FROM v2_sleeve_applications a JOIN v2_owned_copies c ON c.id=a.owned_copy_id
 WHERE a.requirement_id=OLD.id OR (a.requirement_id IS NULL AND c.collection_item_id=OLD.collection_item_id))
BEGIN SELECT RAISE(ABORT,'SLEEVE_REQUIREMENT_IN_USE'); END;
