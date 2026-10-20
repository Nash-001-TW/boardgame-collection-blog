-- Migration 0011: V2 sleeve management schema
-- Schema only. V1 data migration will follow separately.

CREATE TABLE v2_sleeve_sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  width_tenth_mm INTEGER NOT NULL CHECK (width_tenth_mm > 0),
  height_tenth_mm INTEGER NOT NULL CHECK (height_tenth_mm > 0),
  label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(width_tenth_mm, height_tenth_mm)
);

CREATE TABLE v2_sleeve_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  size_id INTEGER NOT NULL REFERENCES v2_sleeve_sizes(id) ON DELETE RESTRICT,
  brand TEXT,
  product_name TEXT NOT NULL CHECK (length(trim(product_name)) > 0),
  thickness_microns INTEGER CHECK (thickness_microns IS NULL OR thickness_microns > 0),
  sheets_per_pack INTEGER NOT NULL CHECK (sheets_per_pack > 0),
  default_pack_price_minor INTEGER CHECK (default_pack_price_minor IS NULL OR default_pack_price_minor >= 0),
  default_currency_code TEXT NOT NULL DEFAULT 'TWD',
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE v2_sleeve_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE,
  collection_item_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
  owned_copy_id INTEGER REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  component_definition_id INTEGER REFERENCES v2_component_definitions(id) ON DELETE RESTRICT,
  size_id INTEGER NOT NULL REFERENCES v2_sleeve_sizes(id) ON DELETE RESTRICT,
  quantity_sheets INTEGER NOT NULL CHECK (quantity_sheets >= 0),
  source_fragment TEXT,
  assignment_status TEXT NOT NULL DEFAULT 'unassigned'
    CHECK (assignment_status IN ('unassigned','confirmed','needs_review')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_v2_sleeve_requirements_item ON v2_sleeve_requirements(collection_item_id);
CREATE INDEX idx_v2_sleeve_requirements_copy ON v2_sleeve_requirements(owned_copy_id);
CREATE INDEX idx_v2_sleeve_requirements_size ON v2_sleeve_requirements(size_id);

CREATE TRIGGER v2_sleeve_requirement_validate_insert
BEFORE INSERT ON v2_sleeve_requirements
BEGIN
  SELECT RAISE(ABORT, 'sleeve requirement copy belongs to another collection item')
  WHERE NEW.owned_copy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_owned_copies c WHERE c.id = NEW.owned_copy_id AND c.collection_item_id = NEW.collection_item_id
  );
  SELECT RAISE(ABORT, 'sleeve requirement component belongs to another collection item')
  WHERE NEW.component_definition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_component_definitions d WHERE d.id = NEW.component_definition_id AND d.collection_item_id = NEW.collection_item_id
  );
END;

CREATE TRIGGER v2_sleeve_requirement_validate_update
BEFORE UPDATE OF collection_item_id, owned_copy_id, component_definition_id ON v2_sleeve_requirements
BEGIN
  SELECT RAISE(ABORT, 'sleeve requirement copy belongs to another collection item')
  WHERE NEW.owned_copy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_owned_copies c WHERE c.id = NEW.owned_copy_id AND c.collection_item_id = NEW.collection_item_id
  );
  SELECT RAISE(ABORT, 'sleeve requirement component belongs to another collection item')
  WHERE NEW.component_definition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_component_definitions d WHERE d.id = NEW.component_definition_id AND d.collection_item_id = NEW.collection_item_id
  );
END;

CREATE TABLE v2_sleeve_inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE,
  product_id INTEGER NOT NULL REFERENCES v2_sleeve_products(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN ('PURCHASE','USE','RETURN','ADJUST','DISCARD','OPENING_BALANCE')
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
  CHECK (transaction_type NOT IN ('PURCHASE','OPENING_BALANCE') OR quantity_sheets > 0),
  CHECK (transaction_type NOT IN ('USE','DISCARD') OR quantity_sheets < 0),
  CHECK (transaction_type <> 'PURCHASE' OR (
    pack_count IS NOT NULL AND sheets_per_pack_snapshot IS NOT NULL
    AND quantity_sheets = pack_count * sheets_per_pack_snapshot
  ))
);

