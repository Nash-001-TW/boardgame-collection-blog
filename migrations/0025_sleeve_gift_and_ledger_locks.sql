-- Migration 0025 candidate: GIFT and ledger locks (TX-01, TX-03, SLV-01, SLV-11).
-- Production premise reported on 2026-11-25: zero transactions and zero applications.
-- Apply this file individually in one transaction and record it in d1_migrations.
-- Do not run migrations apply: 0024 is a separate candidate.
PRAGMA defer_foreign_keys = true;

-- Dropping this obsolete guard first makes a replay fail before changing the schema.
DROP TRIGGER v2_sleeve_inventory_validate_update;

CREATE TABLE v2_sleeve_inventory_transactions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE,
  product_id INTEGER NOT NULL REFERENCES v2_sleeve_products(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN ('PURCHASE','USE','RETURN','ADJUST','DISCARD','OPENING_BALANCE','GIFT')
  ),
  transaction_date TEXT NOT NULL,
  pack_count INTEGER CHECK (pack_count IS NULL OR pack_count > 0),
  sheets_per_pack_snapshot INTEGER CHECK (sheets_per_pack_snapshot IS NULL OR sheets_per_pack_snapshot > 0),
  quantity_sheets INTEGER NOT NULL CHECK (quantity_sheets <> 0),
  unit_pack_price_minor INTEGER CHECK (unit_pack_price_minor IS NULL OR unit_pack_price_minor >= 0),
  total_price_minor INTEGER CHECK (total_price_minor IS NULL OR total_price_minor >= 0),
  currency_code TEXT NOT NULL DEFAULT 'TWD',
  purchase_order_line_id INTEGER REFERENCES v2_purchase_order_lines(id) ON DELETE RESTRICT,
  collection_item_id INTEGER REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
  owned_copy_id INTEGER REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (transaction_type NOT IN ('PURCHASE','OPENING_BALANCE','RETURN','GIFT') OR quantity_sheets > 0),
  CHECK (transaction_type NOT IN ('USE','DISCARD') OR quantity_sheets < 0),
  CHECK (transaction_type <> 'PURCHASE' OR (
    pack_count IS NOT NULL AND sheets_per_pack_snapshot IS NOT NULL
    AND quantity_sheets = pack_count * sheets_per_pack_snapshot
  )),
  CHECK (transaction_type <> 'GIFT' OR (
    (pack_count IS NULL AND sheets_per_pack_snapshot IS NULL)
    OR (pack_count IS NOT NULL AND sheets_per_pack_snapshot IS NOT NULL
        AND quantity_sheets = pack_count * sheets_per_pack_snapshot)
  )),
  CHECK (transaction_type <> 'GIFT' OR (
    (unit_pack_price_minor IS NULL OR unit_pack_price_minor = 0)
    AND (total_price_minor IS NULL OR total_price_minor = 0)
  ))
);

INSERT INTO v2_sleeve_inventory_transactions_new (
  id, source_key, product_id, transaction_type, transaction_date, pack_count,
  sheets_per_pack_snapshot, quantity_sheets, unit_pack_price_minor, total_price_minor,
  currency_code, purchase_order_line_id, collection_item_id, owned_copy_id, notes, created_at
)
SELECT
  id, source_key, product_id, transaction_type, transaction_date, pack_count,
  sheets_per_pack_snapshot, quantity_sheets, unit_pack_price_minor, total_price_minor,
  currency_code, purchase_order_line_id, collection_item_id, owned_copy_id, notes, created_at
FROM v2_sleeve_inventory_transactions;

-- Preserve the high-water mark even if the highest historical ID was deleted.
INSERT INTO sqlite_sequence (name, seq)
SELECT 'v2_sleeve_inventory_transactions_new', seq
FROM sqlite_sequence
WHERE name = 'v2_sleeve_inventory_transactions'
  AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'v2_sleeve_inventory_transactions_new');

UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE((
  SELECT seq FROM sqlite_sequence WHERE name = 'v2_sleeve_inventory_transactions'
), 0))
WHERE name = 'v2_sleeve_inventory_transactions_new';

DROP TRIGGER v2_sleeve_inventory_validate_insert;
DROP TRIGGER v2_sleeve_inventory_validate_delete;
DROP TRIGGER v2_sleeve_application_protect_transaction_update;
DROP TRIGGER v2_sleeve_application_protect_transaction_delete;
DROP TRIGGER v2_sleeve_application_validate_insert;
DROP TRIGGER v2_application_requirement_validate;
DROP VIEW v2_sleeve_inventory_balance;

-- The old table's two explicit indexes and UNIQUE autoindex are dropped with it.
DROP TABLE v2_sleeve_inventory_transactions;
ALTER TABLE v2_sleeve_inventory_transactions_new RENAME TO v2_sleeve_inventory_transactions;

CREATE INDEX idx_v2_sleeve_inventory_product ON v2_sleeve_inventory_transactions(product_id);
CREATE INDEX idx_v2_sleeve_inventory_copy ON v2_sleeve_inventory_transactions(owned_copy_id);

