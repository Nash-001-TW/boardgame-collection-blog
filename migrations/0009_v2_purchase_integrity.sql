-- Migration 0009: V2 purchase allocation integrity
-- SQLite / Cloudflare D1
-- All rules apply to future writes; review existing data before deploying remotely.

CREATE TRIGGER IF NOT EXISTS v2_allocation_validate_insert
BEFORE INSERT ON v2_purchase_allocations
BEGIN
  SELECT RAISE(ABORT, 'allocation line belongs to another purchase order')
  WHERE NEW.purchase_order_line_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM v2_purchase_order_lines l
      WHERE l.id = NEW.purchase_order_line_id
        AND l.purchase_order_id = NEW.purchase_order_id
    );

  SELECT RAISE(ABORT, 'allocation exceeds order net paid amount')
  WHERE NEW.allocated_minor + COALESCE((
    SELECT SUM(a.allocated_minor) FROM v2_purchase_allocations a
    WHERE a.purchase_order_id = NEW.purchase_order_id
  ), 0) > COALESCE((
    SELECT o.item_subtotal_minor + o.shipping_minor + o.tax_minor + o.fee_minor
      - o.discount_minor - o.refunded_minor
    FROM v2_purchase_orders o WHERE o.id = NEW.purchase_order_id
  ), -1);
END;

CREATE TRIGGER IF NOT EXISTS v2_allocation_validate_update
BEFORE UPDATE ON v2_purchase_allocations
BEGIN
  SELECT RAISE(ABORT, 'allocation line belongs to another purchase order')
  WHERE NEW.purchase_order_line_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM v2_purchase_order_lines l
      WHERE l.id = NEW.purchase_order_line_id
        AND l.purchase_order_id = NEW.purchase_order_id
    );

  SELECT RAISE(ABORT, 'allocation exceeds order net paid amount')
  WHERE NEW.allocated_minor + COALESCE((
    SELECT SUM(a.allocated_minor) FROM v2_purchase_allocations a
    WHERE a.purchase_order_id = NEW.purchase_order_id AND a.id <> OLD.id
  ), 0) > COALESCE((
    SELECT o.item_subtotal_minor + o.shipping_minor + o.tax_minor + o.fee_minor
      - o.discount_minor - o.refunded_minor
    FROM v2_purchase_orders o WHERE o.id = NEW.purchase_order_id
  ), -1);
END;

CREATE TRIGGER IF NOT EXISTS v2_order_validate_amount_update
BEFORE UPDATE OF item_subtotal_minor, shipping_minor, tax_minor, fee_minor,
                 discount_minor, refunded_minor ON v2_purchase_orders
BEGIN
  SELECT RAISE(ABORT, 'order net paid amount would be below allocated amount')
  WHERE COALESCE((
    SELECT SUM(a.allocated_minor) FROM v2_purchase_allocations a
    WHERE a.purchase_order_id = OLD.id
  ), 0) > (
    NEW.item_subtotal_minor + NEW.shipping_minor + NEW.tax_minor + NEW.fee_minor
    - NEW.discount_minor - NEW.refunded_minor
  );
END;

CREATE TRIGGER IF NOT EXISTS v2_order_line_validate_order_update
BEFORE UPDATE OF purchase_order_id ON v2_purchase_order_lines
BEGIN
  SELECT RAISE(ABORT, 'cannot move purchase order line with existing allocations')
  WHERE NEW.purchase_order_id <> OLD.purchase_order_id
    AND EXISTS (
      SELECT 1 FROM v2_purchase_allocations a
      WHERE a.purchase_order_line_id = OLD.id
    );
END;
