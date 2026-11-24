-- MAJOR 03 candidate. The evidence envelope is transitional; the HTTP write route remains closed.
ALTER TABLE v2_component_definitions ADD COLUMN last_quantity_operation_id TEXT;

-- A collection ID cannot be reused, even after a permitted collection deletion.
CREATE TABLE d1_quantity_collection_generation (
    collection_id INTEGER NOT NULL PRIMARY KEY,
    generation INTEGER NOT NULL CHECK (typeof(generation) = 'integer' AND generation BETWEEN 1 AND 9223372036854775807)
) WITHOUT ROWID;

INSERT INTO d1_quantity_collection_generation(collection_id, generation)
SELECT id, 1 FROM v2_collection_items;

CREATE TRIGGER d1_generation_insert_guard BEFORE INSERT ON d1_quantity_collection_generation
WHEN NEW.generation IS NOT 1
  OR NOT EXISTS (SELECT 1 FROM v2_collection_items WHERE id = NEW.collection_id)
  OR EXISTS (SELECT 1 FROM d1_quantity_collection_generation WHERE collection_id = NEW.collection_id)
BEGIN SELECT RAISE(ABORT, 'D1_GENERATION_IDENTITY'); END;

CREATE TRIGGER d1_generation_update_guard BEFORE UPDATE ON d1_quantity_collection_generation
WHEN NEW.collection_id IS NOT OLD.collection_id OR OLD.generation = 9223372036854775807
  OR typeof(NEW.generation) <> 'integer' OR NEW.generation IS NOT OLD.generation + 1
BEGIN SELECT RAISE(ABORT, 'D1_GENERATION_NOT_MONOTONIC'); END;

CREATE TRIGGER d1_generation_no_delete BEFORE DELETE ON d1_quantity_collection_generation
BEGIN SELECT RAISE(ABORT, 'D1_GENERATION_IDENTITY'); END;

CREATE TRIGGER d1_generation_collection_insert AFTER INSERT ON v2_collection_items
BEGIN
    INSERT INTO d1_quantity_collection_generation(collection_id, generation) VALUES (NEW.id, 1);
END;

CREATE TRIGGER d1_generation_collection_key BEFORE UPDATE ON v2_collection_items
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT, 'D1_GENERATION_IDENTITY'); END;

-- Catch REPLACE before implicit deletion, including when recursive triggers are off.
CREATE TRIGGER d1_generation_collection_no_replace BEFORE INSERT ON v2_collection_items
WHEN EXISTS (SELECT 1 FROM d1_quantity_collection_generation WHERE collection_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'D1_GENERATION_IDENTITY'); END;

CREATE TRIGGER d1_generation_copy_no_replace BEFORE INSERT ON v2_owned_copies
WHEN EXISTS (SELECT 1 FROM v2_owned_copies WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'D1_COPY_IDENTITY'); END;

CREATE TRIGGER d1_generation_definition_no_replace BEFORE INSERT ON v2_component_definitions
WHEN EXISTS (SELECT 1 FROM v2_component_definitions WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'D1_DEFINITION_IDENTITY'); END;

CREATE TRIGGER d1_generation_archive_update BEFORE UPDATE ON v2_collection_management
WHEN OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT OLD.archived_at
BEGIN SELECT RAISE(ABORT, 'D1_ARCHIVE_IMMUTABLE'); END;

CREATE TRIGGER d1_generation_archive_delete BEFORE DELETE ON v2_collection_management
WHEN OLD.archived_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'D1_ARCHIVE_IMMUTABLE'); END;

CREATE TRIGGER d1_generation_management_insert BEFORE INSERT ON v2_collection_management
WHEN EXISTS (
    SELECT 1 FROM v2_collection_management m
    WHERE (m.request_key = NEW.request_key AND m.collection_item_id <> NEW.collection_item_id)
       OR (m.collection_item_id = NEW.collection_item_id AND m.archived_at IS NOT NULL
           AND m.archived_at IS NOT NEW.archived_at)
)
BEGIN SELECT RAISE(ABORT, 'D1_MANAGEMENT_IDENTITY'); END;

CREATE TRIGGER d1_generation_management_key BEFORE UPDATE ON v2_collection_management
WHEN NEW.collection_item_id IS NOT OLD.collection_item_id OR NEW.request_key IS NOT OLD.request_key
BEGIN SELECT RAISE(ABORT, 'D1_MANAGEMENT_IDENTITY'); END;