CREATE VIEW v2_sleeve_inventory_balance AS
SELECT p.id AS product_id, p.size_id, p.brand, p.product_name,
       COALESCE(SUM(t.quantity_sheets), 0) AS balance_sheets
FROM v2_sleeve_products p
LEFT JOIN v2_sleeve_inventory_transactions t ON t.product_id = p.id
GROUP BY p.id, p.size_id, p.brand, p.product_name;

CREATE TRIGGER v2_sleeve_inventory_validate_insert
BEFORE INSERT ON v2_sleeve_inventory_transactions
BEGIN
  SELECT RAISE(ABORT, 'sleeve inventory copy belongs to another collection item')
  WHERE NEW.owned_copy_id IS NOT NULL AND NEW.collection_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_owned_copies c WHERE c.id = NEW.owned_copy_id AND c.collection_item_id = NEW.collection_item_id
  );
  SELECT RAISE(ABORT, 'sleeve inventory transaction would make stock negative')
  WHERE NEW.quantity_sheets < 0 AND (
    COALESCE((SELECT SUM(t.quantity_sheets) FROM v2_sleeve_inventory_transactions t WHERE t.product_id = NEW.product_id), 0)
    + NEW.quantity_sheets < 0
  );
END;

CREATE TRIGGER v2_sleeve_application_validate_insert
BEFORE INSERT ON v2_sleeve_applications
BEGIN
  SELECT RAISE(ABORT, 'sleeve application component belongs to another copy')
  WHERE NEW.copy_component_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_copy_components cc WHERE cc.id = NEW.copy_component_id AND cc.owned_copy_id = NEW.owned_copy_id
  );
  SELECT RAISE(ABORT, 'sleeve application must match a USE transaction and quantity')
  WHERE NOT EXISTS (
    SELECT 1 FROM v2_sleeve_inventory_transactions t
    WHERE t.id = NEW.inventory_transaction_id AND t.transaction_type = 'USE'
      AND t.quantity_sheets = -NEW.quantity_sheets AND t.owned_copy_id = NEW.owned_copy_id
  );
END;

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

-- These guards also cover transactions already linked to applications.
CREATE TRIGGER v2_sleeve_inventory_immutable_update
BEFORE UPDATE ON v2_sleeve_inventory_transactions
BEGIN
  SELECT RAISE(ABORT, 'SLEEVE_TRANSACTION_IMMUTABLE');
END;

CREATE TRIGGER v2_sleeve_inventory_immutable_delete
BEFORE DELETE ON v2_sleeve_inventory_transactions
BEGIN
  SELECT RAISE(ABORT, 'SLEEVE_TRANSACTION_IMMUTABLE');
END;

CREATE TRIGGER v2_sleeve_product_pack_locked
BEFORE UPDATE ON v2_sleeve_products
WHEN (NEW.size_id IS NOT OLD.size_id OR NEW.sheets_per_pack IS NOT OLD.sheets_per_pack)
  AND EXISTS (SELECT 1 FROM v2_sleeve_inventory_transactions t WHERE t.product_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'SLEEVE_PRODUCT_PACK_LOCKED');
END;

DROP TRIGGER v2_requirement_used_no_update;

-- Historical applications without a requirement still lock their collection.
-- Compare nullable fields with IS NOT and permit changes to notes and updated_at only.
CREATE TRIGGER v2_requirement_used_no_update BEFORE UPDATE ON v2_sleeve_requirements
WHEN EXISTS (SELECT 1 FROM v2_sleeve_applications a JOIN v2_owned_copies c ON c.id=a.owned_copy_id
 WHERE a.requirement_id=OLD.id OR (a.requirement_id IS NULL AND c.collection_item_id=OLD.collection_item_id))
 AND (
   NEW.id IS NOT OLD.id
   OR NEW.source_key IS NOT OLD.source_key
   OR NEW.collection_item_id IS NOT OLD.collection_item_id
   OR NEW.owned_copy_id IS NOT OLD.owned_copy_id
   OR NEW.component_definition_id IS NOT OLD.component_definition_id
   OR NEW.size_id IS NOT OLD.size_id
   OR NEW.quantity_sheets IS NOT OLD.quantity_sheets
   OR NEW.source_fragment IS NOT OLD.source_fragment
   OR NEW.assignment_status IS NOT OLD.assignment_status
   OR NEW.created_at IS NOT OLD.created_at
   OR NEW.assignment_revision IS NOT OLD.assignment_revision
 )
BEGIN
  SELECT RAISE(ABORT, 'SLEEVE_REQUIREMENT_IN_USE');
END;

-- DROP records deferred violations against the old table. RENAME restores the
-- references but does not clear that counter. Check the actual database before
-- clearing it so a real violation still rolls back the transaction.
CREATE TABLE sleeve_migration_0025_fk_guard (
  violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);
INSERT OR ROLLBACK INTO sleeve_migration_0025_fk_guard
SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE sleeve_migration_0025_fk_guard;
PRAGMA defer_foreign_keys = false;
