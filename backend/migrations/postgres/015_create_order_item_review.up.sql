-- order_item_review: one diner's rating of one dish on one order.

-- Keyed to the ORDER LINE, not to the menu item. A diner who orders the paneer tikka on
-- Tuesday and again on Friday is rating two different platings, and the kitchen needs to
-- see both -- an average that silently overwrites the first with the second would hide a
-- dish that got worse. menu_item_id rides along for aggregation; order_item_id is identity.
CREATE TABLE order_item_review (
    id               SERIAL      PRIMARY KEY,
    uid              VARCHAR(64) NOT NULL UNIQUE,
    -- Denormalised from orders. Every admin-side read of this table is "this restaurant's
    -- reviews", and carrying the tenant here means that query is a scan of one index rather
    -- than a join to orders whose only purpose is the WHERE clause (DECISIONS.md D3).
    restaurant_id    INTEGER     NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    order_id         INTEGER     NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    order_item_id    INTEGER     NOT NULL REFERENCES order_item (id) ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: deleting a dish must not silently delete the evidence of how
    -- it was received. Menu items are archived rather than deleted anyway, so this
    -- constraint should never fire -- it is here to make sure of that.
    menu_item_id     INTEGER     NOT NULL REFERENCES menu_item (id) ON DELETE RESTRICT,
    -- The session that left the review, kept for abuse investigation and nulled rather than
    -- cascaded when sessions are pruned: the rating outlives the anonymous identity that
    -- produced it, and losing a night's ratings to session cleanup would be a data loss bug.
    guest_session_id INTEGER     REFERENCES guest_session (id) ON DELETE SET NULL,

    -- 1..5. SMALLINT rather than a float: there are five values, and a numeric type that
    -- can hold 4.7 invites someone to store a pre-averaged number in a per-review column.
    rating           SMALLINT    NOT NULL,
    -- A comma-separated list drawn from a closed vocabulary (models.ReviewTag), NOT free
    -- text. Stored in one column rather than a child table because the vocabulary is fixed
    -- and small, the list is never queried by element, and the alternative is a join on
    -- every read of a feed that is already the least performance-critical screen in the
    -- product. Empty string means no tags.
    tags             TEXT        NOT NULL DEFAULT '',
    -- Optional, and deliberately short (enforced at the DTO). The one-tap rating is the
    -- product; this is the escape hatch for the diner who wants to say one more thing.
    comment          TEXT        NOT NULL DEFAULT '',

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT order_item_review_rating_range CHECK (rating BETWEEN 1 AND 5),
    -- One review per line, so a diner correcting a mis-tap updates rather than accumulates.
    -- This is also what makes the aggregate counters on menu_item safe to maintain by delta:
    -- without it, a double-submit would count the same dish twice and the average would
    -- drift with no way to reconstruct the truth.
    CONSTRAINT order_item_review_line_key    UNIQUE (order_item_id)
);

-- The admin reviews feed: one restaurant, newest first.
CREATE INDEX idx_order_item_review_feed ON order_item_review (restaurant_id, created_at DESC);

-- "Show me every review of this dish", which is the drill-down from the menu manager and
-- the query behind a dish's own rating history.
CREATE INDEX idx_order_item_review_dish ON order_item_review (restaurant_id, menu_item_id, created_at DESC);

-- Loading an order's existing reviews so the diner sees the stars they already left.
CREATE INDEX idx_order_item_review_order ON order_item_review (order_id);
