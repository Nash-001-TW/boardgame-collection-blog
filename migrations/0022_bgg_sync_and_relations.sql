-- Extend the existing cache. No import or timestamp backfill for historical/static data.
ALTER TABLE bgg_games ADD COLUMN cache_json TEXT;
ALTER TABLE bgg_games ADD COLUMN last_success_at TEXT;
ALTER TABLE bgg_games ADD COLUMN last_attempt_at TEXT;
ALTER TABLE bgg_games ADD COLUMN last_error_code TEXT;
ALTER TABLE bgg_games ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE bgg_games ADD COLUMN sync_owner TEXT;
CREATE TABLE v2_bgg_sync_gate(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,next_allowed INTEGER NOT NULL DEFAULT 0);
INSERT INTO v2_bgg_sync_gate(id) VALUES(1);
CREATE TABLE v2_bgg_sync_commands(request_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,results_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) WITHOUT ROWID;
ALTER TABLE v2_game_relations ADD COLUMN admin_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_game_relations ADD COLUMN admin_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(admin_confirmed IN(0,1));
ALTER TABLE v2_game_relations ADD COLUMN archived_at TEXT;
ALTER TABLE v2_collection_relations ADD COLUMN admin_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_collection_relations ADD COLUMN archived_at TEXT;
CREATE TABLE v2_relation_admin_commands(request_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) WITHOUT ROWID;
CREATE TRIGGER v2_relation_command_no_update BEFORE UPDATE ON v2_relation_admin_commands BEGIN SELECT RAISE(ABORT,'RELATION_COMMAND_IMMUTABLE'); END;
CREATE TRIGGER v2_relation_command_no_delete BEFORE DELETE ON v2_relation_admin_commands BEGIN SELECT RAISE(ABORT,'RELATION_COMMAND_IMMUTABLE'); END;
-- Only dependency hierarchies are acyclic; symmetric related-game graphs may cycle.
CREATE TRIGGER v2_game_relation_cycle_insert BEFORE INSERT ON v2_game_relations
WHEN NEW.archived_at IS NULL AND NEW.relation_type IN('requires_base','expansion_of','compilation_of','accessory_for')
BEGIN
 SELECT RAISE(ABORT,'RELATION_CYCLE') WHERE EXISTS(
 WITH RECURSIVE reach(id) AS(SELECT NEW.target_game_id UNION SELECT r.target_game_id FROM v2_game_relations r JOIN reach x ON r.source_game_id=x.id WHERE r.archived_at IS NULL AND
 ((NEW.relation_type IN('requires_base','expansion_of') AND r.relation_type IN('requires_base','expansion_of')) OR r.relation_type=NEW.relation_type)) SELECT 1 FROM reach WHERE id=NEW.source_game_id);
END;
CREATE TRIGGER v2_game_relation_cycle_update BEFORE UPDATE ON v2_game_relations
WHEN NEW.archived_at IS NULL AND NEW.relation_type IN('requires_base','expansion_of','compilation_of','accessory_for')
BEGIN
 SELECT RAISE(ABORT,'RELATION_CYCLE') WHERE EXISTS(
 WITH RECURSIVE reach(id) AS(SELECT NEW.target_game_id UNION SELECT r.target_game_id FROM v2_game_relations r JOIN reach x ON r.source_game_id=x.id WHERE r.id<>OLD.id AND r.archived_at IS NULL AND
 ((NEW.relation_type IN('requires_base','expansion_of') AND r.relation_type IN('requires_base','expansion_of')) OR r.relation_type=NEW.relation_type)) SELECT 1 FROM reach WHERE id=NEW.source_game_id);
END;
CREATE TRIGGER v2_collection_relation_cycle_insert BEFORE INSERT ON v2_collection_relations
WHEN NEW.archived_at IS NULL AND NEW.relation_type IN('requires_base','expansion_of','bundle_contains','accessory_for')
BEGIN
 SELECT RAISE(ABORT,'RELATION_CYCLE') WHERE EXISTS(
 WITH RECURSIVE reach(id) AS(SELECT NEW.target_item_id UNION SELECT r.target_item_id FROM v2_collection_relations r JOIN reach x ON r.source_item_id=x.id WHERE r.archived_at IS NULL AND
 ((NEW.relation_type IN('requires_base','expansion_of') AND r.relation_type IN('requires_base','expansion_of')) OR r.relation_type=NEW.relation_type)) SELECT 1 FROM reach WHERE id=NEW.source_item_id);
END;
CREATE TRIGGER v2_collection_relation_cycle_update BEFORE UPDATE ON v2_collection_relations
WHEN NEW.archived_at IS NULL AND NEW.relation_type IN('requires_base','expansion_of','bundle_contains','accessory_for')
BEGIN
 SELECT RAISE(ABORT,'RELATION_CYCLE') WHERE EXISTS(
 WITH RECURSIVE reach(id) AS(SELECT NEW.target_item_id UNION SELECT r.target_item_id FROM v2_collection_relations r JOIN reach x ON r.source_item_id=x.id WHERE r.id<>OLD.id AND r.archived_at IS NULL AND
 ((NEW.relation_type IN('requires_base','expansion_of') AND r.relation_type IN('requires_base','expansion_of')) OR r.relation_type=NEW.relation_type)) SELECT 1 FROM reach WHERE id=NEW.source_item_id);
END;
