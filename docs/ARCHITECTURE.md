# Architecture

How tableX is put together, and the reasoning behind the boundaries. Requirements are in
[PRD.md](./PRD.md); the design decisions this document implements are in
[DECISIONS.md](./DECISIONS.md).

## Shape

```
   ┌──────────────┐        ┌──────────────┐
   │  diner app   │        │  admin app   │      Next.js 15, separate builds (D11)
   │  :3000       │        │  :3001       │
   └──────┬───────┘        └──────┬───────┘
          │  guest token           │  staff JWT
          │  (X-Guest-Token)       │  (Bearer)
          └───────────┬────────────┘
                      │  HTTP + WebSocket
              ┌───────▼────────┐
              │   Go / Gin     │  :8080
              │                │
              │  controllers   │  bind, call one service, reply
              │  services      │  business logic, transactions, ApplicationError
              │  repositories  │  GORM only, wrapped plain errors
              └───────┬────────┘
                      │
              ┌───────▼────────┐
              │   Postgres 17  │  :5434
              └────────────────┘
```

## The layers, and why they are strict

Each layer may only speak to the one below it, and each returns a different kind of error.
That asymmetry is the point: it puts every decision in exactly one place.

| Layer | Does | Returns | Never |
| --- | --- | --- | --- |
| `controllers` | binds the request, resolves the principal, calls **one** service method, replies | whatever the service gave it | contains an `if` about domain state |
| `services` | business rules, owns the transaction boundary, maps not-found onto meaning | `*response.ApplicationError` | imports `gin` |
| `repositories` | GORM queries | wrapped plain errors | validates, or returns an HTTP status |

The rule that earns the most: **only a service knows whether a missing row is an error.**
A repository returning `gorm.ErrRecordNotFound` for "no guest session with this token" is
a 401; the identical error for "no restaurant with this slug" is a 404. Pushing that
decision down into the repository would force it to guess, and pushing it up into the
controller would duplicate it per endpoint.

### The contract is compiler-checked

`internal/repositories/interfaces.go` and `internal/services/interfaces.go` declare every
method signature — 70 and 44 respectively — separately from the implementations. Two
consequences worth the indirection:

- Every tenant-scoped read takes `restaurantID` **as a parameter**, not from ambient state.
  A query that forgets to scope itself does not compile ([D3](./DECISIONS.md)).
- Transaction-aware methods take a `*gorm.DB`. Passing `nil` uses the pool, so one signature
  serves both a standalone call and one inside a transaction.

## Where correctness actually lives

Four files carry most of the load. If you read nothing else, read these.

### `internal/services/order_state.go` — the state machine

Every legal transition, and who may make it, as a data table rather than branching logic
([D1](./DECISIONS.md)). Nothing else in the codebase compares order statuses inline.

```
placed ──► accepted ──► preparing ──► ready ──► served ──► completed
  │            │             │
  ├──► rejected│             │
  └──► cancelled ◄───────────┘
```

Because it is pure and takes no database handle, the whole matrix — every from-state,
to-state and actor — is exhaustively tested without a fixture. `NextStatuses()` is sent to
the client on every order, so the admin panel renders exactly the buttons that will work
instead of reimplementing the rules in TypeScript and drifting from them.

### `internal/services/service_order.go` — the placement transaction

One transaction does: idempotency lookup, cart validation, server-side pricing from the live
menu, order number allocation under a row lock, order and item inserts, and the initial
status event. All of it, or none. PRD §7 makes not losing an order the core trust
requirement, and a diner charged for an order the kitchen never received is the failure this
product cannot have.

Two details that are easy to get wrong and are deliberate here:

- **The request DTO has no amount field.** The server prices the cart from the menu. A
  client-supplied total would let a diner order a thali for one rupee.
- **The realtime publish happens after commit, never inside.** Publishing inside would
  announce a state a rollback then discards, and the admin board would show an order that
  does not exist.

### `internal/payments/provider.go` — the payment seam

One interface, three implementations ([D2](./DECISIONS.md)). Business logic branches on
`Capabilities()`, never on the provider's name — naming providers in business logic is how a
codebase ends up with the same string comparison in six files that all have to be found when
a seventh provider arrives.

`AutoConfirms: false` on static UPI is a single boolean that drives the entire manual-
confirmation path through the application, up to and including the copy the diner reads.

### `internal/realtime/hub.go` — the fan-out

Two rules, both load-bearing:

1. **Messages are hints, not state.** An event names an order and a status; the client
   refetches over HTTP. This is what makes a dropped frame harmless, and it is why polling is
   a complete substitute rather than a degraded mode ([D10](./DECISIONS.md)).
2. **A slow client is dropped, never waited for.** Restaurant wifi produces clients that stop
   reading but never close. The send buffer's capacity *is* the backpressure policy: once
   full, the subscriber goes, because one stalled phone must not stop the kitchen board
   updating.

