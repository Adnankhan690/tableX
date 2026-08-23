# API reference

Base URL in development: `http://localhost:8080`.

Three route groups, three trust levels. The prefix a route sits under *is* the statement of who
may call it, so nothing is mounted outside one of them.

| Group | Prefix | Credential |
| --- | --- | --- |
| Public | `/api/public/v1` | none, rate limited |
| Guest | `/api/guest/v1` | `X-Guest-Token: <token>` |
| Admin | `/api/admin/v1` | `Authorization: Bearer <jwt>` |

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
`TBL` table/QR, `MNU` menu, `ORD` order, `PAY` payment.

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
  "can_guest_cancel": true
}
```

`next_statuses` and `can_guest_cancel` are computed server-side from the state machine.
**Render buttons from them; never hard-code which transitions are legal.** That is the whole point
of sending them — it is what stops the UI drifting from the server ([D1](./DECISIONS.md)).

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

### `GET /stats/today` · `GET /stats/range?from=&to=`

Windowed in the **restaurant's** timezone, not UTC: a 1am order belongs to the previous evening's
service ([D9](./DECISIONS.md)). Range is capped at 366 days.

`avg_accept_secs` and `avg_fulfil_secs` are **null when there is no data** — render `--`, never
`0`. Zero would claim orders are accepted instantly, which is a different and false statement.

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
