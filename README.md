# tableX

Restaurant QR table ordering. A diner scans the QR on their table, browses the menu, orders,
pays, and watches the order progress. Staff run the floor from an admin panel.

Mobile-first by mandate — the diner app is designed for a phone held one-handed in dim
restaurant lighting, and desktop is not a v1 target.

- **Requirements:** [docs/PRD.md](docs/PRD.md)
- **Why it is built this way:** [docs/DECISIONS.md](docs/DECISIONS.md) — D1–D12, including
  answers to every open question the PRD left
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Low-level design:** [docs/LLD.md](docs/LLD.md) — schema, table relationships, the session
  lifecycle for a static printed QR, and a verified done/not-done inventory
- **API reference:** [docs/API.md](docs/API.md)
- **Working on it:** [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)

---

## Quick start

Needs [bun](https://bun.sh), Go 1.25+, and Docker.

```bash
git clone git@github.com:Adnankhan690/tableX.git
cd tableX

cp .env.example .env
# Required. The server refuses to start without it rather than falling back to a
# hard-coded value that would ship to production and forge any staff token.
echo "TABLEX_JWT_SECRET=$(openssl rand -hex 32)" >> .env

make setup    # installs deps, starts Postgres, migrates, seeds a demo restaurant
make dev      # API on :8080, diner on :3000, admin on :3001
```

`make seed` prints the scan URLs. Open one on your phone (or in a mobile viewport) to enter
the diner flow:

```
http://localhost:3000/t/demolocaltablequrtoken0000000001
```

Or open **http://localhost:3000/qr** to see a scannable code per restaurant — point a phone at
your screen and it opens that restaurant's table picker.

Admin panel at **http://localhost:3001**:

| Restaurant | Login | Password |
| --- | --- | --- |
| Spice Garden | `owner@spicegarden.test` | `password123` |
| Coastal Curry | `owner@coastalcurry.test` | `password123` |

The seed ships **two** restaurants, which is the smallest number that proves the tenant scoping
works — with one, every query returns the right rows by accident:

- **Spice Garden** — 28 items, 7 categories, 8 tables, 3 staff at the three roles, 5% GST. Two
  items are deliberately sold out, so the availability path is visible without configuring anything.
- **Coastal Curry** — 14 items, 4 categories, 4 tables, 2 staff, 5% GST **plus a 10% service
  charge**, so the cart renders a line the first restaurant never shows.

---

## What is in the box

```
tableX/
├── backend/              Go 1.25 + Gin + GORM + Postgres
│   ├── cmd/
│   │   ├── server/       entrypoint
│   │   └── app/          wiring, routes, middlewares
│   ├── internal/
│   │   ├── models/       GORM entities, one per migration
│   │   ├── repositories/ data access — GORM only, wrapped plain errors
│   │   ├── services/     business logic — owns transactions, returns ApplicationError
│   │   ├── controllers/  HTTP — bind, call one service, reply
│   │   ├── payments/     the provider seam: static UPI, Razorpay, mock
│   │   ├── realtime/     WebSocket hub
│   │   ├── response/     one envelope, one error type, the full error catalog
│   │   └── types/        request/response DTOs (the wire contract)
│   ├── migrations/       numbered .up/.down SQL pairs
│   └── seeds/            demo data
├── apps/
│   ├── diner/            Next.js — the public, anonymous, mobile-first ordering app
│   └── admin/            Next.js — the authenticated staff panel
├── packages/
│   ├── shared/           TS types mirroring backend/internal/types, plus money + status helpers
│   ├── api-client/       typed fetch clients, error mapping, timeouts
│   └── ui/               the few primitives both apps genuinely share
└── docs/
```

Two frontend apps rather than one with route groups, because the diner app is public and
must load fast on 3G while the admin panel is authenticated and data-dense — they should not
share a bundle. See [D11](docs/DECISIONS.md).

---

## The flows

**Diner** — scan `/t/{token}` → a guest session and the whole menu arrive in one response →
browse, add to cart → review the bill → pick *Pay by UPI* or *Pay at the counter* → place →
watch the status update live.

No login, ever. A guest session token in `localStorage` is the whole identity, and it is
scoped to the table ([D5](docs/DECISIONS.md)).

**Staff** — sign in → the live order board, grouped by status, where an order waiting too
long gets visually louder → open one → accept, start preparing, mark ready, mark served,
close → confirm payment for cash and static-UPI orders.

---

## Decisions worth knowing before you read the code

These are the ones that shape everything else. Full reasoning in
[docs/DECISIONS.md](docs/DECISIONS.md).

| | Decision |
|---|---|
| **D1** | The full order lifecycle ships, not just Placed → Accepted, and legal transitions live in one state machine that both the API and the UI obey. |
| **D2** | Payments sit behind a `Provider` interface. Static UPI is the default because it needs no gateway account. It **cannot confirm that money arrived** — staff marks it paid — and Razorpay exists in the same interface for restaurants that need real reconciliation. |
| **D3** | The data model is multi-tenant from migration 001; admin auth is single-restaurant. Retrofitting `restaurant_id` later is the most expensive migration in this design, so it went in while it was free. |
| **D7** | Money is `int64` paise everywhere. No `float64` touches an amount, in Go or TypeScript. |
| **D8** | Order lines snapshot name, price and food type, so an 8pm price rise cannot rewrite a 7:45pm bill. |
| **D10** | Realtime messages are *hints to refetch*, never state. Polling alone satisfies the requirement, so the WebSocket is an optimisation on a working baseline rather than a dependency. |
| **D12** | Order placement is idempotent, because the failure that actually happens is a diner double-tapping on a stalled connection and the kitchen getting two tickets. |

---

## Commands

```bash
make help              # every target

make setup             # first run
make dev               # API + both frontends
make up / down / reset # Postgres lifecycle
make migrate           # apply migrations
make seed              # load demo data (idempotent)
make db-shell          # psql

make check             # the full gate, as CI runs it
make test              # Go tests + frontend unit tests
make typecheck         # TypeScript across the workspace
make lint / fmt

make -C backend test-race   # the hub and order locking only misbehave under -race

make smoke                 # 68 API assertions against a running server
make concurrency           # the three races that happen in a real restaurant
make api-collection        # 125 assertions, the Bruno collection end to end

cd apps/diner && node e2e/diner-journey.mjs   # 37 assertions, real mobile browser
cd apps/admin && node e2e/admin-journey.mjs   # 53 assertions, real browser
```

`make smoke` and the E2E suites need a freshly seeded database (`make reset`) and a running
server — several assertions check exact order numbers and totals. They run against a real backend
with nothing stubbed, which is what lets them catch a drift between the Go DTOs and their
hand-mirrored TypeScript types.

---

## What is verified

Everything below runs against a real Postgres and a real browser — no mocks, no stubs.

| | |
| --- | --- |
| Go unit tests | State machine matrix (every from-state x to-state x actor), UPI link construction, Razorpay HMAC, provider registry |
| API smoke | 68 assertions: scan, server-side pricing, idempotency, the full lifecycle, payment settlement, role enforcement, tenant isolation, webhook signature rejection |
| Concurrency | 8 simultaneous accepts resolve to exactly one winner; 20 simultaneous checkouts get 20 distinct order numbers; 10 duplicate submits produce one order |
| Diner journey | 37 assertions in a real iPhone viewport: scan → menu → cart → checkout → live tracking |
| Admin journey | 53 assertions: login, board, reason-gated transitions, payment settlement, menu, QR, settings, role restrictions |
| Bruno collection | 53 requests over 11 folders, all 46 routes. `go test ./cmd/app` fails if a route has no request, or a request points at a route that is gone |
| Migrations | CI applies every down migration in reverse, asserts zero tables remain, then re-applies forwards |

Three real bugs were found this way, which is why the suites are shaped as they are:

- a read inside a transaction that could not see its own uncommitted write, so a transition
  returned the *previous* status to the client;
- a partial unique index whose `IS NOT NULL` predicate did not exclude the `''` that GORM actually
  writes, silently leaving counter orders with no payment row to settle against;
- a WebSocket that could never authenticate, because the staff middleware read only the
  `Authorization` header — which a browser socket cannot set — so the live board fell back to
  polling without saying so.

## Configuration

Precedence is **defaults → `backend/config/local.yml` → environment**. One image runs in
every environment: the file carries the shape, the deployment supplies the secrets. See
[.env.example](.env.example) for every variable.

Three things are validated at startup and will refuse to boot rather than fail later:

- `TABLEX_JWT_SECRET` — no default exists, deliberately.
- `app.diner_base_url` — it is encoded into every table QR code, so getting it wrong prints
  a floor's worth of stickers pointing at the wrong host.
- `server.trusted_proxies` in production — unset, Gin trusts every proxy header, which makes
  the client IP spoofable and silently defeats the rate limiter.

---

## Ports

| | |
|---|---|
| 8080 | API |
| 3000 | diner app |
| 3001 | admin panel |
| 5434 | Postgres — **not** 5432, which is commonly taken by another local stack |

---

## Known limitations in v1

Stated plainly, because each is a deliberate trade rather than an oversight:

- **Static UPI cannot confirm payment.** A bank transfer is invisible to the server, so a
  staff member taps *Mark paid*. Same trust model as cash. Razorpay is the upgrade path
  ([D2](docs/DECISIONS.md)).
- **No order editing.** A diner may cancel before the kitchen accepts, and otherwise places a
  second order. Editing would mean re-pricing a partly-cooked order against an already-
  authorised payment ([D6](docs/DECISIONS.md)).
- **No cross-visit order history.** That needs an identity, which needs a login, which
  reintroduces the friction the product exists to remove ([D5](docs/DECISIONS.md)).
- **One restaurant per staff login.** The schema is ready for more; the auth layer is not,
  and franchise management is explicitly out of scope for v1 ([D3](docs/DECISIONS.md)).
- **The rate limiter is in-process.** It counts per instance, so it dilutes across replicas.
  Redis is in `docker-compose.yml` under the `optional` profile for when that matters.
- **Admin tokens live in `localStorage`**, which is XSS-readable. Accepted for v1 because the
  panel is a separate origin and ships no third-party script; it is the first thing to change
  if that stops being true.
- **English only.** Hindi is a stated future consideration (PRD §7). Error *codes* are
  stable and separate from messages precisely so translating copy cannot change behaviour.
