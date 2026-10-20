-- Board game sleeve management - Cloudflare D1 / SQLite
-- Migration 0001: schema only; no existing website tables are changed.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bgg_games (
  bgg_id INTEGER PRIMARY KEY CHECK (bgg_id > 0),
  name TEXT NOT NULL,
  game_type TEXT NOT NULL DEFAULT 'unknown',
  is_expansion INTEGER NOT NULL DEFAULT 0 CHECK (is_expansion IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bgg_game_relations (
  parent_bgg_id INTEGER NOT NULL REFERENCES bgg_games(bgg_id) ON DELETE CASCADE,
  child_bgg_id INTEGER NOT NULL REFERENCES bgg_games(bgg_id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('expansion','implementation','compilation')),
  PRIMARY KEY (parent_bgg_id, child_bgg_id, relation_type),
  CHECK (parent_bgg_id <> child_bgg_id)
);
CREATE INDEX IF NOT EXISTS idx_bgg_relations_child ON bgg_game_relations(child_bgg_id, relation_type);

-- An Excel row represents a physical collection record, not necessarily one BGG title.
CREATE TABLE IF NOT EXISTS collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE, -- e.g. excel:sheet1:row:8
  source_row INTEGER,
  source_serial TEXT,
  display_name TEXT NOT NULL,
  bgg_id INTEGER REFERENCES bgg_games(bgg_id) ON DELETE SET NULL,
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('exact','manual','unmatched','ambiguous')),
  owned INTEGER NOT NULL DEFAULT 1 CHECK (owned IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_collection_bgg ON collection_items(bgg_id);
CREATE INDEX IF NOT EXISTS idx_collection_match ON collection_items(match_status);

-- Bundle membership is distinct from the BGG expansion relationship.
CREATE TABLE IF NOT EXISTS collection_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_item_id INTEGER NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  bgg_id INTEGER REFERENCES bgg_games(bgg_id) ON DELETE SET NULL,
  component_name TEXT NOT NULL,
  component_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (component_type IN ('base','expansion','bundle_part','unknown')),
  owned INTEGER NOT NULL DEFAULT 1 CHECK (owned IN (0,1)),
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('exact','manual','unmatched','ambiguous')),
  notes TEXT,
  UNIQUE(collection_item_id, component_name)
);
CREATE INDEX IF NOT EXISTS idx_components_bgg ON collection_components(bgg_id);

CREATE TABLE IF NOT EXISTS sleeve_sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  width_tenth_mm INTEGER NOT NULL CHECK (width_tenth_mm > 0),
  height_tenth_mm INTEGER NOT NULL CHECK (height_tenth_mm > 0),
  label TEXT,
  UNIQUE(width_tenth_mm, height_tenth_mm)
);

-- Requirements are measured in individual sleeves (sheets), not packs.
-- Keep unassigned Excel rows attached to collection_items; component_id can be NULL.
CREATE TABLE IF NOT EXISTS sleeve_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE, -- e.g. excel:sheet1:row:8:detail:1
  collection_item_id INTEGER NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  component_id INTEGER REFERENCES collection_components(id) ON DELETE SET NULL,
  size_id INTEGER NOT NULL REFERENCES sleeve_sizes(id),
  quantity_sheets INTEGER NOT NULL CHECK (quantity_sheets >= 0),
  source_fragment TEXT,
  assignment_status TEXT NOT NULL DEFAULT 'unassigned'
    CHECK (assignment_status IN ('unassigned','confirmed','needs_review')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_requirements_item ON sleeve_requirements(collection_item_id);
CREATE INDEX IF NOT EXISTS idx_requirements_component ON sleeve_requirements(component_id);
CREATE INDEX IF NOT EXISTS idx_requirements_size ON sleeve_requirements(size_id);

CREATE TABLE IF NOT EXISTS sleeve_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  size_id INTEGER NOT NULL REFERENCES sleeve_sizes(id),
  brand TEXT,
  product_name TEXT NOT NULL,
  thickness_microns INTEGER CHECK (thickness_microns IS NULL OR thickness_microns > 0),
  sheets_per_pack INTEGER NOT NULL CHECK (sheets_per_pack > 0),
  default_pack_price_cents INTEGER CHECK (default_pack_price_cents IS NULL OR default_pack_price_cents >= 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_products_size ON sleeve_products(size_id);

-- Signed sheet movements are authoritative for on-hand inventory.
-- pack_count and sheets_per_pack_snapshot preserve packaging history.
-- Purchases are positive; uses and discards negative; returns/adjustments may be signed.
CREATE TABLE IF NOT EXISTS sleeve_inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE, -- for idempotent Excel imports
  product_id INTEGER NOT NULL REFERENCES sleeve_products(id),
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN ('PURCHASE','USE','RETURN','ADJUST','DISCARD','OPENING_BALANCE')
  ),
  transaction_date TEXT NOT NULL, -- YYYY-MM-DD
  pack_count INTEGER CHECK (pack_count IS NULL OR pack_count > 0),
  sheets_per_pack_snapshot INTEGER CHECK (sheets_per_pack_snapshot IS NULL OR sheets_per_pack_snapshot > 0),
  quantity_sheets INTEGER NOT NULL CHECK (quantity_sheets <> 0),
  unit_pack_price_cents INTEGER CHECK (unit_pack_price_cents IS NULL OR unit_pack_price_cents >= 0),
  total_price_cents INTEGER CHECK (total_price_cents IS NULL OR total_price_cents >= 0),
  collection_item_id INTEGER REFERENCES collection_items(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (transaction_type NOT IN ('PURCHASE','OPENING_BALANCE') OR quantity_sheets > 0),
  CHECK (transaction_type NOT IN ('USE','DISCARD') OR quantity_sheets < 0),
  CHECK (transaction_type <> 'PURCHASE' OR (
    pack_count IS NOT NULL AND sheets_per_pack_snapshot IS NOT NULL
    AND quantity_sheets = pack_count * sheets_per_pack_snapshot
  ))
);
CREATE INDEX IF NOT EXISTS idx_inventory_product_date ON sleeve_inventory_transactions(product_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_inventory_collection ON sleeve_inventory_transactions(collection_item_id);

-- A view is used instead of a separately maintained stock counter.
CREATE VIEW IF NOT EXISTS v_sleeve_inventory_balance AS
SELECT p.id AS product_id, p.size_id, p.brand, p.product_name,
       p.sheets_per_pack AS current_sheets_per_pack,
       COALESCE(SUM(t.quantity_sheets),0) AS balance_sheets
FROM sleeve_products p
LEFT JOIN sleeve_inventory_transactions t ON t.product_id = p.id
GROUP BY p.id;

CREATE VIEW IF NOT EXISTS v_sleeve_requirements_by_size AS
SELECT s.id AS size_id, s.width_tenth_mm, s.height_tenth_mm,
       SUM(r.quantity_sheets) AS total_sheets,
       COUNT(*) AS requirement_rows
FROM sleeve_requirements r
JOIN sleeve_sizes s ON s.id = r.size_id
GROUP BY s.id;
