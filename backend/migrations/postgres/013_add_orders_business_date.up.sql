-- orders.business_date: scopes the human order number to one service date (D9).
--
-- The bug this fixes. order_counter is keyed (restaurant_id, business_date) and resets to 1
-- each service date, so it hands out "A-001" again every morning -- but idx_orders_number was
-- UNIQUE (restaurant_id, order_number) with no date in it, so the first order of every new day
-- collided with the previous day's first order and the diner's checkout failed with a 23505.
-- The counter was right and the index was wrong: the number is documented as a short daily
-- counter, so uniqueness has to be per day too.
--
-- Stored rather than derived. The business date is placed_at read in the restaurant's own
-- timezone, which is a per-row lookup through restaurant.timezone -- not an immutable
-- expression, so it cannot go in an index. Persisting the value the write path already
-- computes is what makes the constraint expressible, and it also lets the daily stats queries
-- filter on a date column instead of converting every row's timestamp.

ALTER TABLE orders ADD COLUMN business_date DATE;

-- Backfill in the restaurant's timezone, matching models.Restaurant.BusinessDate: a 1am order
-- belongs to the previous evening's service. AT TIME ZONE takes the IANA name straight from
-- restaurant.timezone, so this agrees with the Go helper rather than re-implementing it.
UPDATE orders o
SET business_date = (o.placed_at AT TIME ZONE r.timezone)::date
FROM restaurant r
WHERE r.id = o.restaurant_id;

-- Any row whose restaurant is already gone cannot be dated from its timezone. There is no such
-- row today (restaurant_id is NOT NULL with an ON DELETE CASCADE parent), but the column is
-- about to become NOT NULL, so the fallback keeps this migration total rather than relying on
-- that continuing to hold.
UPDATE orders SET business_date = (placed_at AT TIME ZONE 'Asia/Kolkata')::date
WHERE business_date IS NULL;

ALTER TABLE orders ALTER COLUMN business_date SET NOT NULL;

-- Replace the index rather than adding a second one: the old two-column form is exactly the
-- constraint that was wrong, and leaving it in place would keep rejecting the daily reset.
DROP INDEX idx_orders_number;
CREATE UNIQUE INDEX idx_orders_number ON orders (restaurant_id, business_date, order_number);