CREATE TRIGGER d1_generation_count_insert BEFORE INSERT ON v2_copy_components
WHEN NOT EXISTS (
    SELECT 1 FROM v2_owned_copies c JOIN v2_component_definitions d ON d.collection_item_id = c.collection_item_id
    WHERE c.id = NEW.owned_copy_id AND d.id = NEW.component_definition_id
) OR EXISTS (
    SELECT 1 FROM v2_copy_components x WHERE x.id = NEW.id
      AND (x.owned_copy_id IS NOT NEW.owned_copy_id OR x.component_definition_id IS NOT NEW.component_definition_id)
)
BEGIN SELECT RAISE(ABORT, 'D1_COUNT_IDENTITY'); END;

CREATE TRIGGER d1_generation_tag_insert BEFORE INSERT ON v2_copy_condition_tags
WHEN EXISTS (
    SELECT 1 FROM v2_copy_condition_tags t WHERE t.id = NEW.id
      AND (t.owned_copy_id IS NOT NEW.owned_copy_id OR t.condition_code IS NOT NEW.condition_code)
)
BEGIN SELECT RAISE(ABORT, 'D1_TAG_IDENTITY'); END;

CREATE TRIGGER d1_generation_v2_component_definitions_key BEFORE UPDATE ON v2_component_definitions
WHEN NEW.id IS NOT OLD.id OR NEW.collection_item_id IS NOT OLD.collection_item_id
BEGIN SELECT RAISE(ABORT, 'D1_RELATED_IDENTITY'); END;

CREATE TRIGGER d1_generation_v2_owned_copies_key BEFORE UPDATE ON v2_owned_copies
WHEN NEW.id IS NOT OLD.id OR NEW.collection_item_id IS NOT OLD.collection_item_id
BEGIN SELECT RAISE(ABORT, 'D1_RELATED_IDENTITY'); END;

CREATE TRIGGER d1_generation_v2_copy_components_key BEFORE UPDATE ON v2_copy_components
WHEN NEW.id IS NOT OLD.id OR NEW.owned_copy_id IS NOT OLD.owned_copy_id OR NEW.component_definition_id IS NOT OLD.component_definition_id
BEGIN SELECT RAISE(ABORT, 'D1_RELATED_IDENTITY'); END;

CREATE TRIGGER d1_generation_v2_copy_condition_tags_key BEFORE UPDATE ON v2_copy_condition_tags
WHEN NEW.id IS NOT OLD.id OR NEW.owned_copy_id IS NOT OLD.owned_copy_id OR NEW.condition_code IS NOT OLD.condition_code
BEGIN SELECT RAISE(ABORT, 'D1_RELATED_IDENTITY'); END;

CREATE TRIGGER d1_generation_v2_collection_items_update AFTER UPDATE ON v2_collection_items
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_collection_items_delete AFTER DELETE ON v2_collection_items
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = OLD.id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_collection_management_insert AFTER INSERT ON v2_collection_management
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_collection_management_update AFTER UPDATE ON v2_collection_management
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_collection_management_delete AFTER DELETE ON v2_collection_management
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = OLD.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_owned_copies_insert AFTER INSERT ON v2_owned_copies
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_owned_copies_update AFTER UPDATE ON v2_owned_copies
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_owned_copies_delete AFTER DELETE ON v2_owned_copies
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = OLD.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_component_definitions_insert AFTER INSERT ON v2_component_definitions
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_component_definitions_update AFTER UPDATE ON v2_component_definitions
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_component_definitions_delete AFTER DELETE ON v2_component_definitions
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = OLD.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_physical_component_sources_insert AFTER INSERT ON v2_physical_component_sources
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_physical_component_sources_update AFTER UPDATE ON v2_physical_component_sources
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_physical_component_sources_delete AFTER DELETE ON v2_physical_component_sources
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = OLD.collection_item_id;
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_copy_components_insert AFTER INSERT ON v2_copy_components
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT collection_item_id FROM v2_component_definitions WHERE id = NEW.component_definition_id);
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_copy_components_update AFTER UPDATE ON v2_copy_components
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT collection_item_id FROM v2_component_definitions WHERE id = NEW.component_definition_id);
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_copy_components_delete AFTER DELETE ON v2_copy_components
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT collection_item_id FROM v2_component_definitions WHERE id = OLD.component_definition_id);
    -- Parent DELETE covers cascades where the parent is no longer visible.
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1 AND (SELECT collection_item_id FROM v2_component_definitions WHERE id = OLD.component_definition_id) IS NOT NULL;
END;

CREATE TRIGGER d1_generation_v2_copy_condition_tags_insert AFTER INSERT ON v2_copy_condition_tags
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT collection_item_id FROM v2_owned_copies WHERE id = NEW.owned_copy_id);
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_copy_condition_tags_update AFTER UPDATE ON v2_copy_condition_tags
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT collection_item_id FROM v2_owned_copies WHERE id = NEW.owned_copy_id);
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1;
END;

