# API reference

Base URL in development: `http://localhost:8080`.

Four route groups, four trust levels. The prefix a route sits under *is* the statement of who
may call it, so nothing is mounted outside one of them.

| Group | Prefix | Credential | Scope |
| --- | --- | --- | --- |
| Public | `/api/public/v1` | none, rate limited | — |
| Guest | `/api/guest/v1` | `X-Guest-Token: <token>` | one table, one sitting |
| Admin | `/api/admin/v1` | `Authorization: Bearer <jwt>` | one restaurant |
| Platform | `/api/platform/v1` | `X-Platform-Token: <secret>` | the deployment |

**Platform is not mounted unless the server has a platform token.** Its routes answer **404**, not
401, on a deployment started without `TABLEX_PLATFORM_TOKEN` — a deployment that does not create
tenants over HTTP has no tenant-creating endpoint at all ([D14](./DECISIONS.md)).

## The envelope

Every response has the same shape, success or failure — one parser and one error path on the
client, rather than branching on status codes to decide how to read the body.

```jsonc
// success
{ "code": "00000", "message": "success", "data": { … }, "request_id": "5e2c…" }

// failure
{ "code": "TX_ORD_006", "message": "this order has already moved on, refresh to see its current state", "request_id": "5e2c…" }
```

**Branch on `code`, never on `message`.** Codes are stable; messages are human copy that will be
translated to Hindi (PRD §7), and behaviour must not depend on the app's language. `request_id` is
echoed on every response — a diner can read it off a failure screen and it greps one request out
of a night's logs.

### Error codes

`TX_<AREA>_<NNN>`. Areas: `COM` common, `AUT` staff auth, `SES` guest session, `RST` restaurant,
`TBL` table/QR, `MNU` menu, `ORD` order, `PAY` payment, `REV` rating/review, `IMG` dish photo.

The ones a client must actually handle:

| Code | Status | Meaning and what to do |
| --- | --- | --- |
| `TX_SES_003` | 401 | Guest session expired. Tell the diner to rescan the QR. |
| `TX_TBL_004` | 404 | QR token invalid or rotated. Dead end — point at staff, do not retry. |
| `TX_MNU_018` | 409 | A cart item sold out. Ordinary, not exceptional: send them back to the cart. |
| `TX_RST_007` | 409 | UPI not configured. Offer "pay at counter" rather than failing. |
| `TX_ORD_006` | 409 | Illegal transition — the order moved on. **Refetch, do not retry.** |
| `TX_ORD_007` | 409 | Another device accepted it first. Refetch. |
| `TX_ORD_010` | 409 | Guest cancel window closed. Hide the button. |
| `TX_ORD_015` | 422 | Reject/cancel needs a reason. Collect one and resubmit. |
| `TX_PAY_002` | 409 | Already paid. Refetch; never retry a settlement. |
| `TX_PAY_006` | 409 | Webhook amount ≠ order total. **Never settled.** Needs a human. |
| `TX_AUT_004` | 401 | Access token expired — refresh, distinct from `TX_AUT_003` invalid. |
| `TX_AUT_009` | 401 | Platform token missing or wrong. One code for both; see [D14](./DECISIONS.md). |
| `TX_REV_001` | 409 | Rating window shut — usually *too early*, not forbidden. Refetch and re-read `can_review`; do not alarm the diner. |
| `TX_REV_003` | 422 | Tag outside the vocabulary. A client bug: the set is in `packages/shared/src/review.ts`. |

## Money

Every amount is an integer count of paise, and every amount on the wire carries both halves:

```jsonc
{ "minor": 24950, "currency": "INR", "display": "₹249.50" }
```

Render `display`. Never do currency arithmetic on a server value — `minor` is there for
comparisons and for the one legitimate local computation, a cart preview before submission
([D7](./DECISIONS.md)).

---

## Public

### `GET /t/:qr_token` — scan a table

The first request after a scan, and the one that decides whether the product feels fast. Returns
the session, the table **and the whole menu** in one response ([D4](./DECISIONS.md), PRD §7).

`data`: `{ session: { uid, token, expires_at }, table: { uid, label }, menu: ResponseMenu }`

