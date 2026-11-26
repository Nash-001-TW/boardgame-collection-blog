CREATE TABLE v2_component_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL REFERENCES v2_component_definitions(id) ON DELETE CASCADE,
  language_code TEXT CHECK (language_code IS NULL),
  object_key TEXT NOT NULL UNIQUE,
  thumb_key TEXT NOT NULL UNIQUE CHECK (thumb_key <> object_key),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/webp','image/jpeg')),
  width INTEGER NOT NULL CHECK (typeof(width)='integer' AND width BETWEEN 1 AND 1600),
  height INTEGER NOT NULL CHECK (typeof(height)='integer' AND height BETWEEN 1 AND 1600),
  byte_size INTEGER NOT NULL CHECK (typeof(byte_size)='integer' AND byte_size BETWEEN 1 AND 1048576),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision)='integer' AND revision >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_v2_component_photo_language
  ON v2_component_photos(definition_id, COALESCE(language_code,''));

-- TODO: process queued keys with a retryable local/operational cleanup tool.
CREATE TABLE v2_component_photo_orphans (
  object_key TEXT PRIMARY KEY NOT NULL,
  queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER v2_component_photo_queue_delete AFTER DELETE ON v2_component_photos
BEGIN
  INSERT OR IGNORE INTO v2_component_photo_orphans(object_key) VALUES (OLD.object_key), (OLD.thumb_key);
END;
CREATE TRIGGER v2_component_photo_queue_replacement AFTER UPDATE OF object_key, thumb_key ON v2_component_photos
BEGIN
  INSERT OR IGNORE INTO v2_component_photo_orphans(object_key)
    SELECT OLD.object_key WHERE OLD.object_key <> NEW.object_key;
  INSERT OR IGNORE INTO v2_component_photo_orphans(object_key)
    SELECT OLD.thumb_key WHERE OLD.thumb_key <> NEW.thumb_key;
END;

-- Receipts survive deletion so retries cannot recreate a removed photo.
CREATE TABLE v2_component_photo_commands (
  actor TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  attempt TEXT NOT NULL,
  PRIMARY KEY (actor, operation_id)
);