CREATE TRIGGER d1_generation_v2_copy_condition_tags_delete AFTER DELETE ON v2_copy_condition_tags
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT collection_item_id FROM v2_owned_copies WHERE id = OLD.owned_copy_id);
    -- Parent DELETE covers cascades where the parent is no longer visible.
    SELECT RAISE(ABORT, 'D1_GENERATION_MISSING') WHERE changes() <> 1 AND (SELECT collection_item_id FROM v2_owned_copies WHERE id = OLD.owned_copy_id) IS NOT NULL;
END;


-- Legacy provenance can invalidate structural eligibility, even if later restored.
CREATE TRIGGER d1_generation_legacy_map_conflict BEFORE INSERT ON v2_legacy_id_map
WHEN EXISTS (SELECT 1 FROM v2_legacy_id_map m WHERE m.id = NEW.id
    AND (m.legacy_table IS NOT NEW.legacy_table OR m.legacy_id IS NOT NEW.legacy_id
        OR m.target_table IS NOT NEW.target_table OR m.target_id IS NOT NEW.target_id))
BEGIN SELECT RAISE(ABORT, 'D1_LEGACY_MAP_IDENTITY'); END;

CREATE TRIGGER d1_generation_legacy_map_key BEFORE UPDATE ON v2_legacy_id_map
WHEN NEW.id IS NOT OLD.id OR NEW.target_table IS NOT OLD.target_table OR NEW.target_id IS NOT OLD.target_id
BEGIN SELECT RAISE(ABORT, 'D1_LEGACY_MAP_IDENTITY'); END;

CREATE TRIGGER d1_generation_legacy_map_insert AFTER INSERT ON v2_legacy_id_map
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT d.collection_item_id FROM v2_component_definitions d
        WHERE NEW.target_table = 'v2_component_definitions' AND d.id = NEW.target_id);
END;

CREATE TRIGGER d1_generation_legacy_map_update AFTER UPDATE ON v2_legacy_id_map
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT d.collection_item_id FROM v2_component_definitions d
        WHERE NEW.target_table = 'v2_component_definitions' AND d.id = NEW.target_id);
END;

CREATE TRIGGER d1_generation_legacy_map_delete AFTER DELETE ON v2_legacy_id_map
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = (SELECT d.collection_item_id FROM v2_component_definitions d
        WHERE OLD.target_table = 'v2_component_definitions' AND d.id = OLD.target_id);
END;

CREATE TABLE d1_quantity_changes (
    operation_id TEXT PRIMARY KEY CHECK (
        length(operation_id) = 100 AND substr(operation_id, 1, 3) = 'q1.'
        AND substr(operation_id, 4, 32) NOT GLOB '*[^0-9a-f]*'
        AND substr(operation_id, 36, 1) = '.' AND substr(operation_id, 37) = digest
    ),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
    definition_id INTEGER NOT NULL REFERENCES v2_component_definitions(id),
    collection_id INTEGER NOT NULL REFERENCES v2_collection_items(id),
    record_scope TEXT NOT NULL CHECK (record_scope IN ('production', 'test')),
    source_signature TEXT NOT NULL CHECK (length(source_signature) = 64),
    before_revision INTEGER NOT NULL CHECK (before_revision >= 1),
    before_quantity INTEGER CHECK (before_quantity IS NULL OR (typeof(before_quantity) = 'integer' AND before_quantity BETWEEN 0 AND 100000)),
    after_quantity INTEGER CHECK (after_quantity IS NULL OR (typeof(after_quantity) = 'integer' AND after_quantity BETWEEN 0 AND 100000)),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    component_type TEXT NOT NULL,
    unit TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
    evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json)
        AND json_extract(evidence_json, '$.version') = 1
        AND json_type(evidence_json, '$.items') = 'array'
        AND json_array_length(evidence_json, '$.items') <= 200
        AND length(CAST(evidence_json AS BLOB)) <= 262144
    ),
    before_generation INTEGER NOT NULL CHECK (typeof(before_generation) = 'integer' AND before_generation >= 1),
    after_revision INTEGER NOT NULL CHECK (after_revision = before_revision + 1),
    committed_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (typeof(committed_at) = 'integer'),
    UNIQUE (definition_id, after_revision),
    CHECK (before_quantity IS NOT after_quantity)
) WITHOUT ROWID;

