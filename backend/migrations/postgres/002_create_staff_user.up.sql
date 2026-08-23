-- staff_user: an admin-panel login. Belongs to exactly one restaurant (D3).

CREATE TABLE staff_user (
    id            SERIAL       PRIMARY KEY,
    uid           VARCHAR(64)  NOT NULL UNIQUE,
    restaurant_id INTEGER      NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(128) NOT NULL,
    -- owner | manager | staff
    role          VARCHAR(32)  NOT NULL DEFAULT 'staff',
    status        VARCHAR(32)  NOT NULL DEFAULT 'active',
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Email is unique per restaurant, not globally: the same person may staff two
    -- unrelated restaurants on this platform.
    CONSTRAINT staff_user_restaurant_email_key UNIQUE (restaurant_id, email)
);

CREATE INDEX idx_staff_user_restaurant ON staff_user (restaurant_id);
