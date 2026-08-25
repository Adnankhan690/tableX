-- Reverses 013. The old index is restored first so the column drop cannot leave the table
-- without a uniqueness guard on the order number.
--
-- Note that going back is only safe while no restaurant has reused a number across two service
-- dates -- which is precisely what the up migration allows. If any has, this DROP INDEX /
-- CREATE UNIQUE INDEX pair will fail on the duplicate, and that is the correct outcome: it
-- refuses rather than silently discarding one of two orders a kitchen has already cooked.
DROP INDEX idx_orders_number;
CREATE UNIQUE INDEX idx_orders_number ON orders (restaurant_id, order_number);

ALTER TABLE orders DROP COLUMN business_date;
