-- menu_category: menu grouping shown as tabs on the diner menu (PRD 6.2).

CREATE TABLE menu_category (
    id            SERIAL      PRIMARY KEY,
    uid           VARCHAR(64) NOT NULL UNIQUE,
    restaurant_id INTEGER     NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    name          VARCHAR(64) NOT NULL,
    description   TEXT,
    -- Menus are ordered by kitchen convention (Starters before Desserts), not
    -- alphabetically; the restaurant controls the sequence.
    sort_order    INTEGER     NOT NULL DEFAULT 0,
    status        VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT menu_category_name_key UNIQUE (restaurant_id, name)
);

CREATE INDEX idx_menu_category_restaurant ON menu_category (restaurant_id, status, sort_order);