The session `token` is returned **exactly once**. Store it; every later diner call presents it.

Errors: `TX_TBL_004` unknown/rotated token · `TX_TBL_002` table inactive · `TX_RST_002` restaurant not accepting orders.

### `GET /r/:slug` — restaurant landing (fallback QR)

For the single QR taped to the counter when a table sticker has gone missing
([D4](./DECISIONS.md)). Returns the public summary and active tables — **never** a `qr_token`,
`upi_vpa`, `gst_number` or tax configuration.

### `POST /r/:slug/select-table`

`{ "table_uid": "tbl_…" }` → the same payload as a table scan.

### `GET /restaurants` — directory

Active restaurants, as `RestaurantSummary` only. Backs the `/qr` gallery, which runs before any
session exists and so has no credentials to present ([D13](./DECISIONS.md)).

### `GET /r/:slug/qr?size=320` — restaurant QR

`{ name, slug, qr_url, png_base64 }`, encoding `{diner_base_url}/r/{slug}`.

Public, unlike the per-table QR endpoint, and the difference is the payload rather than the
audience: a table QR embeds an opaque token whose possession authorises ordering at that table,
while this embeds only the slug already visible in the URL it opens ([D4](./DECISIONS.md),
[D13](./DECISIONS.md)). A malformed `size` falls back rather than failing.

### `POST /webhooks/payments/:provider`

Provider callbacks. The **raw request body** is what the HMAC is computed over, so it is never
re-serialised before verification. Order of operations is fixed and load-bearing:

1. Verify the signature — before any parsing or database work. Without this the endpoint is an
   unauthenticated "mark any order paid" API.
2. Insert into the idempotency ledger. A duplicate `(provider, event_id)` returns **200 and does
   nothing** — gateways retry as a matter of course, so a redelivery is the normal path
   ([D2](./DECISIONS.md)).
3. Resolve our payment by reference. Unknown reference → recorded and ignored with 200; a 500
   would make the provider retry forever.
4. Compare the amount. A mismatch is **never settled** — an underpayment silently marked paid is
   money the restaurant loses without finding out.
5. Apply.

Not rate limited: throttling a gateway into giving up loses payment confirmations, which is worse
than serving the requests. Its protection is the signature check.

### `GET /health/live` · `GET /health/ready`

`live` checks nothing but the process. Deliberately: a liveness probe that fails on a database
blip gets every pod killed and restarted, turning a recoverable outage into a total one.
`ready` pings the database and returns 503 when it cannot serve — which removes the instance from
the load balancer without killing it.

---

## Guest

All require `X-Guest-Token`. Every order read verifies the session owns the order; a mismatch is
**404, not 403**, so an order's existence cannot be probed.

| | |
| --- | --- |
| `GET /menu` | The menu for this session's restaurant. Scope comes from the token, never the request. |
| `POST /orders` | Place an order. See below. |
| `GET /orders` | Orders from this session — "this table, this sitting" ([D5](./DECISIONS.md)). |
| `GET /orders/:uid` | One order, with its timeline. |
| `POST /orders/:uid/cancel` | Withdraw, only while `placed` ([D6](./DECISIONS.md)). |
| `POST /orders/:uid/payment` | Start or restart a payment. |
| `GET /orders/:uid/payment` | Poll payment **and** order status in one request. |
| `PUT /orders/:uid/items/:item_uid/review` | Rate one dish ([D16](./DECISIONS.md)). See below. |
| `GET /orders/:uid/stream` | WebSocket. See *Realtime*. |

### `POST /orders`

```jsonc
// Headers: X-Guest-Token, Idempotency-Key
{
  "items": [{ "menu_item_uid": "itm_…", "quantity": 2, "note": "extra garlic" }],
  "payment_method": "counter",         // or "online_upi"
  "customer_name": "Anita",            // optional
  "customer_phone": "9876543210",      // optional — reachability, not identity
  "note": "less spicy"                 // optional
}
```

**There is no amount field, by design.** The server prices the cart from the live menu; a
client-supplied total would let a diner order a thali for one rupee.

