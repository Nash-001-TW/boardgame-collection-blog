-- 0006: 收藏組件數量與單位

ALTER TABLE collection_components
ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
CHECK (quantity >= 1);

ALTER TABLE collection_components
ADD COLUMN quantity_unit TEXT NOT NULL DEFAULT 'unknown'
CHECK (quantity_unit IN (
    'unknown', 'box', 'pack', 'set', 'piece',
    'card', 'tile', 'die', 'sheet', 'other'
));

-- 已確認的既有組件數量
UPDATE collection_components SET quantity = 6, quantity_unit = 'tile'  WHERE id = 31;
UPDATE collection_components SET quantity = 1, quantity_unit = 'piece' WHERE id = 32;
UPDATE collection_components SET quantity = 1, quantity_unit = 'sheet' WHERE id = 33;
UPDATE collection_components SET quantity = 5, quantity_unit = 'die'   WHERE id = 34;
UPDATE collection_components SET quantity = 3, quantity_unit = 'sheet' WHERE id = 35;
UPDATE collection_components SET quantity = 2, quantity_unit = 'card'  WHERE id = 52;
UPDATE collection_components SET quantity = 2, quantity_unit = 'card'  WHERE id = 53;
UPDATE collection_components SET quantity = 8, quantity_unit = 'piece' WHERE id = 169;
