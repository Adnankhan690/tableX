-- payment: one payment attempt against an order (D2).

CREATE TABLE payment (
    id                  SERIAL      PRIMARY KEY,
    uid                 VARCHAR(64) NOT NULL UNIQUE,
    restaurant_id       INTEGER     NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
    order_id            INTEGER     NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    -- upi_static | razorpay | mock | counter
    provider            VARCHAR(32) NOT NULL,
    -- online_upi | counter
    method              VARCHAR(32) NOT NULL,
    amount_minor        BIGINT      NOT NULL,
    currency            VARCHAR(8)  NOT NULL DEFAULT 'INR',
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    -- Gateway identifiers. Null for upi_static and counter, which have no gateway.
    provider_order_id   VARCHAR(128),
    provider_payment_id VARCHAR(128),
    -- The upi://pay?... deep link the diner's UPI app opens, for upi_static.
    upi_intent_url      TEXT,
    -- Our short reference, echoed in the UPI transaction note so a staff member can match
    -- a bank notification to an order by eye. This is the whole reconciliation story for
    -- upi_static (D2).
    reference           VARCHAR(64) NOT NULL,
    -- Verified provider payload, kept verbatim for dispute resolution.
    raw_payload         JSONB,
    paid_at             TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT payment_status_valid  CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    CONSTRAINT payment_method_valid  CHECK (method IN ('online_upi', 'counter')),
    CONSTRAINT payment_amount_valid  CHECK (amount_minor >= 0)
);

CREATE INDEX        idx_payment_order      ON payment (order_id);
CREATE INDEX        idx_payment_restaurant ON payment (restaurant_id, created_at DESC);
CREATE UNIQUE INDEX idx_payment_reference  ON payment (reference);
-- A gateway payment id must map to exactly one payment row, or a replayed webhook could
-- settle two orders.
--
-- The predicate excludes the empty string as well as NULL, and that is load-bearing rather
-- than defensive. Payment.ProviderPaymentID is a Go string, not a pointer, so a provider
-- with no gateway id -- counter, and static UPI -- writes '' and not NULL. With only an
-- IS NOT NULL predicate, every counter payment at a restaurant would share the key
-- ('counter', '') and the second one would be rejected, silently leaving orders with no
-- payment row to settle against.
CREATE UNIQUE INDEX idx_payment_provider_payment
    ON payment (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL AND provider_payment_id <> '';
