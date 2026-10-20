BEGIN TRANSACTION;
-- 合併重複尺寸的需求關聯
UPDATE sleeve_requirements
SET size_id = 42
WHERE size_id = 102;

UPDATE sleeve_requirements
SET size_id = 93
WHERE size_id = 109;

-- 保險起見，同步修正可能存在的商品關聯
UPDATE sleeve_products
SET size_id = 42
WHERE size_id = 102;

UPDATE sleeve_products
SET size_id = 93
WHERE size_id = 109;

-- 刪除重複尺寸
DELETE FROM sleeve_sizes
WHERE id IN (102, 109);

-- 將所有尺寸統一為短邊在前、長邊在後
UPDATE sleeve_sizes
SET
    width_tenth_mm = height_tenth_mm,
    height_tenth_mm = width_tenth_mm
WHERE width_tenth_mm > height_tenth_mm;

COMMIT;