`Idempotency-Key` is strongly recommended and must be **generated once per cart and reused for
every retry of that same order**. A fresh key per attempt defeats the mechanism entirely. All
concurrent duplicates resolve to the same order and return 201 ([D12](./DECISIONS.md)).

Also handled: duplicate lines for the same item are merged rather than rejected, since tapping
"+" twice is not a mistake.

`data`: `{ order: OrderView, payment?: PaymentView }`

### `OrderView`, and the two fields that matter most

```jsonc
{
  "uid": "ord_…", "order_number": "A-014", "status": "placed",
  "table_label": "12", "items": [ … ], "totals": { … },
  "payment_method": "counter", "payment_status": "pending",
  "timeline": [ { "status": "placed", "actor_type": "guest", "at": "…" } ],

  "next_statuses": ["accepted", "cancelled", "rejected"],
  "can_guest_cancel": true,

  "can_review": false,
  "review_opens_at": "…",              // only while the window is still shut
  "review_closes_at": "…"
}
```

`next_statuses` and `can_guest_cancel` are computed server-side from the state machine.
**Render buttons from them; never hard-code which transitions are legal.** That is the whole point
of sending them — it is what stops the UI drifting from the server ([D1](./DECISIONS.md)).

`can_review` is the same contract for the rating window, and it is the one most likely to be
"simplified" into a client-side check. **It is not `status === 'served'`.** The window also opens
on a settled counter payment, and on a timeout after the kitchen stops updating the order at all
— precisely so a diner at a restaurant whose staff forget that last tap is still asked
([D16](./DECISIONS.md)). `review_opens_at` is sent while the window is shut so a client can set
one timer for that instant instead of discovering the change on its next poll.

Each line in `items` carries `review` once the diner has rated it, so a refresh re-renders the
stars already given rather than an empty row.

### `PUT /orders/:uid/items/:item_uid/review`

```jsonc
// Headers: X-Guest-Token
{
  "rating": 5,                          // required, 1-5
  "tags": ["tasty", "worth_the_wait"],  // optional, closed vocabulary
  "comment": "…"                        // optional, max 280
}
```

**`PUT`, and that is deliberate.** The diner rates with one tap and there is no Submit button, so
every tap has to be safe to repeat: a double-tap on a stalled connection and a correction from
four stars to five both resolve to the same row. No `Idempotency-Key` is involved, unlike order
placement — a unique index on the order line means this endpoint cannot create a second row.

`rating` is the only required field; a client that sends nothing else has not sent a partial
review. Tags outside the vocabulary are a **422, not a silent drop**: the point of a fixed
vocabulary is that every stored tag can be counted.

| Failure | Code |
| --- | --- |
| Window shut — too early, or the order is a day old | `TX_REV_001` (409) |
| Rating outside 1–5 | `TX_REV_002` (422) |
| Unrecognised tag | `TX_REV_003` (422) |
| No such line on this order | `TX_REV_004` (404) |
| The kitchen cancelled that line | `TX_REV_005` (409) |

`data`: `OrderItemReviewView`

---

## Admin

All require a staff JWT except `login` and `refresh`, which are the only two routes in this group
mounted without auth. Scope is enforced in middleware: a token carries exactly one
`restaurant_id` ([D3](./DECISIONS.md)).

Roles: `owner` ⊃ `manager` ⊃ `staff`. Marked below where it differs.

| | Role |
| --- | --- |
| `POST /auth/login` · `POST /auth/refresh` | — |
| `GET /auth/me` · `POST /auth/change-password` | any |
| `GET /staff` | any |
| `POST /staff` · `PATCH /staff/:uid` | **owner** |
| `GET /settings` | any |
| `PATCH /settings` | manager |
| `GET /menu` | any |
| `POST /menu/categories` · `PATCH /menu/categories/:uid` | manager |
| `POST /menu/items` · `PATCH /menu/items/:uid` | manager |
| `PATCH /menu/items/:uid/availability` | **any** — see below |
| `POST /menu/items/:uid/image/upload` · `POST`/`DELETE /menu/items/:uid/image` | manager |
| `GET /tables` · `GET /tables/:uid/qr` | any |
| `POST /tables` · `POST /tables/bulk` · `PATCH /tables/:uid` | manager |
| `POST /tables/:uid/qr/rotate` | manager |
| `GET /orders` · `GET /orders/:uid` | any |
| `POST /orders/:uid/transition` | any |
| `POST /orders/:uid/items/:item_uid/cancel` | any |
| `POST /orders/:uid/payment/confirm` · `/fail` | any |
| `GET /stats/today` · `GET /stats/range` | any |
| `GET /stream` | any |

