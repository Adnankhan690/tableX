-- demo_request: a restaurant owner asking to be shown the product.

-- The first row this application writes that is not about a restaurant already using it. Every
-- other table hangs off restaurant_id; this one deliberately does not, because the whole point of
-- the row is that the tenant does not exist yet. Nothing here references restaurant, and nothing
-- in the ordering flow references this -- onboarding is a human conversation that ends in a
-- platform call (DECISIONS.md D14), and joining the two would imply an automatic path that does
-- not exist.
CREATE TABLE demo_request (
    id              SERIAL      PRIMARY KEY,
    uid             VARCHAR(64) NOT NULL UNIQUE,

    name            VARCHAR(128) NOT NULL,
    restaurant_name VARCHAR(160) NOT NULL,

    -- Ten digits, no country code, normalised before it ever reaches here. Stored in one
    -- canonical form precisely so the UNIQUE below means what it says: "+91 98765 43210",
    -- "098765 43210" and "9876543210" are one restaurant asking once, not three leads.
    phone           VARCHAR(10)  NOT NULL,
    -- Optional, and NOT unique. Two partners at the same restaurant share an address far more
    -- often than they share a mobile, and the phone is what the callback actually uses.
    email           VARCHAR(255) NOT NULL DEFAULT '',

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- ONE DEMO PER NUMBER, enforced here rather than only in the service.
    --
    -- The service checks first so the caller gets a sentence instead of a 500, but the check and
    -- the insert are two statements: two taps on a slow connection can interleave between them,
    -- and this landing page is public and unauthenticated, so the concurrent case is a stranger
    -- with a loop rather than a hypothetical. The constraint is what actually holds the rule; the
    -- service's lookup is what makes the ordinary case polite.
    CONSTRAINT demo_request_phone_key UNIQUE (phone),

    -- Indian mobile: ten digits opening 6-9. Mirrors the same rule in the service and in the
    -- landing page's form, and it is the last of the three that cannot be bypassed -- the route
    -- is public, so "the browser validated it" is not a claim this table can rely on.
    CONSTRAINT demo_request_phone_shape CHECK (phone ~ '^[6-9][0-9]{9}$')
);

-- The operator's list: newest first, which is the only way anyone reads a lead queue.
CREATE INDEX idx_demo_request_created ON demo_request (created_at DESC);
