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

---

## D13 — A public restaurant directory, and a public restaurant QR

**Context.** The `/qr` gallery in the diner app shows one scannable code per restaurant. It runs
before any session exists, so it has no credentials of any kind — which means the two things it
needs must be reachable unauthenticated, or the page cannot exist.

**Decision.** Two public endpoints:

| | |
| --- | --- |
| `GET /api/public/v1/restaurants` | Active restaurants: uid, name, slug, description, logo, address, phone, currency |
| `GET /api/public/v1/r/:slug/qr` | That restaurant's QR, encoding `{diner_base_url}/r/{slug}` |

**Why this is safe, precisely.** The distinction that matters is between a *name* and a
*capability*.

A **table** QR embeds `qr_token`, and possession of that token is what authorises ordering at that
table ([D4](#d4--per-table-qr-with-a-restaurant-level-fallback)). It is a capability, so its
endpoint is staff-only and the token never appears in a public response.

A **restaurant** QR embeds only the slug — which is already visible in the address bar of the page
it opens, and which the diner-facing `/r/:slug` route has always served to anonymous callers. There
is nothing in it to keep secret.

Both endpoints return `RestaurantSummary`, never `RestaurantSettings`. That is structural rather
than careful: the summary type has no field for the UPI VPA, the GST number or the tax
configuration, so those cannot leak here by someone adding a column to the model.

**What this does change**, stated plainly rather than waved past: the directory makes the tenant
list **enumerable**. Anyone can ask which restaurants are on the deployment. That is a new fact
about the platform, even though it is not a new class of information about any one restaurant. For
a platform whose whole premise is diners walking in and scanning a code, a directory is closer to a
feature than a leak — but a white-label deployment, where tenants must not know about each other,
would want this endpoint behind auth or removed. It is one route and one service method, so that is
a small change.

Both routes are rate limited. Rendering a QR is CPU work, and an unthrottled loop over it is a
cheap way to spend the server's cycles.

**Reversal cost.** Low, in both directions.

---

## D14 — Restaurant onboarding is an operator action, behind its own trust level

**Not a PRD question.** The PRD assumes restaurants exist. Nothing in it says how one gets
onto the platform, and until now nothing did: the only restaurants that existed were the two
in `backend/seeds/local_seed.sql`, and adding a third meant writing SQL by hand.

**Decision.** A fourth route group, `/api/platform/v1`, authorised by a **shared secret** in
the deployment's environment (`TABLEX_PLATFORM_TOKEN`). `POST /restaurants` creates the
restaurant, its first owner login and optionally its floor of tables in **one transaction**.
Absent a configured token, **the group is not mounted at all** — onboarding answers 404, not
401.

Two things were considered and rejected.

**A role on a staff token.** The obvious-looking option, and it is the one that breaks
[D3](#d3--multi-tenant-data-model-single-restaurant-admin-scope). A staff JWT carries exactly
one `restaurant_id`, by design, so there is no principal in the tenant model that can describe
someone acting across all of them. Inventing an `is_platform_admin` claim would put tenant
creation one wrongly-set flag away from every restaurant owner's token — and the flag would
live on a row that restaurant owners can already edit through `PATCH /staff/:uid`. The shared
secret belongs to no account, which is precisely why it is safer here.

**Public self-serve signup.** Rejected for v1, and not because it is hard. A restaurant is a
tenant root, and an anonymous endpoint that mints one is an unauthenticated writer of unbounded
rows, a way to squat every desirable `/r/{slug}`, and a way to fill the public directory
([D13](#d13--a-public-restaurant-directory-and-a-public-restaurant-qr)) with junk that real
diners see. A platform whose premise is walk-in diners scanning codes cannot have a tenant list
anyone can pollute. The seam for adding it later is already the right shape — one more route on
this group, or a signup mode on the config — so this is a decision that can be revisited
without moving anything.

**Why one call and one transaction.** The three writes are useless apart. A restaurant with no
owner cannot be signed into; an owner with no restaurant is an orphan row. A half-onboarded
tenant is not a state a retry fixes — it needs direct database access to unpick — so the
service validates everything *before* opening the transaction, and the transaction then only
writes.

**The owner email check is a correctness requirement, not a nicety.** `staff_user` is unique on
`(restaurant_id, email)`, so the database would happily accept the same address at a second
restaurant. Login would not: it refuses an address matching more than one staff row rather than
guessing which restaurant was meant. Onboarding an owner whose email already exists elsewhere
would therefore create an account that **can never sign in anywhere**. Onboarding refuses it up
front with `TX_AUT_007`.

**What onboarding does not do:** create a menu. A freshly onboarded restaurant renders an empty
diner page until its owner adds categories and items. That is correct — a menu is the
restaurant's content, not the platform's — but it does mean onboarding alone does not make a
restaurant able to take orders, and both the API docs and the handover screen say so.

**Also not done:** suspending or reactivating a restaurant. `EntityStatus` already has
`inactive`, and every read path already refuses an inactive restaurant, so the data model is
ready; there is simply no endpoint that sets it. That is a deliberate omission rather than an
oversight — suspension is a policy question (what happens to live orders? to printed QR codes?)
that deserves its own decision.

**Reversal cost.** Low. One route group, one middleware, one service. Removing it leaves the
schema untouched and puts restaurant creation back in SQL.

---

## D15 — Dish photos are uploaded to our own object storage, on Cloudflare R2

**Not a PRD question.** `menu_item.image_url` has existed since the first migration, but
nothing ever wrote to it except a manager pasting a URL from a site the restaurant already
ran. A restaurant with no website — which is most of the target market — had no way to put a
photograph on a dish at all.

**Decision.** A restaurant uploads a photograph from the admin panel. The bytes are held in
this deployment's own bucket, and three routes carry it:

| | |
| --- | --- |
| `POST /menu/items/:uid/image/upload` | Mints a presigned URL. Changes nothing. |
| `POST /menu/items/:uid/image` | Attaches a finished upload, after inspecting it. |
| `DELETE /menu/items/:uid/image` | Clears the photo and deletes the object. |

### Why R2, and why the S3 client is not a mistake

**Egress.** A menu is the hottest read in the product and a photo-heavy one is almost
entirely image bytes. R2 charges nothing for egress — not in the free tier, not after it —
while S3 and Google Cloud Storage bill roughly $0.09–$0.12/GB. At the scale this platform is
built for the storage and request charges round to nothing on any provider; bandwidth is the
only line that grows with success, and on R2 it does not exist. The free allowance (10 GB
stored, 1M writes, 10M reads per month) covers a deployment of this size several times over.

**`internal/storage/r2.go` imports `github.com/aws/aws-sdk-go-v2/service/s3`, and that is the
R2 integration, not a leftover from an S3 one.** R2 publishes no Go SDK; its documented
interface is the S3 HTTP API. The package is a protocol client pointed at
`{account_id}.r2.cloudflarestorage.com` with credentials issued by the Cloudflare dashboard —
the same relationship as using a Postgres driver to talk to CockroachDB. No AWS account,
bucket, region or bill exists anywhere in this path, and AWS credentials will not work.

### The upload is two calls, and that is the safety design

The browser PUTs the file **straight to R2** on a presigned URL. It never passes through the
API, which runs on a 512MB free-tier instance where streaming a 6MB phone photograph would
occupy a request worker for the length of a restaurant's uplink and pay for the bandwidth
twice.

But a presigned URL is issued *before* there is anything to inspect. A signature proves the
client sent the length and content type it promised; it says nothing about whether those
bytes are a photograph. So every check lives on the second call, against the object that
actually landed: it must exist, be non-empty, be within `storage.max_upload_bytes`, and its
**leading bytes must sniff as an accepted image and match the type R2 will serve it as**.
Anything that fails is deleted rather than left in the bucket.

**SVG is refused, permanently.** An SVG is a script-bearing document, and a browser rendering
one from our image host executes it on that host's origin. Every accepted format — JPEG, PNG,
WebP — is an inert raster format. This is the one entry in that list that is a security
decision rather than a product one.

### The key is the mapping, and it is checked

```
menu/{restaurant_uid}/{item_uid}/{image_uid}.{ext}
```

Each segment earns its place. `restaurant_uid` makes tenancy structural — a lifecycle rule
can be scoped to one tenant, and a cross-tenant key is visible by inspection ([D3](#d3--multi-tenant-data-model-single-restaurant-admin-scope)).
`item_uid` is the dish-to-object mapping in both directions. `image_uid` is **fresh on every
upload**, so replacing a photo writes a new key rather than overwriting one — overwriting
would leave every CDN edge and every phone that already fetched the old bytes serving them
against an unchanged URL, which reads as "the upload silently did nothing".

The key comes back from the client on the confirm call, so **being well-formed is not
enough**: both uids in it must match the authenticated actor's restaurant and the dish in the
path. Without that comparison, a well-formed key naming another restaurant is exactly what
would be sent to point one tenant's dish at another tenant's object. That check is a pure
function, `imageKeyBelongsTo`, tested exhaustively without a fixture.

### Two columns, one field on the wire

`image_key` is added **alongside** `image_url`, not in place of it.

- `image_key` set → we host the bytes; the URL is resolved at read time against
  `storage.r2.public_base_url`.
- `image_key` empty → `image_url` is served verbatim, as it always was.

Both collapse into the single `image_url` field the DTOs already carried, so the diner app
did not change at all. Because they are one field to a client, setting `image_url` through
`PATCH /menu/items/:uid` clears `image_key` as well — otherwise pasting a URL over an uploaded
photo would return 200 and change nothing, since the uploaded copy wins. Storing the resolved URL instead would bake today's hostname into
every row and leave nothing to delete the object by — and it would make moving buckets or
putting a new CDN domain in front a migration over the whole table rather than a config edit.
It also means a deployment that **loses** its storage configuration degrades to "dishes have
no photo" rather than "every dish has a broken image", and restoring the configuration
restores the photographs with no data change.

### What was considered and rejected

**Proxying the upload through the API.** Simpler by one round trip, and wrong on the
constraint that actually binds: the API instance has 512MB and spins down when idle, and the
bytes would cost bandwidth on the way in and again on the way out.

**Overwriting a fixed key per dish.** Removes the cleanup path, and breaks caching in a way
that is invisible in development and permanent in production.

**Trusting the declared content type.** It is a form field. The bytes decide.

**A `provider` config flag.** Credential presence is the switch, exactly as it is for the
Razorpay adapter ([D2](#d2--payments-provider-interface-static-upi-as-the-v1-default)). A
boolean that can disagree with the credentials beside it is a third state to debug. A
*partially* filled block fails startup rather than silently disabling uploads — nobody fills
in three of five values on purpose, and silent disabling would let a deploy meant to turn
uploads on report success.

### What this does not do

**No orphan reaper.** An upload that is presigned and PUT but never confirmed leaves an
object nothing references. Replacements and removals delete the old object explicitly, but
that delete is best-effort and runs *after* the database write — deleting first and then
failing the write would leave a row pointing at bytes that no longer exist, which is worse.
The residue is bounded (only authenticated managers can create it, one object at a time) and
the intended sweeper is **an R2 lifecycle rule on the `menu/` prefix**, not a cron job in this
codebase. This is a real gap, stated rather than glossed: without that rule configured,
abandoned uploads accumulate slowly and forever.

**No realtime event.** A sold-out toggle publishes to open diner menus; a new photograph does
not. Photos are not time-critical the way availability is, and diners pick it up on the next
load.

**No narrowing of `images.remotePatterns`.** Both Next apps still allow any https host,
because pasted URLs remain supported and an allowlist would break the menu of every
restaurant using one. The comment in each config now records that narrowing is a one-line
change for a deployment that has moved entirely to uploaded photos.

**Reversal cost.** Low. The routes, the `internal/storage` package and one nullable column.
Dropping it leaves `image_url` working exactly as it did before.


---

## D16 — Dish ratings open on evidence the food arrived, not on staff tapping "served"

**Not a PRD question.** The product had no way for a diner to say whether the food was any
good, and no way for a restaurant to find out which dish was failing.

**Decision.** A diner rates each dish they were served, one tap per dish, from the order
tracking screen. Three routes carry it:

| | |
| --- | --- |
| `PUT /guest/v1/orders/:uid/items/:item_uid/review` | Rate one dish. Idempotent. |
| `GET /admin/v1/reviews` | The feed, filterable by rating, dish, date, has-a-note. |
| `GET /admin/v1/reviews/summary` | Overall score, distribution, and the two ends of the menu. |

### The eligibility rule is the whole design, and it is not `status == 'served'`

The obvious rule — reviewable once the order reaches `served` — makes the diner's ability to
rate depend on a staff member tapping a button *after* the food has already left the pass. In
a real kitchen mid-service that tap is the first thing to go: the order is marked ready, the
runner takes the plates, and nobody walks back to the tablet. Under that rule those diners are
never asked, and **the restaurants with the loosest floor discipline — the ones whose service
most needs measuring — collect the least feedback.** The rule quietly selects against itself.

So eligibility is derived from several independent signals, and **the earliest one to fire
wins**:

| Signal | Why it is evidence |
| --- | --- |
| `served_at` / `completed_at` | The explicit tap. Instant, and the happy path. |
| A settled **counter** payment | The diner paid on the way out, so the meal is over. |
| `ready_at` + 10 min | Plated, and the kitchen stopped tapping. The commonest real gap. |
| `accepted_at` + 45 min | The kitchen stopped tapping much earlier. The backstop. |

Earliest rather than latest, because these are alternative pieces of evidence for one event
rather than stages of it. Taking the maximum would make a diligent restaurant that taps every
status wait out the same 45-minute backstop as one that taps none, which is precisely
backwards.

**A settled payment counts only for `payment_method = counter`.** An `online_upi` order is paid
at checkout, *before* the food is cooked, so there "paid" carries no information about whether
it ever arrived. Treating it as evidence would ask a diner to rate a dish nobody has started —
the single worst failure this feature can have, since a rating collected that way describes
anticipation rather than a meal.

**Two states never become reviewable, however long they sit.** `placed`, because the kitchen
has not acknowledged the order and no elapsed time proves anything; and `cancelled`/`rejected`,
because no food was served. An order whose every line was individually voided is excluded for
the same reason.

The window closes 24 hours after placement. A rating left the next morning is a memory rather
than an observation, and leaving it open forever means an old uid keeps a writable endpoint for
the life of the deployment.

All of this lives in `services.ReviewEligibilityFor` and reaches the client as `can_review`,
`review_opens_at` and `review_closes_at` on `OrderView` — the same pattern as `can_guest_cancel`
([D6](./DECISIONS.md)). **The client renders the card from that flag and must not re-derive it.**

### One tap is the entire interaction

`PUT`, not `POST`, and the verb is the product decision showing through: there is no Submit
button anywhere in the flow, so every tap has to be safe to repeat. A double-tap on a stalled
phone and a genuine correction from four stars to five take the same path and land on the same
row, guaranteed by a unique index on `order_item_id` rather than by an idempotency key — this
endpoint cannot create a second row in the first place.

`rating` is the only required field. Tags come from a **closed vocabulary** and a note is capped
at 280 characters; both are optional, and a diner who supplies neither has still submitted a
complete review. The vocabulary is polarity-matched to the rating on the client, because
offering "Tasty" to someone who just tapped one star reads as not listening.

Free text was rejected as the primary input. Typing on a phone in a restaurant is the step
people abandon, and prose is not countable: *"9 people said cold this week"* is a service
problem with an address, where nine sentences are an afternoon of reading. An unrecognised tag
is a **422 rather than a silent drop** — the value of a fixed vocabulary is that every stored
tag can be counted, and quietly discarding a typo produces a bucket nobody looks in.

### Identity is the order line, and the aggregate is denormalised

A review belongs to an `order_item`, not to a `menu_item`. The same dish ordered on two nights
is two ratings, because it was two platings; collapsing them would let a dish that has got worse
hide behind the night it was good.

`menu_item.rating_count` and `rating_sum` carry the running aggregate — **the one denormalised
pair in this schema.** The diner menu is the hottest read in the product (PRD 7 makes its
latency a requirement), and the honest alternative is a `GROUP BY` over every review ever left,
which gets steadily worse for exactly the restaurants that succeed. Sum and count rather than a
stored average, because an average is lossy, is a float in a schema that has none, and cannot be
updated without a read-modify-write — which loses one of two concurrent ratings silently. Both
move by delta inside the review transaction, in SQL. `scripts/concurrency.sh` §D fires eight
simultaneous ratings at one dish and asserts the counters still equal the rows.

**Diners see no score below three ratings; staff see every one.** A "5.0" from a single tap is
not a smaller truth — it ranks an untried dish above one with forty ratings averaging 4.6, and
the next diner to leave a 3 visibly halves it. Staff are owed the underlying data instead.

### How the score is shown on the menu

The menu leads with a **Most loved** strip: the three highest-rated dishes, above the categories and
never a re-sort of them. Re-sorting would throw away the restaurant's own `sort_order`, which is a
decision a manager made and is what a diner sees as the menu's arrangement.

It is computed from the menu **already in memory**. The whole menu arrives in one response (PRD 7),
so asking the server for a ranking it could only build from the same rows would add a round trip to
the screen whose latency is a product requirement. Three rules keep it honest: a dish must clear
`MIN_RATINGS_TO_PUBLISH`, must average at least 4 (without a floor the section quietly becomes
"least bad"), and must be available — leading with a dish the kitchen has run out of is the one
recommendation guaranteed to disappoint. It is hidden entirely during a search, where a diner is
seeking rather than browsing.

**The rating count is revealed on hover, and only where hovering exists.** The score is what a diner
scans for; the count is what they check before trusting it, and showing both at full weight on every
row makes a long menu noisier without making any dish clearer. The reveal is gated on
`(hover: hover) and (pointer: fine)` in CSS rather than on Tailwind's `hover:` variant — that
variant compiles to `:hover`, which a touch browser fires on tap and then leaves stuck. On touch the
count is simply always visible: this app is mobile-first by mandate, and a fact hidden behind an
interaction the device cannot perform is a fact nobody gets.

**Reversal cost.** Low. Two tables' worth of migration (one new table, two columns), three
routes, and one card on the tracking screen. Dropping it leaves every existing screen unchanged.

---

## D17 — Service is rated separately from food, once per sitting

**Not a PRD question.** [D16](./DECISIONS.md) gave diners a way to rate each dish. It left the
half of a restaurant that is not the kitchen entirely unmeasured, and — worse — gave that
feedback nowhere to go but the dish ratings.

The evidence was already in the schema. The dish tag vocabulary shipped with `slow_to_arrive`,
and that tag is wrong by construction: a diner tapping it is reporting a floor problem, but the
row records it against a dish. Being late was also the sort of thing that earns two stars, and
those two stars landed on the biryani's average in the menu manager. The only outlet a diner had
for a service complaint was one that blamed the food.

**Decision.** A separate service rating, on its own scale, with its own vocabulary.

| | |
| --- | --- |
| `PUT /guest/v1/orders/:uid/service-review` | Rate the service. Idempotent, session-scoped. |
| `GET /admin/v1/reviews/service` | The service feed. |
| `GET /admin/v1/reviews/summary` | Now returns **`food` and `service`**, never one blended score. |

`slow_to_arrive` is removed from the dish vocabulary. Removing it is *not* the fix and should not
be mistaken for one — the fix is that there is now somewhere else to say it. Dropping the tag only
stops inviting a floor complaint in a food context.

### Why not "rate the restaurant"

**A blended number is a vanity metric.** "You are a 3.8" gives a manager nothing to do on Monday.
**Food 4.6 / Service 3.2** names two different teams and two different fixes, and a single average
destroys that separation by construction. So the API returns two numbers and the admin panel shows
two cards; there is deliberately no endpoint anywhere that returns one score for a restaurant.

**There is no discovery value in this product.** A place rating on Zomato exists to help someone
*choose* a restaurant. This diner has already chosen — they scanned a QR at the table and have
finished eating. The only surfaces a public score could appear on are `/qr` and `/r/{slug}`, a dev
gallery and a fallback table-picker. It would be a number attached to no decision.

**Free-text restaurant reviews were rejected.** They are the abandonment path the one-tap contract
exists to avoid, they are unmoderatable with no identity behind them ([D5](./DECISIONS.md)), and
Google and Zomato already do them better precisely *because* they have real accounts and public
accountability.

### Once per sitting, which is why the write is keyed to the session

Service is experienced once per sitting, not once per order: a diner who ordered twice has not been
served by two different restaurants. So `service_review` is `UNIQUE (guest_session_id)`, and a diner
with two open orders sees the same answer pre-filled on both — editing either updates the one row.

That also dissolves a question that looks hard: *which order do we ask on?* None of them. The
question is not about an order.

**The order in the URL is the warrant, not the subject.** It establishes two things and nothing
else: that this session owns something here, and that the review window is open. Ownership goes
through the *same* `loadGuestOrder` the dish path uses, so "is this order yours" has one definition
rather than two that can drift ([D4](./DECISIONS.md)).

`guest_session_id` is **nullable, with `ON DELETE SET NULL`**, and that is load-bearing rather than
incidental. `RepositoryGuestSessionMethods.DeleteExpired` reaps sessions whose tokens can no longer
authenticate; cascading would make every prune a silent deletion of a night's service feedback. The
uniqueness therefore constrains only live sessions, which is exactly the right scope — a session can
only be written to while it is alive, because holding it is the whole authentication.

### The window is unchanged, and so is the card

Eligibility reuses `services.ReviewEligibilityFor` untouched. There is no `can_review_service` flag,
because it and `can_review` would only ever disagree by accident.

On the diner screen the service row is the **last** row of the card that already exists, never the
first. Above the dishes it would cannibalise them: a general question is easier to answer than five
specific ones, so some diners would answer it and stop — and the per-dish ratings are the half a
kitchen can act on. After them it is purely additive, one more tap from someone already engaged.

### No denormalised aggregate, and the asymmetry is the point

[D16](./DECISIONS.md) put running counters on `menu_item` because the diner menu is the hottest read
in the product. Service has none: its average is read on one admin screen, a few times a shift, over
one tenant's rows behind an index. Denormalising it would buy nothing and cost the reconciliation
burden and the lost-update hazard that counters bring. **A counter is a cost, and it is only worth
paying on a hot path.**

**Reversal cost.** Low. One table, three routes, one row on the diner card and one chip group in the
admin panel. Dropping it leaves the dish ratings exactly as they were, minus one tag.