**Why availability is open to every role** while the rest of menu management is not: marking a
dish sold out is a floor action taken mid-service. Routing it through a manager means diners keep
ordering something the kitchen ran out of. Repricing stays restricted.

### Dish photos ([D15](./DECISIONS.md))

Uploading is **two calls**, because the bytes do not come through this API. The browser PUTs
straight to Cloudflare R2 on a presigned URL, so a 6MB phone photograph never occupies a request
worker.

```
1. POST /menu/items/:uid/image/upload   { content_type, size_bytes }
                                     -> { upload_url, method, headers, object_key, expires_at, max_bytes }
2. PUT  <upload_url>                    the file, with `headers` replayed VERBATIM   (goes to R2, not here)
3. POST /menu/items/:uid/image          { object_key }   -> the updated dish
```

Step 2's headers are inside the signature — altering, adding or dropping one gives a 403 from R2.
`Host` and `Content-Length` are deliberately not in that map: browsers forbid script from setting
either and supply both themselves.

**Step 3 is where validation happens**, and that is the point of the split: when the URL is issued
there is nothing to inspect yet. A signature proves the client sent the length and type it
promised, not that those bytes are a photograph.

| Checked at step 3 | Failure |
| --- | --- |
| Key is well-formed **and names this restaurant and this dish** | `422 TX_IMG_005` |
| Object exists and is non-empty | `422 TX_IMG_004` |
| Size within `storage.max_upload_bytes` | `413 TX_IMG_003` |
| Leading bytes sniff as JPEG/PNG/WebP **and match the stored content type** | `422 TX_IMG_006` |

Rejected objects are deleted rather than left in the bucket. On success the dish's previous photo
is deleted *after* the row is updated, never before.

`content_type` must be `image/jpeg`, `image/png` or `image/webp` (`422 TX_IMG_002` otherwise).
**SVG is refused permanently** — it is a script-bearing document and these objects are served from
a host of ours.

`object_key` is `menu/{restaurant_uid}/{item_uid}/{image_uid}.{ext}`. It encodes the mapping in
both directions, and the `image_uid` is fresh per upload so replacing a photo writes a new key —
overwriting would leave CDN edges serving the old bytes against an unchanged URL.

**Setting `image_url` through `PATCH /menu/items/:uid` also clears an uploaded photo.** The two
are one field on the wire, and the uploaded copy takes precedence when both are set — so without
this, pasting a URL over an uploaded photo would return 200 and change nothing visible. Passing
`image_url: ""` clears the dish's photo entirely, whichever way it was set.

`DELETE /menu/items/:uid/image` is idempotent and clears **both** `image_key` and `image_url`, so
removing an uploaded photo cannot reveal an older pasted URL underneath it. Unlike the two upload
routes it works on a deployment with no storage configured — that is exactly when a manager is
tidying rows whose photos no longer resolve.

On a deployment with no object store, the two upload routes answer **`501 TX_IMG_001`**. Read
`image_upload_enabled` from `GET /menu` and hide the control instead of catching that.

### `GET /orders` — the queue

