-- menu_item.rating_count / rating_sum: the running aggregate of a dish's reviews.

-- DENORMALISED ON PURPOSE, and this is the one place in the schema where that trade is
-- made, so it is worth stating why.
--
-- The diner menu is the single hot read in this product: it runs on every scan, on a phone,
-- on 3G, and PRD 7 makes its latency a product requirement rather than an aspiration. The
-- honest alternative -- a LEFT JOIN to a GROUP BY over order_item_review on every menu load
-- -- is cheap on the seed data and gets steadily worse for exactly the restaurants that
-- succeed, because the review table grows without bound while the menu does not.
--
-- Sum and count rather than a stored average, because:
--   * an average is lossy. From sum and count any later question (weighted rollups, a
--     recomputed backfill, "how many 5s") is still answerable; from a float it is not.
--   * a float in the schema is how a rounding error becomes permanent (cf. D7 on money).
--   * updating an average in place requires reading it first, which is a read-modify-write
--     and therefore a lost update under two concurrent reviews. Sum and count are updated
--     with `rating_sum = rating_sum + ?`, which the database serialises for us.
--
-- The reconstruction query, should these ever be doubted:
--
--   UPDATE menu_item m SET rating_count = a.c, rating_sum = a.s
--   FROM (SELECT menu_item_id, COUNT(*) c, SUM(rating) s
--           FROM order_item_review GROUP BY menu_item_id) a
--   WHERE m.id = a.menu_item_id;
ALTER TABLE menu_item ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_item ADD COLUMN rating_sum   BIGINT  NOT NULL DEFAULT 0;

-- Both are maintained by delta inside the review transaction, so a negative value would
-- mean the deltas have gone wrong. Failing loudly at the write beats serving an average
-- built from a corrupt counter.
ALTER TABLE menu_item ADD CONSTRAINT menu_item_rating_count_non_negative CHECK (rating_count >= 0);
ALTER TABLE menu_item ADD CONSTRAINT menu_item_rating_sum_non_negative   CHECK (rating_sum >= 0);

-- Deliberately NOT indexed. "Best rated dishes" is an admin screen over one restaurant's
-- menu -- tens of rows, already loaded in full by the existing menu index -- so ordering
-- happens in memory. An index here would be paid for on every review write to serve a
-- query that never needed it.