-- Transitional evidence only. This is not the R5/R12 feature contract.
CREATE VIEW d1_quantity_copy_evidence AS
SELECT d.id AS definition_id, c.id AS copy_id,
       COALESCE(length(CAST(c.edition AS BLOB)), 0)
         + COALESCE(length(CAST(c.language_code AS BLOB)), 0)
         + COALESCE(length(CAST(cc.last_checked_at AS BLOB)), 0) AS raw_bytes,
       CASE WHEN COALESCE(length(CAST(c.edition AS BLOB)), 0)
                   + COALESCE(length(CAST(c.language_code AS BLOB)), 0)
                   + COALESCE(length(CAST(cc.last_checked_at AS BLOB)), 0) <= 262144
       THEN json_object(
         'copyId', c.id, 'definitionId', d.id, 'edition', c.edition,
         'language', c.language_code, 'seal', c.seal_status, 'inventory', c.inventory_status,
         'countId', cc.id, 'countRevision', cc.count_revision,
         'actual', cc.actual_quantity, 'inspection', cc.inspection_status,
         'lastSavedAt', cc.last_checked_at,
         'countDate', NULL, 'completionConfirmedAt', 'UNKNOWN',
         'boxCompletion', 'UNKNOWN',
         'evidenceStatus', CASE
           WHEN cc.id IS NULL OR cc.actual_quantity IS NULL THEN 'UNKNOWN'
           WHEN cc.inspection_status <> 'checked' THEN 'UNCONFIRMED'
           ELSE 'OBSERVED_CURRENT_COUNT' END
       ) END AS item
FROM v2_component_definitions d
JOIN v2_owned_copies c ON c.collection_item_id = d.collection_item_id
LEFT JOIN v2_copy_components cc ON cc.owned_copy_id = c.id AND cc.component_definition_id = d.id
WHERE c.inventory_status IN ('in_collection', 'loaned');

CREATE VIEW d1_quantity_admission AS
SELECT p.*, (
    (SELECT COUNT(*) FROM v2_component_definitions) +
    (SELECT COUNT(*) FROM collection_components) +
    (SELECT COUNT(*) FROM collection_items) +
    (SELECT COUNT(*) FROM v2_collection_items) +
    (SELECT COUNT(*) FROM v2_legacy_id_map
      WHERE (legacy_table = 'collection_components' AND target_table = 'v2_component_definitions')
         OR (legacy_table = 'collection_items' AND target_table = 'v2_collection_items'))
) AS classification_rows,
CASE WHEN (
  -- Check a lower bound first so even many oversized legacy strings are never
  -- JSON-escaped into a large intermediate array.
  SELECT COUNT(*) <= 200 AND COALESCE(SUM(raw_bytes), 0) <= 262144
  FROM (SELECT raw_bytes FROM d1_quantity_copy_evidence e
        WHERE e.definition_id = p.id ORDER BY e.copy_id LIMIT 201)
) THEN (
  WITH bounded_items AS MATERIALIZED (
    SELECT copy_id, item FROM d1_quantity_copy_evidence e
    WHERE e.definition_id = p.id ORDER BY e.copy_id LIMIT 201
  )
  SELECT CASE
    WHEN COUNT(*) > 200 OR COUNT(item) <> COUNT(*)
      OR 2 + MAX(COUNT(*) - 1, 0) + COALESCE(SUM(length(CAST(item AS BLOB))), 0) > 262144
    THEN NULL
    ELSE (SELECT json_group_array(json(item))
          FROM (SELECT item FROM bounded_items ORDER BY copy_id))
  END FROM bounded_items
) END AS evidence_items
FROM v2_physical_component_candidates p;

CREATE TRIGGER d1_quantity_definition_no_initial_marker
BEFORE INSERT ON v2_component_definitions
WHEN NEW.last_quantity_operation_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'D1_INITIAL_MARKER_FORBIDDEN'); END;