Topics are `restaurant:{uid}` for the admin panel and `order:{uid}` for one diner —
per-order rather than per-table, so nobody can subscribe to a neighbouring table by guessing
a label.

## Data model

Twelve tables. Every tenant-owned row carries `restaurant_id` ([D3](./DECISIONS.md)).

```
restaurant ─┬─ staff_user
            ├─ restaurant_table ──── guest_session
            ├─ menu_category ─── menu_item
            ├─ order_counter                      (daily number allocation, D9)
            └─ orders ─┬─ order_item              (snapshotted name/price, D8)
                       ├─ order_status_event      (append-only audit)
                       └─ payment ─── payment_webhook_event   (idempotency ledger, D2)
```

Choices that are not obvious from the DDL:

- **`orders`, plural**, because `order` is a reserved SQL word.
- **`qr_token` is opaque and rotatable**, not the table id. `…/t/17` invites a diner to try
  `…/t/18` and order onto someone else's table, and leaks the floor size
  ([D4](./DECISIONS.md)).
- **`tax_bps` is an integer** in basis points (500 = 5.00%), not a `NUMERIC` percentage, so
  every money computation stays in integer arithmetic ([D7](./DECISIONS.md)).
- **`is_available` and `status` are separate columns** on `menu_item`. Availability is "we
  ran out tonight"; status is "does this exist on the menu". Archiving a dish that sold out
  for one evening would break its order history.
- **Order totals are stored, not derived on read.** A later change to the tax rate must not
  retroactively alter a bill a diner already paid.
- **`payment_status` is separate from `status`.** A counter order is served long before it is
  paid; an online order is paid before it is accepted. One column could not represent both.

## Concurrency

Three places take a row lock, and each guards a specific race that happens in a real
restaurant:

| Lock | The race |
| --- | --- |
| `orders` on transition | Two staff phones tap *Accept* in the same second. Both re-read status inside the transaction; one wins, the other gets a 409. |
| `orders` on guest cancel | A diner taps cancel exactly as the kitchen accepts ([D6](./DECISIONS.md)). |
| `order_counter` on placement | Two diners check out simultaneously. `SELECT COUNT(*)` would give both the same number; the lock serialises them ([D9](./DECISIONS.md)). |

Plus one guard that is not a lock: **the unique index on `payment_webhook_event
(provider, event_id)`**. Gateways retry as a matter of course, so a duplicate delivery is
the normal path. The insert failing *is* the idempotency check — a SELECT-then-INSERT would
be racy.

SQLite has no `FOR UPDATE`, so the locking is guarded by `Store.IsPostgres()`. That is why
concurrency behaviour is verified against Postgres and SQLite is only used for fast unit
tests.

## Request paths

Three route groups, three trust levels.

**`/api/public/v1`** — anonymous, rate limited. QR scan, restaurant landing, health,
payment webhooks. The webhook handler reads the **raw** body before anything parses it,
because the HMAC is computed over those exact bytes.

**`/api/guest/v1`** — `X-Guest-Token`. Menu, place order, track order, pay. Every order
read verifies the session owns the order, and a mismatch returns **404, not 403**, so an
order's existence cannot be probed.

**`/api/admin/v1`** — staff JWT, restaurant scope enforced in middleware. `login` and
`refresh` are the only two routes in this group without auth.

A claim-carrying JWT means `Authenticate` does no database work on the happy path. Access
tokens are short-lived; expiry is a *distinct* error code from invalid, so the admin panel
refreshes silently instead of bouncing a staff member to the login screen mid-service.

## Frontend

Both apps are Next.js 15 App Router over the same `packages/shared` types and
`packages/api-client` clients.

The diner app's constraints come straight from PRD §7 and are enforced by omission: no icon
library, no animation library, no charting, no state-management library. Icons are inline
SVG. On a 3G connection each round trip costs more than the bytes do, which is why a QR scan
returns the session *and* the whole menu in one response.

`packages/shared` is hand-mirrored from `backend/internal/types`, not generated. That is a
deliberate trade at this size — adding protoc or OpenAPI codegen costs more than it saves for
one backend and two frontends — with one non-optional obligation: **a DTO change lands in
both places in the same commit.** See [CONTRIBUTING.md](./CONTRIBUTING.md).

## What is deliberately not here

- **No message queue.** Order placement is synchronous, and it should be: the diner needs to
  know their order landed before they put their phone down.
- **No caching layer.** The menu is the only hot read, it is one query, and it is indexed for
  exactly that access pattern. Cache invalidation on a sold-out toggle would cost more than
  the query does.
- **No microservices.** One deployable, three layers, twelve tables.
- **No ORM-generated migrations.** Migrations are hand-written SQL pairs, because a generated
  migration is one nobody has read.
