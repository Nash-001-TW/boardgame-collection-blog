-- Add command replay protection and optimistic product editing without rewriting existing sleeve data.
ALTER TABLE v2_sleeve_products ADD COLUMN admin_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE v2_sleeve_admin_commands (
    request_key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    actor TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create','edit','archive','stock')),
    result_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

CREATE TRIGGER v2_sleeve_commands_no_update BEFORE UPDATE ON v2_sleeve_admin_commands
BEGIN SELECT RAISE(ABORT, 'SLEEVE_COMMAND_IMMUTABLE'); END;
CREATE TRIGGER v2_sleeve_commands_no_delete BEFORE DELETE ON v2_sleeve_admin_commands
BEGIN SELECT RAISE(ABORT, 'SLEEVE_COMMAND_IMMUTABLE'); END;
