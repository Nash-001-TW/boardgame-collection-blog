-- Board Game Collection Manager V2.0
-- Migration 0007: Core catalog, collection, physical copies, relations and components.
-- Additive only: no V1 tables are altered or dropped.
-- Cloudflare D1 / SQLite

CREATE TABLE IF NOT EXISTS v2_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bgg_id INTEGER UNIQUE CHECK (bgg_id IS NULL OR bgg_id > 0),
  primary_name TEXT NOT NULL CHECK (length(trim(primary_name)) > 0),
  game_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (game_type IN ('base','expansion','standalone','accessory','bundle','other','unknown')),
  standalone_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (standalone_status IN ('yes','no','unknown')),
  catalog_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (catalog_source IN ('bgg','manual','import')),
  description TEXT,
  publication_year INTEGER CHECK (publication_year IS NULL OR publication_year BETWEEN 1800 AND 2200),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_v2_games_name ON v2_games(primary_name);

CREATE TABLE IF NOT EXISTS v2_game_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_game_id INTEGER NOT NULL REFERENCES v2_games(id) ON DELETE CASCADE,
  target_game_id INTEGER NOT NULL REFERENCES v2_games(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL
    CHECK (relation_type IN ('requires_base','expansion_of','standalone_related','same_series','integrates_with','compilation_of','accessory_for','other')),
  relation_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (relation_source IN ('bgg','manual','import')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_game_id <> target_game_id),
  UNIQUE (source_game_id, target_game_id, relation_type, relation_source)
);
CREATE INDEX IF NOT EXISTS idx_v2_game_relations_target ON v2_game_relations(target_game_id, relation_type);

CREATE TABLE IF NOT EXISTS v2_collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER REFERENCES v2_games(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  item_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (item_type IN ('base','expansion','standalone','bundle','accessory','storage','promo','other','unknown')),
  acquisition_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (acquisition_status IN ('owned','preordered','wishlist','not_owned','sold','gifted_away','unknown')),
  wishlist INTEGER NOT NULL DEFAULT 0 CHECK (wishlist IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_v2_collection_game ON v2_collection_items(game_id);
CREATE INDEX IF NOT EXISTS idx_v2_collection_status ON v2_collection_items(acquisition_status);

CREATE TABLE IF NOT EXISTS v2_owned_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_item_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
  copy_label TEXT,
  edition TEXT,
  language_code TEXT,
  acquisition_date TEXT,
  seal_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (seal_status IN ('sealed','unsealed','unknown')),
  inventory_status TEXT NOT NULL DEFAULT 'in_collection'
    CHECK (inventory_status IN ('in_collection','loaned','sold','gifted_away','lost','unknown')),
  inspection_status TEXT NOT NULL DEFAULT 'unchecked'
    CHECK (inspection_status IN ('unchecked','checked','needs_review')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_v2_copies_item ON v2_owned_copies(collection_item_id);

CREATE TABLE IF NOT EXISTS v2_collection_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_item_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE CASCADE,
  target_item_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL
    CHECK (relation_type IN ('requires_base','expansion_of','standalone_related','same_series','integrates_with','bundle_contains','accessory_for','other')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_item_id <> target_item_id),
  UNIQUE (source_item_id, target_item_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_v2_collection_relations_target ON v2_collection_relations(target_item_id, relation_type);

-- Catalog of expected parts; optional link to a specific copy when parts differ by edition.
CREATE TABLE IF NOT EXISTS v2_component_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_item_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL CHECK (length(trim(component_name)) > 0),
  component_type TEXT NOT NULL DEFAULT 'other'
    CHECK (component_type IN ('card','tile','token','miniature','die','board','booklet','sheet','insert','other')),
  expected_quantity INTEGER CHECK (expected_quantity IS NULL OR expected_quantity >= 0),
  quantity_unit TEXT NOT NULL DEFAULT 'piece'
    CHECK (quantity_unit IN ('piece','card','tile','die','sheet','box','pack','set','other')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_v2_component_definitions_item ON v2_component_definitions(collection_item_id);

-- A copy's inventory can be unknown until physically counted.
CREATE TABLE IF NOT EXISTS v2_copy_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE CASCADE,
  component_definition_id INTEGER NOT NULL REFERENCES v2_component_definitions(id) ON DELETE RESTRICT,
  actual_quantity INTEGER CHECK (actual_quantity IS NULL OR actual_quantity >= 0),
  inspection_status TEXT NOT NULL DEFAULT 'unchecked'
    CHECK (inspection_status IN ('unchecked','checked','needs_review')),
  notes TEXT,
  last_checked_at TEXT,
  UNIQUE (owned_copy_id, component_definition_id)
);
CREATE INDEX IF NOT EXISTS idx_v2_copy_components_definition ON v2_copy_components(component_definition_id);

CREATE TABLE IF NOT EXISTS v2_component_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  copy_component_id INTEGER REFERENCES v2_copy_components(id) ON DELETE SET NULL,
  issue_type TEXT NOT NULL
    CHECK (issue_type IN ('missing','damaged','incorrect','replacement_needed','other')),
  affected_quantity INTEGER CHECK (affected_quantity IS NULL OR affected_quantity > 0),
  play_impact TEXT NOT NULL DEFAULT 'unknown'
    CHECK (play_impact IN ('none','limited','unplayable','unknown')),
  issue_status TEXT NOT NULL DEFAULT 'open'
    CHECK (issue_status IN ('open','in_progress','resolved','cancelled')),
  discovered_at TEXT,
  resolved_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_v2_component_issues_copy_status ON v2_component_issues(owned_copy_id, issue_status);

-- Source-to-target mapping is retained through verification and cleanup planning.
CREATE TABLE IF NOT EXISTS v2_legacy_id_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_table TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  conversion_status TEXT NOT NULL DEFAULT 'mapped'
    CHECK (conversion_status IN ('mapped','verified','needs_review')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (legacy_table, legacy_id, target_table, target_id)
);
CREATE INDEX IF NOT EXISTS idx_v2_legacy_target ON v2_legacy_id_map(target_table, target_id);
