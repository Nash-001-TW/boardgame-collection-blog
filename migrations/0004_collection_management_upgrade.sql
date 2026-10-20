-- Migration 0004: Expand component_type directly.
-- Preconditions:
-- collection_components has 0 rows.
-- sleeve_requirements.component_id is NULL for every row.

CREATE TABLE collection_components_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_item_id INTEGER NOT NULL
    REFERENCES collection_items(id) ON DELETE CASCADE,
  bgg_id INTEGER
    REFERENCES bgg_games(bgg_id) ON DELETE SET NULL,
  component_name TEXT NOT NULL,
  component_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (component_type IN (
      'base',
      'expansion',
      'accessory',
      'storage',
      'promo',
      'crowdfunding_reward',
      'bundle_part',
      'other',
      'unknown'
    )),
  owned INTEGER NOT NULL DEFAULT 1 CHECK (owned IN (0,1)),
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('exact','manual','unmatched','ambiguous')),
  notes TEXT,
  UNIQUE(collection_item_id, component_name)
);

INSERT INTO collection_components_new (
  id, collection_item_id, bgg_id, component_name,
  component_type, owned, match_status, notes
)
SELECT
  id, collection_item_id, bgg_id, component_name,
  component_type, owned, match_status, notes
FROM collection_components;

PRAGMA defer_foreign_keys = ON;

DROP TABLE collection_components;

ALTER TABLE collection_components_new
RENAME TO collection_components;

CREATE INDEX idx_components_bgg
ON collection_components(bgg_id);

PRAGMA foreign_key_check;