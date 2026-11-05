-- D5: local-isolated validation only. Preserve all existing relation identities and rows.
-- SQLite CHECK expansion requires a table rebuild, inside D1 atomic migration batch.
DROP TRIGGER notbgg_type_change;
DROP TRIGGER notbgg_v2_identity_immutable;
CREATE TABLE d5_relation_sequence (seq INTEGER NOT NULL);
INSERT INTO d5_relation_sequence SELECT seq FROM sqlite_sequence WHERE name='site_game_relations';
CREATE TABLE site_game_relations_d5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_game_id INTEGER NOT NULL REFERENCES notbgg_games(game_id) ON DELETE RESTRICT,
  target_game_id INTEGER NOT NULL REFERENCES v2_games(id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL DEFAULT 'accessory_for' CHECK (relation_type IN ('accessory_for','compatible_with')),
  relation_source TEXT NOT NULL DEFAULT 'manual' CHECK (relation_source='manual'),
  notes TEXT,
  created_by TEXT NOT NULL CHECK (length(trim(created_by))>0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  CHECK (source_game_id<>target_game_id)
);
INSERT INTO site_game_relations_d5 SELECT * FROM site_game_relations;
DROP TABLE site_game_relations;
ALTER TABLE site_game_relations_d5 RENAME TO site_game_relations;
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT MAX(seq) FROM d5_relation_sequence),0)) WHERE name='site_game_relations';
DROP TABLE d5_relation_sequence;
CREATE UNIQUE INDEX idx_site_relations_active ON site_game_relations(source_game_id,target_game_id,relation_type) WHERE archived_at IS NULL;
CREATE INDEX idx_site_relations_target ON site_game_relations(target_game_id,archived_at);
-- Restore the 0014 retention guard lost when rebuilding the relation table.
-- Relations are archived, never hard-deleted; INSERT/UPDATE remain unaffected.
CREATE TRIGGER site_game_relations_no_delete BEFORE DELETE ON site_game_relations
BEGIN SELECT RAISE(ABORT,'Archive site relations instead of deleting'); END;
CREATE TRIGGER notbgg_type_change BEFORE UPDATE OF type ON notbgg_games
WHEN NEW.type<>'boardgameaccessory' AND
 (EXISTS (SELECT 1 FROM notbgg_accessory_categories WHERE seq=OLD.seq) OR EXISTS (SELECT 1 FROM site_game_relations WHERE source_game_id=OLD.game_id AND archived_at IS NULL))
BEGIN SELECT RAISE(ABORT,'Clear accessory categories/archive relations before changing type'); END;
CREATE TRIGGER site_relation_insert BEFORE INSERT ON site_game_relations
WHEN NOT EXISTS (SELECT 1 FROM notbgg_games WHERE game_id=NEW.source_game_id AND type='boardgameaccessory') OR
 NOT EXISTS (SELECT 1 FROM v2_games g WHERE g.id=NEW.target_game_id AND (g.bgg_id IS NOT NULL OR EXISTS (SELECT 1 FROM notbgg_games n WHERE n.game_id=g.id)))
BEGIN SELECT RAISE(ABORT,'Relation requires a NotBGG accessory and a registered target identity'); END;
CREATE TRIGGER site_relation_update BEFORE UPDATE ON site_game_relations
WHEN NOT EXISTS (SELECT 1 FROM notbgg_games WHERE game_id=NEW.source_game_id AND type='boardgameaccessory') OR
 NOT EXISTS (SELECT 1 FROM v2_games g WHERE g.id=NEW.target_game_id AND (g.bgg_id IS NOT NULL OR EXISTS (SELECT 1 FROM notbgg_games n WHERE n.game_id=g.id)))
BEGIN SELECT RAISE(ABORT,'Relation requires a NotBGG accessory and a registered target identity'); END;
CREATE TRIGGER site_relation_identity_immutable BEFORE UPDATE ON site_game_relations
WHEN NEW.id<>OLD.id OR NEW.source_game_id<>OLD.source_game_id OR NEW.target_game_id<>OLD.target_game_id OR NEW.relation_type<>OLD.relation_type OR NEW.notes IS NOT OLD.notes OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR (OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT OLD.archived_at)
BEGIN SELECT RAISE(ABORT,'Preserve original relation; create a new record'); END;
CREATE TABLE site_relation_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 relation_id INTEGER NOT NULL REFERENCES site_game_relations(id) ON DELETE RESTRICT,
 operation TEXT NOT NULL CHECK(operation IN ('created','archived')),
 actor TEXT NOT NULL CHECK(length(trim(actor))>0),
 occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_site_relation_events ON site_relation_events(relation_id,id);
CREATE TABLE v2_collection_management (
 collection_item_id INTEGER PRIMARY KEY REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 archived_at TEXT,
 request_key TEXT UNIQUE,
 request_hash TEXT,
 managed_copy_id INTEGER REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
 managed_order_id INTEGER REFERENCES v2_purchase_orders(id) ON DELETE RESTRICT
);
CREATE TABLE v2_collection_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 collection_item_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('create','update','archive')),
 actor TEXT NOT NULL CHECK(length(trim(actor))>0),
 occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(collection_item_id,revision)
);
CREATE TRIGGER collection_revision_gate BEFORE INSERT ON v2_collection_events
WHEN NEW.revision <> COALESCE((SELECT revision FROM v2_collection_management WHERE collection_item_id=NEW.collection_item_id),0)+1
BEGIN SELECT RAISE(ABORT,'COLLECTION_REVISION_CONFLICT'); END;
CREATE TRIGGER collection_events_no_update BEFORE UPDATE ON v2_collection_events
BEGIN SELECT RAISE(ABORT,'Immutable audit'); END;
CREATE TRIGGER collection_events_no_delete BEFORE DELETE ON v2_collection_events
BEGIN SELECT RAISE(ABORT,'Immutable audit'); END;
CREATE TRIGGER relation_events_no_update BEFORE UPDATE ON site_relation_events
BEGIN SELECT RAISE(ABORT,'Immutable audit'); END;
CREATE TRIGGER relation_events_no_delete BEFORE DELETE ON site_relation_events
BEGIN SELECT RAISE(ABORT,'Immutable audit'); END;

CREATE TRIGGER notbgg_v2_identity_immutable BEFORE UPDATE OF bgg_id ON v2_games
WHEN NEW.bgg_id IS NOT OLD.bgg_id AND
 (EXISTS (SELECT 1 FROM notbgg_games WHERE game_id=OLD.id) OR EXISTS (SELECT 1 FROM notbgg_bgg_links WHERE bgg_game_id=OLD.id) OR EXISTS (SELECT 1 FROM site_game_relations WHERE target_game_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'Referenced source identity cannot be relabelled'); END;

CREATE TRIGGER collection_managed_game_guard BEFORE INSERT ON v2_collection_items
WHEN json_valid(NEW.notes) AND json_extract(NEW.notes,'$.d5_create_token') IS NOT NULL
 AND (NEW.game_id IS NULL OR EXISTS(SELECT 1 FROM notbgg_games n WHERE n.game_id=NEW.game_id AND n.archived_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'Collection requires an active registered game'); END;
