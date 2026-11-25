-- Current applicability is derived from the latest immutable event for a pair.
-- The Admin API authenticates the actor and accepts the administrator's confirmation as evidence.
CREATE TABLE v2_component_applicability_events (
    copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
    definition_id INTEGER NOT NULL REFERENCES v2_component_definitions(id) ON DELETE RESTRICT,
    collection_id INTEGER NOT NULL REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 1),
    before_not_applicable INTEGER NOT NULL CHECK (before_not_applicable IN (0, 1)),
    after_not_applicable INTEGER NOT NULL CHECK (after_not_applicable IN (0, 1)),
    actor TEXT NOT NULL CHECK (length(trim(actor)) BETWEEN 1 AND 320),
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
    -- ABORT also rolls back earlier rows of an INSERT OR IGNORE statement.
    SELECT RAISE(ABORT, 'APPLICABILITY_CHANGE_INVALID')
    WHERE NEW.after_not_applicable IS NULL OR NEW.after_not_applicable NOT IN (0, 1)
       OR NEW.before_not_applicable = NEW.after_not_applicable
       OR NEW.actor IS NULL OR length(trim(NEW.actor)) NOT BETWEEN 1 AND 320
       OR NEW.origin IS NOT 'change' OR typeof(NEW.occurred_at) <> 'integer';
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
