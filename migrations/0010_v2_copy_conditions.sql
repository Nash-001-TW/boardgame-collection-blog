-- V2 copy acquisition trade condition and multi-select condition tags.
-- Apply after 0009_v2_purchase_integrity.sql.
ALTER TABLE v2_owned_copies ADD COLUMN trade_condition TEXT NOT NULL DEFAULT 'unknown'
  CHECK (trade_condition IN ('unknown','new','secondhand_like_new','secondhand_used','secondhand_incomplete','secondhand_damaged'));

CREATE TABLE v2_copy_condition_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  condition_code TEXT NOT NULL
    CHECK (condition_code IN ('sealed','opened_unplayed','sleeved','missing_parts','moisture_damage')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owned_copy_id, condition_code)
);

CREATE INDEX idx_v2_copy_condition_tags_copy ON v2_copy_condition_tags(owned_copy_id);
CREATE INDEX idx_v2_copy_condition_tags_code ON v2_copy_condition_tags(condition_code);

CREATE TABLE v2_copy_condition_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  condition_code TEXT NOT NULL
    CHECK (condition_code IN ('sealed','opened_unplayed','sleeved','missing_parts','moisture_damage')),
  action TEXT NOT NULL CHECK (action IN ('added','removed')),
  notes TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_v2_copy_condition_history_copy_time ON v2_copy_condition_history(owned_copy_id, occurred_at);

-- Treat seal_status as authoritative. 'sealed' tag is permitted only when seal_status='sealed'.
-- An unsealed copy cannot acquire a sealed tag, and a sealed copy cannot have opened/sleeved tags.
CREATE TRIGGER v2_copy_condition_validate_insert
BEFORE INSERT ON v2_copy_condition_tags
BEGIN
  SELECT RAISE(ABORT, 'sealed tag requires seal_status sealed')
  WHERE NEW.condition_code = 'sealed'
    AND NOT EXISTS (SELECT 1 FROM v2_owned_copies c WHERE c.id = NEW.owned_copy_id AND c.seal_status = 'sealed');
  SELECT RAISE(ABORT, 'sealed copy cannot be opened or sleeved')
  WHERE NEW.condition_code IN ('opened_unplayed','sleeved')
    AND EXISTS (SELECT 1 FROM v2_owned_copies c WHERE c.id = NEW.owned_copy_id AND c.seal_status = 'sealed');
  SELECT RAISE(ABORT, 'sealed tag conflicts with opened or sleeved tag')
  WHERE NEW.condition_code IN ('opened_unplayed','sleeved')
    AND EXISTS (SELECT 1 FROM v2_copy_condition_tags t WHERE t.owned_copy_id = NEW.owned_copy_id AND t.condition_code = 'sealed');
  SELECT RAISE(ABORT, 'sealed tag conflicts with opened or sleeved tag')
  WHERE NEW.condition_code = 'sealed'
    AND EXISTS (SELECT 1 FROM v2_copy_condition_tags t WHERE t.owned_copy_id = NEW.owned_copy_id AND t.condition_code IN ('opened_unplayed','sleeved'));
END;

CREATE TRIGGER v2_copy_condition_validate_update
BEFORE UPDATE OF owned_copy_id, condition_code ON v2_copy_condition_tags
BEGIN
  SELECT RAISE(ABORT, 'sealed tag requires seal_status sealed')
  WHERE NEW.condition_code = 'sealed'
    AND NOT EXISTS (SELECT 1 FROM v2_owned_copies c WHERE c.id = NEW.owned_copy_id AND c.seal_status = 'sealed');
  SELECT RAISE(ABORT, 'sealed copy cannot be opened or sleeved')
  WHERE NEW.condition_code IN ('opened_unplayed','sleeved')
    AND EXISTS (SELECT 1 FROM v2_owned_copies c WHERE c.id = NEW.owned_copy_id AND c.seal_status = 'sealed');
  SELECT RAISE(ABORT, 'sealed tag conflicts with opened or sleeved tag')
  WHERE NEW.condition_code IN ('opened_unplayed','sleeved')
    AND EXISTS (SELECT 1 FROM v2_copy_condition_tags t WHERE t.owned_copy_id = NEW.owned_copy_id AND t.id <> OLD.id AND t.condition_code = 'sealed');
  SELECT RAISE(ABORT, 'sealed tag conflicts with opened or sleeved tag')
  WHERE NEW.condition_code = 'sealed'
    AND EXISTS (SELECT 1 FROM v2_copy_condition_tags t WHERE t.owned_copy_id = NEW.owned_copy_id AND t.id <> OLD.id AND t.condition_code IN ('opened_unplayed','sleeved'));
END;

CREATE TRIGGER v2_copy_seal_status_validate_update
BEFORE UPDATE OF seal_status ON v2_owned_copies
BEGIN
  SELECT RAISE(ABORT, 'seal_status conflicts with sealed condition tag')
  WHERE NEW.seal_status <> 'sealed'
    AND EXISTS (SELECT 1 FROM v2_copy_condition_tags t WHERE t.owned_copy_id = NEW.id AND t.condition_code = 'sealed');
  SELECT RAISE(ABORT, 'seal_status conflicts with opened or sleeved condition tags')
  WHERE NEW.seal_status = 'sealed'
    AND EXISTS (SELECT 1 FROM v2_copy_condition_tags t WHERE t.owned_copy_id = NEW.id AND t.condition_code IN ('opened_unplayed','sleeved'));
END;

CREATE TRIGGER v2_copy_condition_history_insert
AFTER INSERT ON v2_copy_condition_tags
BEGIN
  INSERT INTO v2_copy_condition_history(owned_copy_id, condition_code, action, notes)
  VALUES (NEW.owned_copy_id, NEW.condition_code, 'added', NEW.notes);
END;

CREATE TRIGGER v2_copy_condition_history_delete
AFTER DELETE ON v2_copy_condition_tags
BEGIN
  INSERT INTO v2_copy_condition_history(owned_copy_id, condition_code, action, notes)
  VALUES (OLD.owned_copy_id, OLD.condition_code, 'removed', OLD.notes);
END;

-- Changes of tag identity are logged as removal and addition. Notes-only updates do not change history.
CREATE TRIGGER v2_copy_condition_history_update
AFTER UPDATE OF owned_copy_id, condition_code ON v2_copy_condition_tags
WHEN OLD.owned_copy_id <> NEW.owned_copy_id OR OLD.condition_code <> NEW.condition_code
BEGIN
  INSERT INTO v2_copy_condition_history(owned_copy_id, condition_code, action, notes)
  VALUES (OLD.owned_copy_id, OLD.condition_code, 'removed', OLD.notes);
  INSERT INTO v2_copy_condition_history(owned_copy_id, condition_code, action, notes)
  VALUES (NEW.owned_copy_id, NEW.condition_code, 'added', NEW.notes);
END;
