-- service_review: how one diner found the SERVICE during their sitting.

-- Separate from order_item_review because it answers a different question, and blending the two
-- would destroy the only thing that makes either useful. A dish rating is about the kitchen; this
-- is about the floor. Averaging them gives a restaurant one number that points at nobody -- "you
-- are a 3.8" is not something a manager can act on, where "food 4.6, service 3.2" names the team
-- and the shift.
--
-- Keyed to the SESSION, not the order. Service is experienced once per sitting, not once per
-- order: a diner who orders twice has not been served by two different restaurants. The session is
-- the only anchor available today -- docs/LLD.md 5.5 records that table_sitting is designed but not
-- built -- which has one visible consequence worth stating: four friends who each scan the sticker
-- are four sessions, so they leave four service ratings for one evening's service. That is four
-- genuine opinions rather than a bug, but the number is per-diner, not per-table.
CREATE TABLE service_review (
    id               SERIAL      PRIMARY KEY,
    uid              VARCHAR(64) NOT NULL UNIQUE,
    restaurant_id    INTEGER     NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    -- The session that left it. NULLABLE and SET NULL rather than NOT NULL and CASCADE, and that
    -- is load-bearing: repositories.RepositoryGuestSessionMethods.DeleteExpired reaps sessions
    -- once their tokens can no longer authenticate. Cascading would make every prune a silent
    -- deletion of a night's service feedback.
    --
    -- The UNIQUE below therefore constrains only LIVE sessions, because Postgres (and SQLite)
    -- allow many NULLs in a unique index. That is exactly the right scope: a session can only be
    -- written to while it is alive, since holding it is the whole authentication.
    guest_session_id INTEGER     REFERENCES guest_session (id) ON DELETE SET NULL,
    -- The order the diner was looking at when they rated. Context, not identity -- it is what lets
    -- staff find the sitting on the board and reach the table. RESTRICT, so an order cannot be
    -- deleted out from under the feedback it explains.
    order_id         INTEGER     NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

    -- 1..5, matching order_item_review. SMALLINT rather than a float for the same reason: five
    -- values, and a type that can hold 4.7 invites someone to store a pre-averaged number here.
    rating           SMALLINT    NOT NULL,
    -- Comma-separated, from models.ServiceTag's closed vocabulary. Same storage shape as
    -- order_item_review.tags and for the same reasons: fixed small vocabulary, never queried by
    -- element, and it must round-trip under SQLite where the unit tests run.
    tags             TEXT        NOT NULL DEFAULT '',
    comment          TEXT        NOT NULL DEFAULT '',

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT service_review_rating_range CHECK (rating BETWEEN 1 AND 5),
    -- One per sitting, so a diner correcting a mis-tap updates rather than accumulates -- and so
    -- a diner with two open orders who rates service from either one is editing the same row.
    CONSTRAINT service_review_session_key  UNIQUE (guest_session_id)
);

-- The admin service feed: one restaurant, newest first.
CREATE INDEX idx_service_review_feed ON service_review (restaurant_id, created_at DESC);

-- Loading the session's own rating back, so the diner sees the stars they already gave rather
-- than an empty row after a refresh. Covered by the UNIQUE above under Postgres, but named here
-- because that is the query, and a later change to the uniqueness must not silently drop it.

-- DELIBERATELY NO DENORMALISED AGGREGATE, unlike menu_item.rating_count/rating_sum (migration 016).
-- The asymmetry is the point. Those exist because the DINER MENU is the hottest read in the
-- product and must not carry a GROUP BY that grows without bound. A restaurant's service average
-- is read on one admin screen, opened a few times a shift, over one restaurant's rows -- a cold
-- query on an indexed tenant scope. Denormalising it would buy nothing and cost the reconciliation
-- burden and the lost-update hazard that counters bring with them.