CREATE TRIGGER d1_quantity_definition_guard
BEFORE UPDATE OF expected_quantity, physical_revision, last_quantity_operation_id ON v2_component_definitions
BEGIN
    SELECT RAISE(ABORT, 'D1_REVISION_REGRESSION') WHERE NEW.physical_revision < OLD.physical_revision;
    SELECT RAISE(ABORT, 'D1_MARKER_WITHOUT_CHANGE')
      WHERE NEW.expected_quantity IS OLD.expected_quantity
        AND NEW.last_quantity_operation_id IS NOT OLD.last_quantity_operation_id;
    SELECT RAISE(ABORT, 'D1_CURRENT_OPERATION_REQUIRED')
      WHERE NEW.expected_quantity IS NOT OLD.expected_quantity AND (
        NEW.last_quantity_operation_id IS OLD.last_quantity_operation_id OR NOT EXISTS (
          SELECT 1 FROM d1_quantity_changes h
          JOIN d1_quantity_collection_generation g ON g.collection_id = h.collection_id
          WHERE h.operation_id = NEW.last_quantity_operation_id AND h.definition_id = OLD.id
            AND g.generation = h.before_generation AND h.collection_id = OLD.collection_item_id AND h.before_revision = OLD.physical_revision
            AND h.after_revision = NEW.physical_revision AND NEW.physical_revision = OLD.physical_revision + 1
            AND h.before_quantity IS OLD.expected_quantity AND h.after_quantity IS NEW.expected_quantity
            AND h.name = NEW.component_name AND h.component_type = NEW.component_type AND h.unit = NEW.quantity_unit
        )
      );
END;


CREATE TRIGGER d1_quantity_change_no_update BEFORE UPDATE ON d1_quantity_changes
BEGIN SELECT RAISE(ABORT, 'D1_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER d1_quantity_change_no_delete BEFORE DELETE ON d1_quantity_changes
BEGIN SELECT RAISE(ABORT, 'D1_HISTORY_IMMUTABLE'); END;

CREATE TRIGGER d1_quantity_change_admission BEFORE INSERT ON d1_quantity_changes
BEGIN
    SELECT RAISE(ABORT, 'D1_HISTORY_EXISTS') WHERE EXISTS (
        SELECT 1 FROM d1_quantity_changes h WHERE h.operation_id = NEW.operation_id
        OR (h.definition_id = NEW.definition_id AND h.after_revision = NEW.after_revision)
    );
    SELECT RAISE(ABORT, 'D1_QUANTITY_STATE_CHANGED') WHERE NOT EXISTS (
        SELECT 1 FROM d1_quantity_admission p
        JOIN v2_component_definitions d ON d.id = p.id
        JOIN d1_quantity_collection_generation g ON g.collection_id = p.collection_item_id
        WHERE p.id = NEW.definition_id AND p.collection_item_id = NEW.collection_id
          AND p.record_scope = NEW.record_scope AND p.signature = NEW.source_signature
          AND p.classification_rows <= 10000 AND g.generation = NEW.before_generation
          AND p.physical_revision = NEW.before_revision AND d.expected_quantity IS NEW.before_quantity
          AND p.evidence_items IS NOT NULL
          AND NEW.evidence_json = json_object('version', 1, 'rule', 'expected-minus-checked-v1',
              'oldExpected', NEW.before_quantity, 'newExpected', NEW.after_quantity, 'items', json(p.evidence_items))
    );
END;

-- The history row is also the success receipt. An aborted update aborts the INSERT.
CREATE TRIGGER d1_quantity_apply AFTER INSERT ON d1_quantity_changes
BEGIN
    UPDATE v2_component_definitions
       SET expected_quantity = NEW.after_quantity, physical_revision = NEW.after_revision,
           last_quantity_operation_id = NEW.operation_id, updated_at = datetime(NEW.committed_at, 'unixepoch'),
           component_name = NEW.name, component_type = NEW.component_type, quantity_unit = NEW.unit
     WHERE id = NEW.definition_id AND physical_revision = NEW.before_revision
       AND expected_quantity IS NEW.before_quantity;
    SELECT RAISE(ABORT, 'D1_EXPECTED_ONE_DEFINITION_UPDATE') WHERE changes() <> 1;
END;

CREATE VIEW d1_quantity_history AS SELECT * FROM d1_quantity_changes;

CREATE TABLE d1_quantity_epoch (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    epoch TEXT NOT NULL CHECK (length(epoch) = 32 AND epoch NOT GLOB '*[^0-9a-f]*')
);

INSERT INTO d1_quantity_epoch(id, epoch) VALUES (1, lower(hex(randomblob(16))));

CREATE TRIGGER d1_quantity_epoch_no_replace BEFORE INSERT ON d1_quantity_epoch
WHEN EXISTS (SELECT 1 FROM d1_quantity_epoch WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'D1_EPOCH_IMMUTABLE'); END;

CREATE TRIGGER d1_quantity_epoch_no_update BEFORE UPDATE ON d1_quantity_epoch
BEGIN SELECT RAISE(ABORT, 'D1_EPOCH_IMMUTABLE'); END;

CREATE TRIGGER d1_quantity_epoch_no_delete BEFORE DELETE ON d1_quantity_epoch
BEGIN SELECT RAISE(ABORT, 'D1_EPOCH_IMMUTABLE'); END;
