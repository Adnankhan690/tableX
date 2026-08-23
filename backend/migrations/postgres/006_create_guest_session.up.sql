-- guest_session: anonymous diner identity, created on first QR scan. No login (D5).

CREATE TABLE guest_session (
    id            SERIAL       PRIMARY KEY,
    uid           VARCHAR(64)  NOT NULL UNIQUE,
    restaurant_id INTEGER      NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    table_id      INTEGER      NOT NULL REFERENCES restaurant_table (id) ON DELETE CASCADE,
    -- Opaque bearer token held in the diner's localStorage. This is the only thing
    -- standing between a stranger and someone else's order, so it is long and random.
    token         VARCHAR(128) NOT NULL UNIQUE,
    user_agent    TEXT,
    expires_at    TIMESTAMPTZ  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guest_session_table   ON guest_session (table_id);
CREATE INDEX idx_guest_session_expires ON guest_session (expires_at);
