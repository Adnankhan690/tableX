-- payment_webhook_event: the webhook idempotency ledger.
--
-- Gateways retry aggressively and deliver duplicates as a matter of course. Inserting the
-- event id here is the guard: the unique constraint makes the second delivery of the same
-- event fail to insert, and the handler treats that failure as "already handled" rather
-- than settling the order twice (D2).

CREATE TABLE payment_webhook_event (
    id           BIGSERIAL    PRIMARY KEY,
    provider     VARCHAR(32)  NOT NULL,
    -- The provider's own event identifier, whatever it calls it.
    event_id     VARCHAR(128) NOT NULL,
    event_type   VARCHAR(64),
    -- Nullable: a webhook can arrive naming a payment we have never heard of, and that
    -- fact is worth recording rather than dropping.
    payment_id   INTEGER      REFERENCES payment (id) ON DELETE SET NULL,
    payload      JSONB        NOT NULL,
    signature_ok BOOLEAN      NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error        TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT payment_webhook_event_key UNIQUE (provider, event_id)
);

CREATE INDEX idx_payment_webhook_event_payment ON payment_webhook_event (payment_id);