CREATE INDEX idx_v2_sleeve_inventory_product ON v2_sleeve_inventory_transactions(product_id);
CREATE INDEX idx_v2_sleeve_inventory_copy ON v2_sleeve_inventory_transactions(owned_copy_id);

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

CREATE TRIGGER v2_sleeve_inventory_validate_update
BEFORE UPDATE ON v2_sleeve_inventory_transactions
BEGIN
  SELECT RAISE(ABORT, 'sleeve inventory copy belongs to another collection item')
  WHERE NEW.owned_copy_id IS NOT NULL AND NEW.collection_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v2_owned_copies c WHERE c.id = NEW.owned_copy_id AND c.collection_item_id = NEW.collection_item_id
  );
  SELECT RAISE(ABORT, 'sleeve inventory update would make stock negative')
  WHERE COALESCE((SELECT SUM(t.quantity_sheets) FROM v2_sleeve_inventory_transactions t
                  WHERE t.product_id = OLD.product_id AND t.id <> OLD.id), 0)
        + CASE WHEN NEW.product_id = OLD.product_id THEN NEW.quantity_sheets ELSE 0 END < 0
     OR COALESCE((SELECT SUM(t.quantity_sheets) FROM v2_sleeve_inventory_transactions t
                  WHERE t.product_id = NEW.product_id AND t.id <> OLD.id), 0)
        + NEW.quantity_sheets < 0;
END;

CREATE TRIGGER v2_sleeve_inventory_validate_delete
BEFORE DELETE ON v2_sleeve_inventory_transactions
BEGIN
  SELECT RAISE(ABORT, 'sleeve inventory deletion would make stock negative')
  WHERE COALESCE((SELECT SUM(t.quantity_sheets) FROM v2_sleeve_inventory_transactions t
                  WHERE t.product_id = OLD.product_id), 0) - OLD.quantity_sheets < 0;
END;

CREATE TABLE v2_sleeve_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  copy_component_id INTEGER REFERENCES v2_copy_components(id) ON DELETE RESTRICT,
  inventory_transaction_id INTEGER NOT NULL UNIQUE
    REFERENCES v2_sleeve_inventory_transactions(id) ON DELETE RESTRICT,
  quantity_sheets INTEGER NOT NULL CHECK (quantity_sheets > 0),
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_v2_sleeve_applications_copy ON v2_sleeve_applications(owned_copy_id);

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

CREATE TRIGGER v2_sleeve_application_immutable_update
BEFORE UPDATE ON v2_sleeve_applications
BEGIN
  SELECT RAISE(ABORT, 'sleeve application is immutable; use reversal transactions');
END;

CREATE TRIGGER v2_sleeve_application_immutable_delete
BEFORE DELETE ON v2_sleeve_applications
BEGIN
  SELECT RAISE(ABORT, 'sleeve application is immutable; use reversal transactions');
END;

CREATE TRIGGER v2_sleeve_application_protect_transaction_update
BEFORE UPDATE ON v2_sleeve_inventory_transactions
WHEN EXISTS (SELECT 1 FROM v2_sleeve_applications a WHERE a.inventory_transaction_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'transaction linked to sleeve application cannot be updated');
END;

CREATE TRIGGER v2_sleeve_application_protect_transaction_delete
BEFORE DELETE ON v2_sleeve_inventory_transactions
WHEN EXISTS (SELECT 1 FROM v2_sleeve_applications a WHERE a.inventory_transaction_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'transaction linked to sleeve application cannot be deleted');
END;

CREATE VIEW v2_sleeve_inventory_balance AS
SELECT p.id AS product_id, p.size_id, p.brand, p.product_name,
       COALESCE(SUM(t.quantity_sheets), 0) AS balance_sheets
FROM v2_sleeve_products p
LEFT JOIN v2_sleeve_inventory_transactions t ON t.product_id = p.id
GROUP BY p.id, p.size_id, p.brand, p.product_name;

CREATE VIEW v2_sleeve_requirements_by_size AS
SELECT s.id AS size_id, s.width_tenth_mm, s.height_tenth_mm,
       COUNT(r.id) AS requirement_count,
       COALESCE(SUM(r.quantity_sheets), 0) AS required_sheets
FROM v2_sleeve_sizes s
LEFT JOIN v2_sleeve_requirements r ON r.size_id = s.id
GROUP BY s.id, s.width_tenth_mm, s.height_tenth_mm;
