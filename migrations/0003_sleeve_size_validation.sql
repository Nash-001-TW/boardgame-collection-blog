CREATE TRIGGER IF NOT EXISTS trg_sleeve_sizes_validate_insert
BEFORE INSERT ON sleeve_sizes
FOR EACH ROW
WHEN NEW.width_tenth_mm > NEW.height_tenth_mm
BEGIN
    SELECT RAISE(ABORT, 'Sleeve size must be short side first');
END;

CREATE TRIGGER IF NOT EXISTS trg_sleeve_sizes_validate_update
BEFORE UPDATE OF width_tenth_mm, height_tenth_mm ON sleeve_sizes
FOR EACH ROW
WHEN NEW.width_tenth_mm > NEW.height_tenth_mm
BEGIN
    SELECT RAISE(ABORT, 'Sleeve size must be short side first');
END;
