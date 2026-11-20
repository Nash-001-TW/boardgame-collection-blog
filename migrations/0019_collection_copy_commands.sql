-- Retry receipts for explicit copy creation/editing. Existing copy and purchase data is untouched.
CREATE TABLE v2_collection_copy_commands (
    request_key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    actor TEXT NOT NULL,
    copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
CREATE TRIGGER v2_copy_commands_no_update BEFORE UPDATE ON v2_collection_copy_commands
BEGIN SELECT RAISE(ABORT, 'COPY_COMMAND_IMMUTABLE'); END;
CREATE TRIGGER v2_copy_commands_no_delete BEFORE DELETE ON v2_collection_copy_commands
BEGIN SELECT RAISE(ABORT, 'COPY_COMMAND_IMMUTABLE'); END;
