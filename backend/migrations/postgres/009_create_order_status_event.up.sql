-- order_status_event: append-only transition log.
--
-- Two jobs. It renders the diner's timeline ("Accepted 19:42, Preparing 19:44"), and it
-- answers "who cancelled table 7's order" after the fact. Append-only by convention:
-- nothing in the application updates or deletes a row here.

CREATE TABLE order_status_event (
    id          BIGSERIAL   PRIMARY KEY,
    order_id    INTEGER     NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    -- NULL on the first event, where the order came into existence at 'placed'.
    from_status VARCHAR(32),
    to_status   VARCHAR(32) NOT NULL,
    -- guest | staff | system. 'system' covers payment webhooks auto-completing an order.
    actor_type  VARCHAR(16) NOT NULL,
    -- The actor's uid (stf_... or gst_...), stored as text so one column serves both.
    actor_id    VARCHAR(64),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT order_status_event_actor_valid CHECK (actor_type IN ('guest', 'staff', 'system'))
);

CREATE INDEX idx_order_status_event_order ON order_status_event (order_id, created_at);
