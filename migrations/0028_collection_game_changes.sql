CREATE TABLE v2_collection_game_changes (
  collection_item_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  from_game_id INTEGER REFERENCES v2_games(id) ON DELETE RESTRICT,
  to_game_id INTEGER NOT NULL REFERENCES v2_games(id) ON DELETE RESTRICT,
  from_item_type TEXT NOT NULL,
  to_item_type TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  PRIMARY KEY (collection_item_id, revision),
  FOREIGN KEY (collection_item_id, revision)
    REFERENCES v2_collection_events(collection_item_id, revision) ON DELETE RESTRICT,
  CHECK (from_game_id IS NOT to_game_id)
) WITHOUT ROWID;

CREATE TRIGGER collection_game_changes_no_update BEFORE UPDATE ON v2_collection_game_changes
BEGIN SELECT RAISE(ABORT,'Immutable audit'); END;
CREATE TRIGGER collection_game_changes_no_delete BEFORE DELETE ON v2_collection_game_changes
BEGIN SELECT RAISE(ABORT,'Immutable audit'); END;
