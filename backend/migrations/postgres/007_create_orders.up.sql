-- orders: the central entity. Plural because "order" is a reserved word in SQL.

CREATE TABLE orders (
    id                   SERIAL       PRIMARY KEY,
    uid                  VARCHAR(64)  NOT NULL UNIQUE,
    restaurant_id        INTEGER      NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    table_id             INTEGER      NOT NULL REFERENCES restaurant_table (id) ON DELETE RESTRICT,
    guest_session_id     INTEGER      REFERENCES guest_session (id) ON DELETE SET NULL,
    -- Short daily counter shouted across a kitchen ("A-014"). The uid stays the API
    -- identifier; this is for humans (D9).
    order_number         VARCHAR(32)  NOT NULL,
    -- placed | accepted | preparing | ready | served | completed | rejected | cancelled.
    -- Transitions are enforced by the state machine in services/order_state.go (D1);
    -- this CHECK guards the column against a bad write from any other path.
    status               VARCHAR(32)  NOT NULL DEFAULT 'placed',

    -- All amounts are paise (D7). Totals are stored, not derived on read, so a later
    -- tax-rate change cannot retroactively alter a settled bill.
    subtotal_minor       BIGINT       NOT NULL,
    tax_minor            BIGINT       NOT NULL DEFAULT 0,
    service_charge_minor BIGINT       NOT NULL DEFAULT 0,
    discount_minor       BIGINT       NOT NULL DEFAULT 0,
    total_minor          BIGINT       NOT NULL,
    currency             VARCHAR(8)   NOT NULL DEFAULT 'INR',

    -- online_upi | counter
    payment_method       VARCHAR(32)  NOT NULL,
    -- pending | paid | failed | refunded. Deliberately separate from status: a counter
    -- order is served long before it is paid, and an online order is paid before it is
    -- accepted. Collapsing the two would make both unrepresentable.
    payment_status       VARCHAR(32)  NOT NULL DEFAULT 'pending',

    customer_name        VARCHAR(128),
    customer_phone       VARCHAR(20),
    note                 TEXT,

    -- Deduplicates the double-tap on a stalled phone (D12).
    idempotency_key      VARCHAR(128),

    placed_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    accepted_at          TIMESTAMPTZ,
    preparing_at         TIMESTAMPTZ,
    ready_at             TIMESTAMPTZ,
    served_at            TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    cancelled_at         TIMESTAMPTZ,
    cancel_reason        TEXT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT orders_status_valid CHECK (status IN (
        'placed', 'accepted', 'preparing', 'ready', 'served', 'completed', 'rejected', 'cancelled')),
    CONSTRAINT orders_payment_method_valid CHECK (payment_method IN ('online_upi', 'counter')),
    CONSTRAINT orders_payment_status_valid CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    CONSTRAINT orders_totals_non_negative  CHECK (
        subtotal_minor >= 0 AND tax_minor >= 0 AND service_charge_minor >= 0
        AND discount_minor >= 0 AND total_minor >= 0)
);

-- Partial unique index rather than a table constraint: most orders have no idempotency
-- key, and NULLs must not collide with each other.
CREATE UNIQUE INDEX idx_orders_idempotency
    ON orders (restaurant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_orders_number ON orders (restaurant_id, order_number);

-- The admin panel's primary query: newest orders for one restaurant.
CREATE INDEX idx_orders_restaurant_placed ON orders (restaurant_id, placed_at DESC);
-- Filtering the admin queue by status, and the "live orders" board.
CREATE INDEX idx_orders_restaurant_status ON orders (restaurant_id, status, placed_at DESC);
-- "Orders at my table this sitting" for the diner (D5), and the per-table admin filter.
CREATE INDEX idx_orders_table          ON orders (table_id, placed_at DESC);
CREATE INDEX idx_orders_guest_session  ON orders (guest_session_id, placed_at DESC);