Query: `live=true` (every non-terminal status — the kitchen board's only real question),
`status` (repeatable), `table_uid`, `payment_status`, `search` (order number or customer name),
`from`/`to` (`YYYY-MM-DD`, `to` inclusive), `page`, `per_page` (max 100).

### `POST /orders/:uid/transition`

```jsonc
{ "status": "accepted", "reason": "…" }
```

`reason` is required for `rejected` and `cancelled`, so the diner can be told why. Validated
against the state machine under a row lock, which is what makes two staff phones tapping Accept
resolve to exactly one winner — the loser gets `TX_ORD_007`. **Refetch on 409; never retry.**

### `POST /orders/:uid/payment/confirm`

```jsonc
{ "reference": "UTR123456", "note": "cash at counter" }
```

Settles a payment no gateway can confirm — cash, or a static-UPI transfer staff saw land. This is
a **trust-the-staff** action, the same model as cash, and it is attributed to the signed-in user.
It goes through the same code path as a gateway webhook, so both produce identical audit trails,
identical realtime events, and identical order completion.

### `GET /reviews` · `GET /reviews/summary`

What diners said, and the roll-up ([D16](./DECISIONS.md)). Open to **every** staff role, unlike
menu editing: a complaint about a cold dish is most useful to whoever is on the floor right now,
and gating it behind a manager login is how it gets read the next morning instead.

`GET /reviews` takes `page`, `per_page`, `menu_item_uid`, `min_rating`, `max_rating`,
`has_comment`, `from`, `to`. **`max_rating=3` is the query this screen exists for** — a ceiling
rather than an exact value, because "3 and below" is the real question. A `menu_item_uid` from
another restaurant answers `TX_MNU_004`, never rows.

Each `ReviewView` carries `item_name` **snapshotted from the order line**, not the dish's current
name ([D8](./DECISIONS.md)), plus `order_number` — the value staff shout across a kitchen and the
only one that finds the ticket.

`GET /reviews/summary` returns `overall`, a five-bucket `distribution`, and `needs_attention` /
`top_rated`. The distribution is sent *as well as* the average because the two answer different
questions: a 3.0 of straight 3s is a dull menu, a 3.0 of 5s and 1s is an inconsistent kitchen, and
an average cannot tell them apart. Both rankings exclude dishes below `min_reviews_for_ranking`,
which is echoed so an empty list reads as "not enough data yet" rather than as a broken panel.

Dish ratings also ride on `MenuItemView.rating` wherever a menu is returned — **withheld from
diners until a dish has three ratings, never withheld from staff.**

### `GET /stats/today` · `GET /stats/range?from=&to=`

Windowed in the **restaurant's** timezone, not UTC: a 1am order belongs to the previous evening's
service ([D9](./DECISIONS.md)). Range is capped at 366 days.

`avg_accept_secs` and `avg_fulfil_secs` are **null when there is no data** — render `--`, never
`0`. Zero would claim orders are accepted instantly, which is a different and false statement.

---

## Platform

Creating restaurants ([D14](./DECISIONS.md)). Authorised by `X-Platform-Token`, a shared secret
from the deployment's environment — **not** by a staff JWT, however senior. A staff token carries
exactly one `restaurant_id` ([D3](./DECISIONS.md)), so no role on it can describe an operator
acting across every restaurant, and inventing one would put tenant creation a wrongly-set flag
away from every restaurant owner.

A bearer header is accepted as a fallback for clients that only speak `Authorization`. A
`?token=` query parameter is **not** — the fallback that exists for staff and guest tokens is
there because a browser WebSocket cannot set headers, and nothing here is a WebSocket.

| | Role |
| --- | --- |
| `POST /restaurants` | platform token |
| `GET /restaurants` | platform token |

### `POST /restaurants` — onboard a restaurant

Creates the restaurant, its **first owner login**, and optionally its floor of tables, in one
transaction. One call rather than three because the three are useless apart: a restaurant with no
owner cannot be signed into, and a half-onboarded tenant is not a state a retry fixes.

```jsonc
{
  "name": "Tandoor Junction",           // required
  "owner": {                            // required
    "name": "Meera Nair",
    "email": "owner@tandoorjunction.test",
    "password": "at least 8 characters"
  },
  "slug": "tandoor-junction",           // optional — derived from name when omitted
  "timezone": "Asia/Kolkata",           // optional — IANA name, defaults to IST
  "tax_bps": 500,                       // optional — omitted inherits 5%; 0 means tax-free
  "service_charge_bps": 0,
  "currency": "INR",
  "address": "…", "phone": "…", "gst_number": "…", "logo_url": "…", "description": "…",
  "upi_vpa": "tandoorjunction@okhdfcbank",
  "upi_payee_name": "Tandoor Junction",
  "payment_provider": "upi_static",
  "tables": { "prefix": "T-", "from": 1, "to": 12, "seats": 4 }   // optional, both ends inclusive
}
```

**201** with `{ restaurant, owner, tables[], diner_url, admin_url }`. The response carries every
table's `qr_url`, because those are the deliverable — onboarding that returned an id and left
someone to go and find the codes would not have finished the job. It carries **no password**: the
caller already has it, and echoing it writes it into every proxy log on the way home.

Notes on the fields that have a wrong-looking right answer:

- **`slug`** is normalised either way, so `"Spice Garden!"` and `"spice-garden"` arrive at the
  same value. It becomes `/r/{slug}` ([D4](./DECISIONS.md)) and goes onto printed signage, so it
  is refused rather than truncated when it exceeds 64 characters, and refused rather than
  auto-generated when the name normalises to nothing.
- **`tax_bps` omitted is not `tax_bps: 0`.** Omitted inherits the schema's 5% GST; `0` means the
  restaurant charges no tax. A form that sends `0` for an untouched field onboards every
  restaurant tax-free.
- **`timezone`** must be an IANA name. `"IST"` is rejected — it would fall back to
  `Asia/Kolkata` at read time, which is the right answer for the wrong reason and would let a
  genuine typo roll the daily order counter over at the wrong hour ([D9](./DECISIONS.md)).
- **`payment_provider`** is refused if this deployment cannot serve it. Accepting `razorpay`
  without credentials would leave the payment screen silently falling back on every order while
  the owner believed their gateway was live ([D2](./DECISIONS.md)).

Errors: `TX_RST_003` 409 slug taken · `TX_AUT_007` 409 the owner email already signs in to
another restaurant · `TX_COM_008` 422 validation · `TX_PAY_005` 409 provider unavailable ·
`TX_AUT_009` 401 bad token · 404 onboarding not enabled on this server.

**`TX_AUT_007` is a correctness refusal, not a convenience.** `staff_user` is unique on
`(restaurant_id, email)`, so the database would accept the address at a second restaurant — but
login refuses an email matching more than one staff row rather than guessing which restaurant was
meant. Creating the account would produce one that can never sign in anywhere.

**Not retryable on 409.** Both conflicts need a different value, not another attempt at the same
one.

**What this does not do: create a menu.** A freshly onboarded restaurant renders an empty diner
page until its owner adds categories and items. Expected, not a fault — but it does mean
onboarding alone does not make a restaurant able to take orders.

### `GET /restaurants`

Every restaurant on the deployment, **inactive ones included**, as `RestaurantSettings`.

Deliberately wider than the public directory, which returns only active restaurants as
`RestaurantSummary` ([D13](./DECISIONS.md)): an operator's first question about a restaurant that
is not taking orders is whether it exists and what its status is, and a list that hides inactive
rows answers neither. Still never returns a table's `qr_token` — that is a capability, and no
endpoint at any trust level hands one out ([D4](./DECISIONS.md)).

Not paginated. A deployment with enough restaurants for that to matter has outgrown a shared
secret as its access model, and the fix is the auth model rather than a `page` parameter.

---

## Realtime

WebSocket. `GET /api/guest/v1/orders/:uid/stream` for a diner, `GET /api/admin/v1/stream` for the
panel.

**Messages are hints, not state.** An event names an order and a status; the client refetches over
HTTP. That is what makes a dropped frame harmless — and it is why polling is a complete substitute
rather than a degraded mode ([D10](./DECISIONS.md)).

```jsonc
{ "type": "order.status_changed", "topic": "restaurant:rst_…", "order_uid": "ord_…", "status": "accepted", "at": "…" }
```

Types: `order.placed`, `order.status_changed`, `payment.updated`,
`menu.availability_changed`, `ping`.

**Authentication is by query parameter** — `?token=<jwt>` for admin, `?token=<session>` for
guests — because a browser `WebSocket` cannot set request headers. The server accepts a query
token **only on a genuine WebSocket upgrade**; every ordinary request still refuses one, so the
weaker path cannot be used to authenticate anything else. It is also why the request logger omits
query strings.

Origin is checked against the CORS allowlist, so a foreign origin gets 403 even with a valid
token. A slow client is disconnected rather than waited for: one stalled phone on restaurant wifi
must not stop the kitchen board updating.
