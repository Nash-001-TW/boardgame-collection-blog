-- Keep legacy counts undated. Normalize dates before comparison so SQLite
-- also rejects impossible dates and inputs for which date() returns NULL.
ALTER TABLE v2_copy_components ADD COLUMN counted_on TEXT CHECK (
    counted_on IS NULL OR (
        length(counted_on) = 10
        AND date(counted_on, '+0 days') IS counted_on
        AND counted_on >= '2000-01-01'
    )
);

CREATE TRIGGER v2_copy_components_count_date_insert
BEFORE INSERT ON v2_copy_components
WHEN NEW.count_revision >= 1
    AND (NEW.counted_on IS NULL OR NEW.counted_on > date('now', '+8 hours'))
BEGIN
    SELECT RAISE(ABORT, 'COUNT_DATE_INVALID');
END;

CREATE TRIGGER v2_copy_components_count_date_update
BEFORE UPDATE ON v2_copy_components
WHEN (NEW.count_revision > OLD.count_revision
      AND (NEW.counted_on IS NULL OR NEW.counted_on > date('now', '+8 hours')))
    OR (NEW.counted_on IS NOT OLD.counted_on AND NEW.count_revision = OLD.count_revision)
BEGIN
    SELECT RAISE(ABORT, 'COUNT_DATE_INVALID');
END;
