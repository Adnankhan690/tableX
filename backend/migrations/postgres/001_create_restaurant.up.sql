-- restaurant: the tenant root. Every tenant-owned row carries restaurant_id (DECISIONS.md D3).

CREATE TABLE restaurant (
    id                     SERIAL       PRIMARY KEY,
    uid                    VARCHAR(64)  NOT NULL UNIQUE,
    name                   VARCHAR(128) NOT NULL,
    -- slug appears in the restaurant-level fallback QR URL: /r/{slug} (D4).
    slug                   VARCHAR(64)  NOT NULL UNIQUE,
    description            TEXT,
    logo_url               TEXT,
    address                TEXT,
    phone                  VARCHAR(20),
    currency               VARCHAR(8)   NOT NULL DEFAULT 'INR',
    timezone               VARCHAR(64)  NOT NULL DEFAULT 'Asia/Kolkata',
    gst_number             VARCHAR(20),
    -- Rates are basis points, not NUMERIC: 500 = 5.00%. Keeps every money computation
    -- in integer arithmetic end to end (D7).
    tax_bps                INTEGER      NOT NULL DEFAULT 500,
    service_charge_bps     INTEGER      NOT NULL DEFAULT 0,
    -- Static-UPI payee details. Null when the restaurant uses a gateway instead (D2).
    upi_vpa                VARCHAR(128),
    upi_payee_name         VARCHAR(128),
    payment_provider       VARCHAR(32)  NOT NULL DEFAULT 'upi_static',
    status                 VARCHAR(32)  NOT NULL DEFAULT 'active',
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT restaurant_tax_bps_range            CHECK (tax_bps BETWEEN 0 AND 10000),
    CONSTRAINT restaurant_service_charge_bps_range CHECK (service_charge_bps BETWEEN 0 AND 10000)
);

CREATE INDEX idx_restaurant_status ON restaurant (status);
