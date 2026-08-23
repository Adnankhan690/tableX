-- menu_item: a single orderable dish.

CREATE TABLE menu_item (
    id             SERIAL       PRIMARY KEY,
    uid            VARCHAR(64)  NOT NULL UNIQUE,
    restaurant_id  INTEGER      NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    category_id    INTEGER      NOT NULL REFERENCES menu_category (id) ON DELETE RESTRICT,
    name           VARCHAR(128) NOT NULL,
    description    TEXT,
    image_url      TEXT,
    -- Paise. Never a float anywhere in the stack (D7). Rs 249.50 is stored as 24950.
    price_minor    BIGINT       NOT NULL,
    -- veg | non_veg | egg. Required, not nullable: an unlabelled dish is unorderable for
    -- a large share of diners in this market (PRD 6.2).
    food_type      VARCHAR(16)  NOT NULL,
    -- mild | medium | hot, or NULL where it does not apply (a soft drink).
    spice_level    VARCHAR(16),
    -- is_available is the day-to-day "we ran out" toggle staff flip during service.
    -- status is the lifecycle flag (active/archived). Distinct concerns, distinct columns:
    -- archiving a dish that sold out for one evening would break its order history.
    is_available   BOOLEAN      NOT NULL DEFAULT TRUE,
    is_bestseller  BOOLEAN      NOT NULL DEFAULT FALSE,
    prep_time_mins INTEGER,
    sort_order     INTEGER      NOT NULL DEFAULT 0,
    status         VARCHAR(32)  NOT NULL DEFAULT 'active',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT menu_item_price_non_negative CHECK (price_minor >= 0),
    CONSTRAINT menu_item_food_type_valid     CHECK (food_type IN ('veg', 'non_veg', 'egg')),
    CONSTRAINT menu_item_name_key            UNIQUE (restaurant_id, category_id, name)
);

-- Covers the menu page's only read: every available item for one restaurant, in display
-- order. PRD 7 makes this query's latency a product requirement on 3G.
CREATE INDEX idx_menu_item_menu ON menu_item (restaurant_id, status, category_id, sort_order);
