-- Migration 0014: NotBGG storage and immutable source identities.
-- D2 validation is LOCAL ISOLATED D1 ONLY; never automatically run against production.
-- No existing tables/data are rewritten. Requires v2_games from 0007.
-- Format public IDs as NotBGG: + decimal seq padded to MINIMUM width 6.
-- App numeric boundary matches Number.MAX_SAFE_INTEGER, not SQLite's larger 64-bit limit.
CREATE TABLE notbgg_ids (
  seq INTEGER PRIMARY KEY AUTOINCREMENT CHECK (seq BETWEEN 1 AND 9007199254740991),
  request_key TEXT NOT NULL UNIQUE CHECK (length(trim(request_key)) > 0),
  request_hash TEXT NOT NULL CHECK (length(trim(request_hash)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Permanent reservations: an unused reservation is retained even after creation fails.
CREATE TABLE notbgg_games (
  seq INTEGER PRIMARY KEY REFERENCES notbgg_ids(seq) ON DELETE RESTRICT,
  game_id INTEGER NOT NULL UNIQUE REFERENCES v2_games(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'notbgg' CHECK (source = 'notbgg'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  type TEXT NOT NULL CHECK (type IN ('boardgame','boardgameexpansion','boardgameaccessory')),
  description TEXT CHECK (description IS NULL OR length(description) <= 50000),
  year_published INTEGER CHECK (year_published IS NULL OR (typeof(year_published)='integer' AND year_published BETWEEN 1 AND 9999)),
  min_age INTEGER CHECK (min_age IS NULL OR (typeof(min_age)='integer' AND min_age BETWEEN 0 AND 200)),
  min_players INTEGER CHECK (min_players IS NULL OR (typeof(min_players)='integer' AND min_players BETWEEN 1 AND 1000)),
  max_players INTEGER CHECK (max_players IS NULL OR (typeof(max_players)='integer' AND max_players BETWEEN 1 AND 1000)),
  min_playtime INTEGER CHECK (min_playtime IS NULL OR (typeof(min_playtime)='integer' AND min_playtime BETWEEN 1 AND 100000)),
  max_playtime INTEGER CHECK (max_playtime IS NULL OR (typeof(max_playtime)='integer' AND max_playtime BETWEEN 1 AND 100000)),
  recommended_players_json TEXT CHECK (recommended_players_json IS NULL OR (json_valid(recommended_players_json) AND json_type(recommended_players_json)='array')),
  alternate_names_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alternate_names_json) AND json_type(alternate_names_json)='array'),
  designers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(designers_json) AND json_type(designers_json)='array'),
  artists_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artists_json) AND json_type(artists_json)='array'),
  publishers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(publishers_json) AND json_type(publishers_json)='array'),
  categories_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories_json) AND json_type(categories_json)='array'),
  mechanics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mechanics_json) AND json_type(mechanics_json)='array'),
  families_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(families_json) AND json_type(families_json)='array'),
  reference_urls_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reference_urls_json) AND json_type(reference_urls_json)='array'),
  image_url TEXT CHECK (image_url IS NULL OR length(image_url)<=2048),
  thumbnail_url TEXT CHECK (thumbnail_url IS NULL OR length(thumbnail_url)<=2048),
  editor_notes TEXT CHECK (editor_notes IS NULL OR length(editor_notes)<=10000),
  contents TEXT CHECK (contents IS NULL OR length(contents)<=20000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision)='integer' AND revision>0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  CHECK (min_players IS NULL OR max_players IS NULL OR min_players<=max_players),
  CHECK (min_playtime IS NULL OR max_playtime IS NULL OR min_playtime<=max_playtime),
  CHECK (type<>'boardgameaccessory' OR (min_players IS NULL AND max_players IS NULL AND min_playtime IS NULL AND max_playtime IS NULL AND recommended_players_json IS NULL)),
  CHECK (type='boardgameaccessory' OR contents IS NULL),
  -- Deferred only until the end of the D1 atomic batch: a committed profile must
  -- reference a real current revision, including revision 1 at creation.
  FOREIGN KEY (seq,revision) REFERENCES notbgg_game_revisions(seq,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_notbgg_games_type ON notbgg_games(type, archived_at);
CREATE INDEX idx_notbgg_games_name ON notbgg_games(name);
CREATE TABLE notbgg_game_revisions (
  seq INTEGER NOT NULL REFERENCES notbgg_games(seq) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision>0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
  actor TEXT NOT NULL CHECK (length(trim(actor))>0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (seq, revision)
);
CREATE TABLE notbgg_accessory_categories (
  seq INTEGER NOT NULL REFERENCES notbgg_games(seq) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('upgrade','playmat','storage','promo','sleeves','miniatures','tokens','other')),
  PRIMARY KEY (seq, category)
);
-- Original source/target identities stay stable even when a BGG mapping is activated/revoked.
CREATE TABLE site_game_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_game_id INTEGER NOT NULL REFERENCES notbgg_games(game_id) ON DELETE RESTRICT,
  target_game_id INTEGER NOT NULL REFERENCES v2_games(id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL DEFAULT 'accessory_for' CHECK (relation_type='accessory_for'),
  relation_source TEXT NOT NULL DEFAULT 'manual' CHECK (relation_source='manual'),
  notes TEXT,
  created_by TEXT NOT NULL CHECK (length(trim(created_by))>0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  CHECK (source_game_id<>target_game_id)
);
CREATE UNIQUE INDEX idx_site_relations_active ON site_game_relations(source_game_id,target_game_id,relation_type) WHERE archived_at IS NULL;
CREATE INDEX idx_site_relations_target ON site_game_relations(target_game_id,archived_at);
CREATE TABLE notbgg_bgg_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL REFERENCES notbgg_games(seq) ON DELETE RESTRICT,
  candidate_bgg_id INTEGER NOT NULL CHECK (typeof(candidate_bgg_id)='integer' AND candidate_bgg_id BETWEEN 1 AND 9007199254740991),
  bgg_game_id INTEGER REFERENCES v2_games(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','linked','revoked')),
  primary_source TEXT NOT NULL DEFAULT 'notbgg' CHECK (primary_source IN ('notbgg','bgg')),
  created_by TEXT NOT NULL CHECK (length(trim(created_by))>0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_by TEXT,
  linked_at TEXT,
  revoked_by TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  CHECK (status<>'linked' OR (bgg_game_id IS NOT NULL AND confirmed_by IS NOT NULL AND linked_at IS NOT NULL AND revoked_at IS NULL)),
  CHECK (status<>'pending' OR (primary_source='notbgg' AND linked_at IS NULL AND revoked_at IS NULL)),
  CHECK (status<>'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL AND length(trim(revoke_reason))>0)),
  CHECK (primary_source<>'bgg' OR linked_at IS NOT NULL)
);
-- Active one-to-one; a pending proposal does not claim the BGG identity.
CREATE UNIQUE INDEX idx_notbgg_link_active_source ON notbgg_bgg_links(seq) WHERE status='linked';
CREATE UNIQUE INDEX idx_notbgg_link_active_bgg ON notbgg_bgg_links(candidate_bgg_id) WHERE status='linked';
CREATE UNIQUE INDEX idx_notbgg_link_live_source ON notbgg_bgg_links(seq) WHERE status IN ('pending','linked');
CREATE INDEX idx_notbgg_link_history ON notbgg_bgg_links(seq,created_at);
CREATE TABLE notbgg_link_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES notbgg_bgg_links(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('proposed','confirmed','primary_source_changed','revoked')),
  actor TEXT NOT NULL CHECK (length(trim(actor))>0),
  reason TEXT,
  state_json TEXT NOT NULL CHECK (json_valid(state_json) AND json_type(state_json)='object'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notbgg_link_events_history ON notbgg_link_events(link_id,id);
CREATE TRIGGER notbgg_ids_no_update BEFORE UPDATE ON notbgg_ids
BEGIN SELECT RAISE(ABORT,'Permanent identity/history is immutable'); END;
CREATE TRIGGER notbgg_ids_no_delete BEFORE DELETE ON notbgg_ids
BEGIN SELECT RAISE(ABORT,'Permanent identity/history is immutable'); END;
CREATE TRIGGER notbgg_game_revisions_no_update BEFORE UPDATE ON notbgg_game_revisions
BEGIN SELECT RAISE(ABORT,'Permanent identity/history is immutable'); END;
CREATE TRIGGER notbgg_game_revisions_no_delete BEFORE DELETE ON notbgg_game_revisions
BEGIN SELECT RAISE(ABORT,'Permanent identity/history is immutable'); END;
CREATE TRIGGER notbgg_link_events_no_update BEFORE UPDATE ON notbgg_link_events
BEGIN SELECT RAISE(ABORT,'Permanent identity/history is immutable'); END;
CREATE TRIGGER notbgg_link_events_no_delete BEFORE DELETE ON notbgg_link_events
BEGIN SELECT RAISE(ABORT,'Permanent identity/history is immutable'); END;
CREATE TRIGGER notbgg_games_no_delete BEFORE DELETE ON notbgg_games
BEGIN SELECT RAISE(ABORT,'Archive/revoke instead of deleting'); END;
CREATE TRIGGER site_game_relations_no_delete BEFORE DELETE ON site_game_relations
BEGIN SELECT RAISE(ABORT,'Archive/revoke instead of deleting'); END;
CREATE TRIGGER notbgg_bgg_links_no_delete BEFORE DELETE ON notbgg_bgg_links
BEGIN SELECT RAISE(ABORT,'Archive/revoke instead of deleting'); END;
CREATE TRIGGER notbgg_games_identity_immutable BEFORE UPDATE ON notbgg_games
WHEN NEW.seq<>OLD.seq OR NEW.game_id<>OLD.game_id OR NEW.source<>OLD.source OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'Original source identity is immutable'); END;
CREATE TRIGGER notbgg_games_revision_step BEFORE UPDATE ON notbgg_games
WHEN NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'Expected next revision'); END;
CREATE TRIGGER notbgg_games_manual_identity BEFORE INSERT ON notbgg_games
WHEN NOT EXISTS (SELECT 1 FROM v2_games WHERE id=NEW.game_id AND bgg_id IS NULL AND catalog_source='manual')
BEGIN SELECT RAISE(ABORT,'NotBGG requires a distinct manual v2 identity'); END;
CREATE TRIGGER notbgg_games_first_revision BEFORE INSERT ON notbgg_games
WHEN NEW.revision<>1
BEGIN SELECT RAISE(ABORT,'NotBGG must start at revision 1'); END;
CREATE TRIGGER notbgg_v2_identity_immutable BEFORE UPDATE OF bgg_id ON v2_games
WHEN NEW.bgg_id IS NOT OLD.bgg_id AND
 (EXISTS (SELECT 1 FROM notbgg_games WHERE game_id=OLD.id) OR EXISTS (SELECT 1 FROM notbgg_bgg_links WHERE bgg_game_id=OLD.id) OR EXISTS (SELECT 1 FROM site_game_relations WHERE target_game_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'Referenced source identity cannot be relabelled'); END;
CREATE TRIGGER notbgg_v2_source_immutable BEFORE UPDATE OF catalog_source ON v2_games
WHEN NEW.catalog_source<>OLD.catalog_source AND EXISTS (SELECT 1 FROM notbgg_games WHERE game_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'NotBGG original provenance cannot change'); END;
CREATE TRIGGER notbgg_category_insert BEFORE INSERT ON notbgg_accessory_categories
WHEN NOT EXISTS (SELECT 1 FROM notbgg_games WHERE seq=NEW.seq AND type='boardgameaccessory')
BEGIN SELECT RAISE(ABORT,'Category requires accessory'); END;
CREATE TRIGGER notbgg_category_update BEFORE UPDATE ON notbgg_accessory_categories
WHEN NOT EXISTS (SELECT 1 FROM notbgg_games WHERE seq=NEW.seq AND type='boardgameaccessory')
BEGIN SELECT RAISE(ABORT,'Category requires accessory'); END;
CREATE TRIGGER notbgg_type_change BEFORE UPDATE OF type ON notbgg_games
WHEN NEW.type<>'boardgameaccessory' AND
 (EXISTS (SELECT 1 FROM notbgg_accessory_categories WHERE seq=OLD.seq) OR EXISTS (SELECT 1 FROM site_game_relations WHERE source_game_id=OLD.game_id AND archived_at IS NULL))
BEGIN SELECT RAISE(ABORT,'Clear accessory categories/archive relations before changing type'); END;
CREATE TRIGGER site_relation_insert BEFORE INSERT ON site_game_relations
WHEN NOT EXISTS (SELECT 1 FROM notbgg_games WHERE game_id=NEW.source_game_id AND type='boardgameaccessory') OR
 NOT EXISTS (SELECT 1 FROM v2_games g WHERE g.id=NEW.target_game_id AND (g.bgg_id IS NOT NULL OR EXISTS (SELECT 1 FROM notbgg_games n WHERE n.game_id=g.id)))
BEGIN SELECT RAISE(ABORT,'Relation requires a NotBGG accessory and a registered target identity'); END;
CREATE TRIGGER notbgg_link_target_insert BEFORE INSERT ON notbgg_bgg_links
WHEN NEW.bgg_game_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM v2_games WHERE id=NEW.bgg_game_id AND bgg_id=NEW.candidate_bgg_id)
BEGIN SELECT RAISE(ABORT,'BGG target does not match candidate'); END;
CREATE TRIGGER site_relation_update BEFORE UPDATE ON site_game_relations
WHEN NOT EXISTS (SELECT 1 FROM notbgg_games WHERE game_id=NEW.source_game_id AND type='boardgameaccessory') OR
 NOT EXISTS (SELECT 1 FROM v2_games g WHERE g.id=NEW.target_game_id AND (g.bgg_id IS NOT NULL OR EXISTS (SELECT 1 FROM notbgg_games n WHERE n.game_id=g.id)))
BEGIN SELECT RAISE(ABORT,'Relation requires a NotBGG accessory and a registered target identity'); END;
CREATE TRIGGER notbgg_link_target_update BEFORE UPDATE ON notbgg_bgg_links
WHEN NEW.bgg_game_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM v2_games WHERE id=NEW.bgg_game_id AND bgg_id=NEW.candidate_bgg_id)
BEGIN SELECT RAISE(ABORT,'BGG target does not match candidate'); END;
CREATE TRIGGER site_relation_identity_immutable BEFORE UPDATE ON site_game_relations
WHEN NEW.id<>OLD.id OR NEW.source_game_id<>OLD.source_game_id OR NEW.target_game_id<>OLD.target_game_id OR NEW.relation_type<>OLD.relation_type OR NEW.notes IS NOT OLD.notes OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR (OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT OLD.archived_at)
BEGIN SELECT RAISE(ABORT,'Preserve original relation; create a new record'); END;
CREATE TRIGGER notbgg_link_identity_immutable BEFORE UPDATE ON notbgg_bgg_links
WHEN NEW.id<>OLD.id OR NEW.seq<>OLD.seq OR NEW.candidate_bgg_id<>OLD.candidate_bgg_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR
 (OLD.bgg_game_id IS NOT NULL AND NEW.bgg_game_id IS NOT OLD.bgg_game_id) OR
 (OLD.status='linked' AND NEW.status='pending') OR OLD.status='revoked' OR
 (OLD.linked_at IS NOT NULL AND (NEW.linked_at IS NOT OLD.linked_at OR NEW.confirmed_by IS NOT OLD.confirmed_by))
BEGIN SELECT RAISE(ABORT,'Preserve original mapping/history; create a new proposal'); END;
-- D2 repository must atomically append revisions/events with each state change.
-- JSON element types, URL protocols, list limits, revision preconditions, explicit admin
-- primary-source confirmation and source/target archive eligibility remain service validations.
-- Repository writes use D1 batch(), not explicit BEGIN/COMMIT.

-- The revision INSERT is the first statement of an edit/archive batch: a database-side
-- compare-and-swap gate BEFORE any child rows are changed. No zero-row success.
CREATE TRIGGER notbgg_revision_precondition BEFORE INSERT ON notbgg_game_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM notbgg_games g WHERE g.seq=NEW.seq AND g.archived_at IS NULL
  AND NEW.revision=CASE WHEN EXISTS (SELECT 1 FROM notbgg_game_revisions r WHERE r.seq=g.seq)
                       THEN g.revision+1 ELSE g.revision END
)
BEGIN SELECT RAISE(ABORT,'NOTBGG_REVISION_CONFLICT'); END;
CREATE TRIGGER notbgg_profile_requires_revision BEFORE UPDATE ON notbgg_games
WHEN NOT EXISTS (SELECT 1 FROM notbgg_game_revisions WHERE seq=NEW.seq AND revision=NEW.revision)
BEGIN SELECT RAISE(ABORT,'NOTBGG_MISSING_REVISION'); END;
