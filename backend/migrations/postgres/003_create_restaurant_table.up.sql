-- restaurant_table: a physical table. One QR code each (D4).

CREATE TABLE restaurant_table (
    id            SERIAL      PRIMARY KEY,
    uid           VARCHAR(64) NOT NULL UNIQUE,
    restaurant_id INTEGER     NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    -- Human label printed on the QR card: "12", "T-4", "Patio 2".
    label         VARCHAR(32) NOT NULL,
    -- Opaque, rotatable token carried in the QR URL /t/{qr_token}. Deliberately not the
    -- table id: a guessable URL would let a diner order onto someone else's table and
    -- would leak the floor size (D4).
    qr_token      VARCHAR(64) NOT NULL UNIQUE,
    seats         INTEGER,
    status        VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT restaurant_table_label_key UNIQUE (restaurant_id, label)
);

CREATE INDEX idx_restaurant_table_restaurant ON restaurant_table (restaurant_id, status);
