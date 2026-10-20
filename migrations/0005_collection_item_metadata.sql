-- Migration 0005: Collection item metadata

ALTER TABLE collection_items
ADD COLUMN item_type TEXT NOT NULL DEFAULT 'unknown'
CHECK (item_type IN (
  'base', 'expansion', 'bundle', 'accessory',
  'storage', 'promo', 'other', 'unknown'
));

ALTER TABLE collection_items
ADD COLUMN catalog_status TEXT NOT NULL DEFAULT 'pending'
CHECK (catalog_status IN (
  'bgg', 'manual', 'pending'
));

ALTER TABLE collection_items
ADD COLUMN acquisition_status TEXT NOT NULL DEFAULT 'owned'
CHECK (acquisition_status IN (
  'owned', 'preordered', 'wishlist',
  'not_owned', 'unknown'
));

ALTER TABLE collection_items
ADD COLUMN wishlist INTEGER NOT NULL DEFAULT 0
CHECK (wishlist IN (0,1));

ALTER TABLE collection_items
ADD COLUMN factory_seal_status TEXT NOT NULL DEFAULT 'unknown'
CHECK (factory_seal_status IN (
  'sealed', 'unsealed', 'unknown'
));
