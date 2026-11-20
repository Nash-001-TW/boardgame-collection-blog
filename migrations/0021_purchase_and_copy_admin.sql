-- No historical purchases are imported, reallocated or claimed by this editor.
ALTER TABLE v2_purchase_orders ADD COLUMN admin_managed INTEGER NOT NULL DEFAULT 0 CHECK(admin_managed IN (0,1));
ALTER TABLE v2_purchase_orders ADD COLUMN admin_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_owned_copies ADD COLUMN condition_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_owned_copies ADD COLUMN condition_checked_at TEXT;
ALTER TABLE v2_owned_copies ADD COLUMN condition_details TEXT;
CREATE TABLE v2_purchase_admin_commands (
 request_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,actor TEXT NOT NULL,result_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
CREATE TRIGGER v2_purchase_commands_no_update BEFORE UPDATE ON v2_purchase_admin_commands
BEGIN SELECT RAISE(ABORT,'PURCHASE_COMMAND_IMMUTABLE'); END;
CREATE TRIGGER v2_purchase_commands_no_delete BEFORE DELETE ON v2_purchase_admin_commands
BEGIN SELECT RAISE(ABORT,'PURCHASE_COMMAND_IMMUTABLE'); END;
