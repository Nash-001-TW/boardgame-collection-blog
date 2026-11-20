-- Existing definitions have no creation token and no physical source record.
ALTER TABLE v2_component_definitions ADD COLUMN physical_creation_token TEXT;
ALTER TABLE v2_component_definitions ADD COLUMN physical_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_copy_components ADD COLUMN count_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_sleeve_requirements ADD COLUMN assignment_revision INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX idx_v2_physical_creation_token
ON v2_component_definitions(physical_creation_token) WHERE physical_creation_token IS NOT NULL;

CREATE TABLE v2_physical_component_sources (
    definition_id INTEGER PRIMARY KEY REFERENCES v2_component_definitions(id) ON DELETE RESTRICT,
    collection_item_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
    record_scope TEXT NOT NULL CHECK (record_scope IN ('production', 'test')),
    creation_token TEXT NOT NULL UNIQUE CHECK (length(creation_token) = 64),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
    signature TEXT NOT NULL CHECK (length(signature) = 64),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

CREATE TRIGGER v2_physical_source_validate
BEFORE INSERT ON v2_physical_component_sources
BEGIN
    SELECT RAISE(ABORT, 'PHYSICAL_SOURCE_MISMATCH') WHERE NOT EXISTS (
        SELECT 1 FROM v2_component_definitions d JOIN v2_collection_items c ON c.id = d.collection_item_id
        WHERE d.id = NEW.definition_id AND d.collection_item_id = NEW.collection_item_id
          AND c.record_scope = NEW.record_scope AND d.physical_creation_token = NEW.creation_token
          AND d.notes IS NULL AND d.physical_revision = 1
          AND NOT EXISTS (SELECT 1 FROM v2_legacy_id_map m
              WHERE m.target_table = 'v2_component_definitions' AND m.target_id = d.id)
    );
END;

CREATE TRIGGER v2_physical_source_no_update BEFORE UPDATE ON v2_physical_component_sources
BEGIN SELECT RAISE(ABORT, 'PHYSICAL_SOURCE_IMMUTABLE'); END;

CREATE TRIGGER v2_physical_source_no_delete BEFORE DELETE ON v2_physical_component_sources
BEGIN SELECT RAISE(ABORT, 'PHYSICAL_SOURCE_IMMUTABLE'); END;

CREATE TRIGGER v2_physical_definition_identity
BEFORE UPDATE OF id, collection_item_id, physical_creation_token, notes ON v2_component_definitions
WHEN NEW.physical_creation_token IS NOT OLD.physical_creation_token
  OR (OLD.physical_creation_token IS NOT NULL AND (
      NEW.id IS NOT OLD.id OR NEW.collection_item_id IS NOT OLD.collection_item_id OR NEW.notes IS NOT OLD.notes))
BEGIN SELECT RAISE(ABORT, 'PHYSICAL_DEFINITION_IDENTITY'); END;

CREATE TRIGGER v2_physical_definition_keep_identity
BEFORE DELETE ON v2_component_definitions WHEN OLD.physical_creation_token IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'PHYSICAL_DEFINITION_IDENTITY'); END;

CREATE TRIGGER v2_physical_definition_used_type
BEFORE UPDATE OF component_type, quantity_unit ON v2_component_definitions
WHEN OLD.physical_creation_token IS NOT NULL
 AND (NEW.component_type IS NOT OLD.component_type OR NEW.quantity_unit IS NOT OLD.quantity_unit)
 AND (EXISTS (SELECT 1 FROM v2_copy_components WHERE component_definition_id = OLD.id)
   OR EXISTS (SELECT 1 FROM v2_sleeve_requirements WHERE component_definition_id = OLD.id))
BEGIN SELECT RAISE(ABORT, 'PHYSICAL_TYPE_IN_USE'); END;

-- Structural eligibility is also checked at commit. The server independently verifies the signature.
CREATE VIEW v2_physical_component_candidates AS
SELECT d.id, d.collection_item_id, d.component_type, d.quantity_unit, d.physical_revision,
       c.record_scope, s.signature
FROM v2_component_definitions d
JOIN v2_collection_items c ON c.id = d.collection_item_id
JOIN v2_physical_component_sources s ON s.definition_id = d.id
    AND s.collection_item_id = d.collection_item_id AND s.creation_token = d.physical_creation_token
    AND s.record_scope = c.record_scope
LEFT JOIN v2_collection_management m ON m.collection_item_id = c.id
WHERE d.notes IS NULL AND m.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM v2_legacy_id_map
    WHERE target_table = 'v2_component_definitions' AND target_id = d.id
  );

-- Reject replacement attempts before a unique conflict policy can remove the old identity.
CREATE TRIGGER v2_physical_definition_no_replace
BEFORE INSERT ON v2_component_definitions
WHEN EXISTS (SELECT 1 FROM v2_component_definitions
    WHERE physical_creation_token IS NOT NULL
      AND (id = NEW.id OR physical_creation_token = NEW.physical_creation_token))
BEGIN SELECT RAISE(ABORT, 'PHYSICAL_DEFINITION_IDENTITY'); END;

CREATE TRIGGER v2_physical_source_no_replace
BEFORE INSERT ON v2_physical_component_sources
WHEN EXISTS (SELECT 1 FROM v2_physical_component_sources
    WHERE definition_id = NEW.definition_id OR creation_token = NEW.creation_token)
BEGIN SELECT RAISE(ABORT, 'PHYSICAL_SOURCE_IMMUTABLE'); END;
