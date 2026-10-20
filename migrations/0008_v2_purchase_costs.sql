-- Board Game Collection Manager V2.0
-- Migration 0008: Purchase orders, line items, acquisitions and cost allocation.
-- Additive only. Monetary amounts are INTEGER minor units (e.g. TWD cents).
-- Each order has ONE currency. Cross-currency reports require an explicit conversion.
-- No V1 data is modified, migrated or deleted here.

CREATE TABLE IF NOT EXISTS v2_purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_reference TEXT,
  merchant_name TEXT,
  ordered_at TEXT,
  currency_code TEXT NOT NULL DEFAULT 'TWD'
    CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  item_subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK (item_subtotal_minor >= 0),
  shipping_minor INTEGER NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  -- Refunds are represented once, here, as an order-level cumulative amount.
  refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  acquisition_channel TEXT NOT NULL DEFAULT 'purchase'
    CHECK (acquisition_channel IN ('purchase','preorder','gift','prize','trade','other')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','paid','partially_received','completed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (discount_minor <= item_subtotal_minor + shipping_minor + tax_minor + fee_minor),
  CHECK (refunded_minor <= item_subtotal_minor + shipping_minor + tax_minor + fee_minor - discount_minor)
);
CREATE INDEX IF NOT EXISTS idx_v2_orders_date ON v2_purchase_orders(ordered_at);
CREATE INDEX IF NOT EXISTS idx_v2_orders_status ON v2_purchase_orders(status);

CREATE TABLE IF NOT EXISTS v2_purchase_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES v2_purchase_orders(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  collection_item_id INTEGER REFERENCES v2_collection_items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  line_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (line_discount_minor >= 0),
  line_type TEXT NOT NULL DEFAULT 'item'
    CHECK (line_type IN ('item','bundle','accessory','sleeves','service','other')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (purchase_order_id, line_number),
  CHECK (line_discount_minor <= quantity * unit_price_minor)
);
CREATE INDEX IF NOT EXISTS idx_v2_order_lines_item ON v2_purchase_order_lines(collection_item_id);

-- Physical acquisition is separate from purchase; gifts and prizes may cost zero.
CREATE TABLE IF NOT EXISTS v2_acquisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  purchase_order_line_id INTEGER REFERENCES v2_purchase_order_lines(id) ON DELETE SET NULL,
  acquisition_type TEXT NOT NULL DEFAULT 'purchase'
    CHECK (acquisition_type IN ('purchase','gift','prize','trade','opening_balance','other')),
  acquired_at TEXT,
  declared_market_value_minor INTEGER CHECK (declared_market_value_minor IS NULL OR declared_market_value_minor >= 0),
  market_value_currency TEXT CHECK (market_value_currency IS NULL OR (length(market_value_currency) = 3 AND market_value_currency = upper(market_value_currency))),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owned_copy_id, purchase_order_line_id)
);
CREATE INDEX IF NOT EXISTS idx_v2_acquisitions_line ON v2_acquisitions(purchase_order_line_id);

-- Allocations express distribution of the actual paid order total, including
-- distributed shipping/tax/fees and discounts. One allocation targets ONE copy
-- OR one collection item, never both. Non-copy purchases may remain unallocated.
-- Allocate the full order total across targets; do not additionally sum line prices.
CREATE TABLE IF NOT EXISTS v2_purchase_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES v2_purchase_orders(id) ON DELETE RESTRICT,
  purchase_order_line_id INTEGER REFERENCES v2_purchase_order_lines(id) ON DELETE SET NULL,
  owned_copy_id INTEGER REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  collection_item_id INTEGER REFERENCES v2_collection_items(id) ON DELETE RESTRICT,
  allocated_minor INTEGER NOT NULL CHECK (allocated_minor >= 0),
  allocation_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (allocation_method IN ('manual','equal','weighted','direct')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((owned_copy_id IS NOT NULL) <> (collection_item_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_v2_allocations_order ON v2_purchase_allocations(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_v2_allocations_copy ON v2_purchase_allocations(owned_copy_id);
CREATE INDEX IF NOT EXISTS idx_v2_allocations_item ON v2_purchase_allocations(collection_item_id);

-- Additional copy-level expenses such as repairs/replacements. Refunds must be
-- accounted for at the order level above, not entered here again.
CREATE TABLE IF NOT EXISTS v2_cost_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_copy_id INTEGER NOT NULL REFERENCES v2_owned_copies(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL
    CHECK (adjustment_type IN ('repair','replacement','customization','other_expense','correction')),
  amount_minor INTEGER NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'TWD'
    CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
  occurred_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (adjustment_type = 'correction' OR amount_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_v2_adjustments_copy ON v2_cost_adjustments(owned_copy_id);

-- Reconciliation is per currency and per order. Negative unallocated_minor means
-- over-allocation, and must be resolved before marking cost allocation complete.
CREATE VIEW IF NOT EXISTS v2_purchase_order_reconciliation AS
SELECT o.id AS purchase_order_id,
       o.currency_code,
       (o.item_subtotal_minor + o.shipping_minor + o.tax_minor + o.fee_minor
        - o.discount_minor - o.refunded_minor) AS paid_minor,
       COALESCE(a.allocated_minor, 0) AS allocated_minor,
       (o.item_subtotal_minor + o.shipping_minor + o.tax_minor + o.fee_minor
        - o.discount_minor - o.refunded_minor - COALESCE(a.allocated_minor, 0)) AS unallocated_minor
FROM v2_purchase_orders o
LEFT JOIN (
  SELECT purchase_order_id, SUM(allocated_minor) AS allocated_minor
  FROM v2_purchase_allocations GROUP BY purchase_order_id
) a ON a.purchase_order_id = o.id;
