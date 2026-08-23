# Decision Record

Resolutions for the open questions in [PRD.md](./PRD.md) §9, plus the design calls that
follow from them. Each entry states the decision, the reasoning, and what it costs to
reverse later — so a v2 conversation can reopen one without re-deriving the context.

Status: accepted for v1. Owner: Adnan.

---

## D1 — Order lifecycle: full state machine, not just Placed → Accepted

**PRD §9.1:** *"What happens after Accept — does admin need further controls?"*

**Decision.** Ship the complete lifecycle with an explicit, enforced state machine:

```
placed ──► accepted ──► preparing ──► ready ──► served ──► completed
  │            │             │
  ├──► rejected│             │
  └──► cancelled ◄───────────┘
```

Terminal states: `completed`, `rejected`, `cancelled`.

| Transition | Who may trigger it |
| --- | --- |
| `placed → accepted` | staff |
| `placed → rejected` | staff (requires a reason) |
| `placed → cancelled` | **guest** or staff |
| `accepted → preparing` | staff |
| `preparing → ready` | staff |
| `ready → served` | staff |
| `served → completed` | staff (also auto-completes when payment settles) |
| `accepted/preparing → cancelled` | staff only (requires a reason) |

**Why.** The PRD's minimum is Placed and Accepted, but the metric it wants to move is
*order throughput per hour* — which is unmeasurable if the order stops emitting events
after Accept. `preparing`/`ready` are also the two states a diner actually cares about;
without them the tracking screen sits on "Accepted" for fifteen minutes and the diner
asks a waiter anyway, defeating the whole feature.

The state machine lives in one place ([backend/internal/services/order_state.go](../backend/internal/services/order_state.go))
and every transition is validated against it. Illegal transitions are rejected with a
`409`, never silently applied — this is what stops two staff phones from double-accepting.

**Reversal cost.** Low. Dropping states means not rendering them; the enum tolerates unused values.

---

## D2 — Payments: provider interface, static UPI as the v1 default

**PRD §9.2:** *"Is Pay via QR a single restaurant UPI ID, or does it need a gateway?"*

**Decision.** Both, behind one interface — `payments.Provider`
([backend/internal/payments/provider.go](../backend/internal/payments/provider.go)):

```go
type Provider interface {
    Name() string
    CreateIntent(ctx context.Context, in IntentInput) (*Intent, error)
    VerifyWebhook(ctx context.Context, raw []byte, headers map[string]string) (*WebhookEvent, error)
    Capabilities() Capabilities
}
```

Three implementations ship:

| Provider | v1 status | What it does |
| --- | --- | --- |
| `upi_static` | **default** | Builds a `upi://pay?pa=…&am=…&tr=…` intent URL from the restaurant's VPA. Zero integration, zero fees, works the day you deploy. No automatic confirmation — staff marks payment received. |
| `razorpay` | adapter present, credentials-gated | Real order creation + HMAC-verified webhooks + automatic reconciliation. |
| `mock` | tests only | Deterministic success/failure for the test suite and local dev. |

**Why.** Requiring a gateway before v1 can ship is the wrong trade for a first
restaurant — KYC and onboarding take longer than building this whole platform, and a
static UPI QR is what the target market already uses at the counter. But hard-coding
static UPI would make reconciliation impossible forever, so the seam goes in on day one
while it is free to add.

The honest limitation, stated plainly: **`upi_static` cannot confirm that money arrived.**
The diner sees "awaiting confirmation" and a staff member taps *Mark paid*. That is a
trust-the-staff flow, identical to how cash works today, and it is why `razorpay` exists
in the same interface for restaurants that need real reconciliation.

Webhook idempotency is enforced by a unique `(provider, event_id)` row in
`payment_webhook_event` — a replayed webhook is recorded and ignored, never double-applied.

**Reversal cost.** Low. Adding a provider is one file plus a config value.

---

## D3 — Multi-tenant data model, single-restaurant admin scope

**PRD §9.3:** *"Is this multi-restaurant or single-restaurant?"* — flagged in the PRD as
significantly affecting the data model.

**Decision.** The **data model is multi-tenant from the first migration**: every
tenant-owned table carries `restaurant_id`, and every query is scoped by it. But
**admin auth is single-restaurant**: a staff user belongs to exactly one restaurant and
a JWT carries exactly one `restaurant_id`.

**Why.** These two halves of the question have opposite answers, and that is the whole
point. Retrofitting `restaurant_id` onto a live schema is the single most expensive
migration in this design — it touches every table, every index, every query, and every
cached response, and it has to happen while real orders are flowing. Adding it now costs
one column per table and nothing else.

Cross-restaurant *admin* features (franchise dashboards, one login for many outlets) are
explicitly out of scope per PRD §8, so the auth layer stays simple: one token, one
restaurant, scope enforced in middleware rather than remembered in each handler.

The upgrade path is therefore additive — a `staff_restaurant` join table and a
restaurant-picker claim in the JWT — with **no data migration at all**.

**Reversal cost.** Effectively zero, and this is the decision most expensive to get wrong
in the other direction. Chosen deliberately as the asymmetric bet.

---

## D4 — Per-table QR, with a restaurant-level fallback

**PRD §9.4:** *"Does each table need a distinct QR, or is one QR per restaurant with manual entry acceptable?"*

**Decision.** Per-table QR is the primary path, as PRD §6.1 requires. A restaurant-level
QR also works and lands the diner on a table picker.

QR payload is an **opaque rotatable token**, not a table id:

```
https://order.example.com/t/{qr_token}        ← per table  (qr_token is 32 random chars)
https://order.example.com/r/{restaurant_slug} ← per restaurant, diner picks the table
```

**Why opaque.** `…/t/17` invites a diner to try `…/t/18` and order onto someone else's
table — and it leaks how many tables the restaurant has. A random token removes both,
and being rotatable means a QR sticker photographed and posted online can be invalidated
by regenerating one row rather than reprinting the whole floor.

**Why keep the fallback.** Table QRs get peeled off, spilled on, and swapped between
tables. A restaurant-level QR taped to the counter is the recovery path that keeps the
restaurant taking orders on a bad night, and it costs one extra route.

**Reversal cost.** Low.

---

## D5 — Guest sessions: anonymous, persistent, no login

**PRD §9.5:** *"Any requirement for customer order history, or is each session stateless?"*

**Decision.** A `guest_session` row is created on first QR scan and its opaque token is
held in the diner's browser (`localStorage`). Orders are attached to that session, so the
diner sees **every order they placed at this table in this sitting** — which covers the
realistic case (a table orders three times over a meal) without any login.

Session lifetime: **12 hours**, then expired by the token's `expires_at`.

**Explicitly not built:** cross-visit history, since that requires identifying the person,
which requires login or a phone number, which reintroduces exactly the friction PRD §6.1
removes. Phone number stays an *optional* field for the restaurant to call the diner back.

**Why 12 hours and not shorter.** A session that expires mid-meal loses the diner their
order tracking screen, which is the one screen they were promised. 12 hours covers any
sitting and still bounds the row's usefulness if the token leaks.

**Reversal cost.** Low. Longer-lived identity is additive.

---

## D6 — Guests may cancel only before Accept

**PRD §9.6:** *"Should customers be able to edit/cancel an order after placing it but before it's accepted?"*

**Decision.** **Cancel: yes, while `status = placed`.** Once staff accepts, the kitchen may
have started and the guest's cancel button returns `409`, with the UI replacing it with
"ask staff to cancel".

**Edit: no.** A guest who wants different food places a second order.

**Why cancel but not edit.** These look symmetric and are not. Cancel is one state
transition guarded by one condition. Edit means re-pricing a partially-prepared order,
reconciling an already-authorised payment against a new total, and re-rendering a ticket
the kitchen may have already read — for a case that a second order solves completely.
The PRD's own metric here is *"% of orders modified/cancelled after placement"*, i.e.
modification is the thing being minimised, not a feature being requested.

The race is real and handled: cancel and accept can arrive in the same instant. Both take
a row lock on the order and re-read status inside the transaction, so exactly one wins and
the loser gets a `409`.

**Reversal cost.** Medium — edit would need order versioning. Deliberately deferred.

---

## Design decisions not in the PRD

### D7 — Money is integer paise, never a float

Every amount is `BIGINT` in the database and `int64` in Go, named `*_minor`. No `float64`
touches a price anywhere in the stack. `₹249.50` is `24950`.

Floating-point money accumulates rounding error that shows up as a bill that is one paisa
off, and a diner who spots a wrong total stops trusting the platform — which the PRD names
as core ("Reliability", §7). Integer minor units make the arithmetic exact. Formatting to
`₹` happens once, at the display edge.

### D8 — Order lines snapshot name, price and food type

`order_item` stores `name_snapshot`, `unit_price_minor` and `food_type` copied at order
time, not joined live from `menu_item`.

A restaurant that raises paneer tikka from ₹220 to ₹240 at 8pm must not silently rewrite
the total of an order placed at 7:45pm — and a dish that gets renamed must still read
correctly on last month's order. The `menu_item_id` foreign key is retained for analytics.

### D9 — Order numbers are per-restaurant, per-day, human-sized

`order_number` is a short daily counter (`A-014`), allocated under a row lock on
`order_counter`, not a UUID.

Staff shout order numbers across a kitchen. `ord_8f3a…` is unusable out loud. The UID
(`ord_…`) remains the API identifier; the number is for humans.

### D10 — Realtime is WebSocket with a polling fallback

A WebSocket hub broadcasts to two topic kinds — `restaurant:{id}` (admin, new orders) and
`order:{uid}` (diner, status changes). The client hook falls back to 5-second polling when
the socket cannot connect.

Restaurant wifi and Indian mobile networks drop connections and some proxies eat
long-lived upgrades. The PRD requires the tracking screen to "auto-update or be
refreshable"; polling satisfies that requirement on its own, so the socket is an
optimisation on a working baseline rather than a dependency. **No order state is
transmitted only over the socket** — every message is a hint to refetch authoritative
state, so a dropped frame can never leave the two sides disagreeing.

### D11 — Two frontend apps, not one with route groups

`apps/diner` and `apps/admin` are separate Next.js applications sharing
`packages/shared` and `packages/ui`.

The diner app is public, anonymous, and must load fast on 3G (PRD §7) — it should ship no
admin authentication code, no data tables, and no charting library, and "Next.js splits by
route anyway" is a weaker guarantee than "that code is not in the build". They also scale
oppositely: diner traffic spikes at dinner service, admin traffic is a handful of tablets.

### D12 — Idempotent order placement

`POST /orders` accepts an `Idempotency-Key` header, stored as a unique
`(restaurant_id, idempotency_key)` pair. A retry returns the original order instead of
creating a second one.

PRD §7 makes not losing orders a core trust requirement. The failure that actually happens
on a phone is the *opposite* — the diner taps "Place order" on a stalled connection, taps
again, and the kitchen gets two. Both directions are covered: the write is committed in one
transaction before the response, and the retry is deduplicated.
