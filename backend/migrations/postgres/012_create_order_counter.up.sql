-- order_counter: allocates the per-restaurant, per-day human order number (D9).
--
-- One row per restaurant per business date, incremented under SELECT ... FOR UPDATE
-- inside the order-placement transaction. A counter table is used rather than a Postgres
-- sequence because the number has to reset each day and be scoped per restaurant, and
-- rather than SELECT COUNT(*) because two concurrent diners would compute the same count
-- and collide.
--
-- business_date is a DATE in the restaurant's own timezone, not UTC: a 1am order belongs
-- to the previous evening's service as far as the kitchen is concerned.

CREATE TABLE order_counter (
    id            SERIAL      PRIMARY KEY,
    restaurant_id INTEGER     NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    business_date DATE        NOT NULL,
    last_number   INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT order_counter_key UNIQUE (restaurant_id, business_date)
);
