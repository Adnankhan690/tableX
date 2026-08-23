-- order_item: one line on an order. Values are snapshotted at order time (D8).

CREATE TABLE order_item (
    id               SERIAL       PRIMARY KEY,
    uid              VARCHAR(64)  NOT NULL UNIQUE,
    order_id         INTEGER      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    -- Retained for analytics ("how many paneer tikka did we sell in July"), never joined
    -- to for display or pricing. RESTRICT, not CASCADE: deleting a dish must not silently
    -- delete the history of it being sold.
    menu_item_id     INTEGER      NOT NULL REFERENCES menu_item (id) ON DELETE RESTRICT,

    -- Frozen copies. A price rise at 8pm must not rewrite the total of a 7:45pm order,
    -- and a renamed dish must still read correctly on last month's bill (D8).
    name_snapshot    VARCHAR(128) NOT NULL,
    unit_price_minor BIGINT       NOT NULL,
    food_type        VARCHAR(16)  NOT NULL,

    quantity         INTEGER      NOT NULL,
    total_minor      BIGINT       NOT NULL,
    note             TEXT,
    -- active | cancelled. Per-item cancellation (PRD 9.1) without deleting the row, so
    -- the kitchen ticket history stays intact.
    status           VARCHAR(32)  NOT NULL DEFAULT 'active',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT order_item_quantity_positive CHECK (quantity > 0),
    CONSTRAINT order_item_amounts_valid     CHECK (unit_price_minor >= 0 AND total_minor >= 0),
    CONSTRAINT order_item_status_valid      CHECK (status IN ('active', 'cancelled')),
    CONSTRAINT order_item_food_type_valid   CHECK (food_type IN ('veg', 'non_veg', 'egg'))
);

CREATE INDEX idx_order_item_order     ON order_item (order_id);
CREATE INDEX idx_order_item_menu_item ON order_item (menu_item_id);
