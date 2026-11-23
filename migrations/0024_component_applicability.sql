-- Current applicability is derived from the latest immutable event for a pair.
-- Coverage rows are non-authoritative markers. A verified source is deferred to batch 2.
CREATE TABLE v2_component_applicability_coverage (
    collection_id INTEGER PRIMARY KEY REFERENCES v2_collection_items(id) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE v2_component_applicability_events (
    copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
    definition_id INTEGER NOT NULL REFERENCES v2_component_definitions(id) ON DELETE RESTRICT,
    collection_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 1),
    before_not_applicable INTEGER NOT NULL CHECK (before_not_applicable IN (0, 1)),
    after_not_applicable INTEGER NOT NULL CHECK (after_not_applicable IN (0, 1)),
    actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
    origin TEXT NOT NULL CHECK (origin IN ('initial', 'change')),
    before_generation INTEGER NOT NULL CHECK (typeof(before_generation) = 'integer' AND before_generation >= 1),
    occurred_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (typeof(occurred_at) = 'integer'),
    PRIMARY KEY (copy_id, definition_id, revision),
    CHECK (before_not_applicable <> after_not_applicable),
    CHECK (origin <> 'initial' OR (revision = 1 AND after_not_applicable = 1))
) WITHOUT ROWID;

CREATE INDEX idx_v2_component_applicability_events_definition
ON v2_component_applicability_events(definition_id, copy_id, revision);

CREATE INDEX idx_v2_component_applicability_events_collection
ON v2_component_applicability_events(collection_id);

CREATE VIEW v2_component_applicability_current AS
SELECT e.collection_id, e.copy_id, e.definition_id, e.revision,
       e.after_not_applicable AS not_applicable
FROM v2_component_applicability_events e
WHERE e.revision = (
    SELECT MAX(revision) FROM v2_component_applicability_events
    WHERE copy_id = e.copy_id AND definition_id = e.definition_id
);

CREATE TRIGGER v2_component_applicability_event_admit
BEFORE INSERT ON v2_component_applicability_events
BEGIN
    SELECT RAISE(ABORT, 'APPLICABILITY_INITIAL_DISABLED') WHERE NEW.origin = 'initial';
    SELECT RAISE(ABORT, 'APPLICABILITY_TARGET_INVALID') WHERE NOT EXISTS (
        SELECT 1 FROM v2_owned_copies c
        JOIN v2_component_definitions d ON d.collection_item_id = c.collection_item_id
        JOIN v2_physical_component_candidates p ON p.id = d.id
        WHERE c.id = NEW.copy_id AND d.id = NEW.definition_id
          AND c.collection_item_id = NEW.collection_id
    );
    SELECT RAISE(ABORT, 'APPLICABILITY_GENERATION_CHANGED') WHERE NOT EXISTS (
        SELECT 1 FROM d1_quantity_collection_generation
        WHERE collection_id = NEW.collection_id AND generation = NEW.before_generation
    );
    -- This also rejects INSERT OR REPLACE against any existing event revision.
    SELECT RAISE(ABORT, 'APPLICABILITY_STATE_CHANGED')
      WHERE NEW.revision IS NOT 1 + COALESCE((
        SELECT revision FROM v2_component_applicability_current
        WHERE copy_id = NEW.copy_id AND definition_id = NEW.definition_id
    ), 0) OR NEW.before_not_applicable IS NOT COALESCE((
        SELECT not_applicable FROM v2_component_applicability_current
        WHERE copy_id = NEW.copy_id AND definition_id = NEW.definition_id
    ), 0);
    -- No trusted coverage can be issued in this batch. Keep structural and version guards
    -- above for the future authorized write path, but never admit a marker as evidence.
    SELECT RAISE(ABORT, 'APPLICABILITY_SOURCE_UNAVAILABLE');
END;

CREATE TRIGGER v2_component_applicability_event_no_update
BEFORE UPDATE ON v2_component_applicability_events
BEGIN SELECT RAISE(ABORT, 'APPLICABILITY_HISTORY_IMMUTABLE'); END;

CREATE TRIGGER v2_component_applicability_event_no_delete
BEFORE DELETE ON v2_component_applicability_events
BEGIN SELECT RAISE(ABORT, 'APPLICABILITY_HISTORY_IMMUTABLE'); END;

CREATE TRIGGER v2_component_applicability_event_generation
AFTER INSERT ON v2_component_applicability_events
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_id;
    SELECT RAISE(ABORT, 'APPLICABILITY_GENERATION_CHANGED') WHERE changes() <> 1;
END;

-- Marker transitions invalidate earlier observations without attesting any collection.
CREATE TRIGGER v2_component_applicability_coverage_no_replace
BEFORE INSERT ON v2_component_applicability_coverage
WHEN EXISTS (
    SELECT 1 FROM v2_component_applicability_coverage WHERE collection_id = NEW.collection_id
)
BEGIN SELECT RAISE(ABORT, 'APPLICABILITY_COVERAGE_EXISTS'); END;

CREATE TRIGGER v2_component_applicability_coverage_no_update
BEFORE UPDATE ON v2_component_applicability_coverage
BEGIN SELECT RAISE(ABORT, 'APPLICABILITY_COVERAGE_IMMUTABLE'); END;

CREATE TRIGGER v2_component_applicability_coverage_generation_insert
AFTER INSERT ON v2_component_applicability_coverage
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = NEW.collection_id;
    SELECT RAISE(ABORT, 'APPLICABILITY_GENERATION_CHANGED') WHERE changes() <> 1;
END;

CREATE TRIGGER v2_component_applicability_coverage_generation_delete
AFTER DELETE ON v2_component_applicability_coverage
BEGIN
    UPDATE d1_quantity_collection_generation SET generation = generation + 1
    WHERE collection_id = OLD.collection_id;
    SELECT RAISE(ABORT, 'APPLICABILITY_GENERATION_CHANGED') WHERE changes() <> 1;
END;
