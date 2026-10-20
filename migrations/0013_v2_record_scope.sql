
-- ============================================================
-- Migration 0013
-- V2 Collection Record Scope
--
-- production : 正式收藏資料
-- test       : 開發與整合測試資料
-- ============================================================

-- 1. 新增資料範圍欄位
ALTER TABLE v2_collection_items
ADD COLUMN record_scope TEXT NOT NULL
DEFAULT 'production'
CHECK (record_scope IN ('production', 'test'));

-- 2. 標記 Migration 0011 的整合測試資料
UPDATE v2_collection_items
SET record_scope = 'test'
WHERE id = 5
  AND display_name = 'TEST_0011_Sleeve_Game'
  AND notes = 'TEST_0011 integration fixture';

-- 3. 建立正式資料查詢索引
CREATE INDEX IF NOT EXISTS
idx_v2_collection_items_record_scope
ON v2_collection_items(record_scope);
