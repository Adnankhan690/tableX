# Working on tableX

## Setup

```bash
cp .env.example .env
echo "TABLEX_JWT_SECRET=$(openssl rand -hex 32)" >> .env
# Optional: enables /api/platform/v1, which is how a real restaurant gets onto the platform
# ([D14](./DECISIONS.md)). Without it that group is never mounted and its routes answer 404.
echo "TABLEX_PLATFORM_TOKEN=$(openssl rand -hex 32)" >> .env
make setup     # deps, Postgres, migrations, demo data
make dev       # API :8080, diner :3000, admin :3001
```

`make help` lists everything. `make check` is the full gate, and it is what CI runs.

## The one rule that is not optional

**`packages/shared/src/types.ts` is a hand-mirror of `backend/internal/types`. When a DTO changes
on one side, it changes on the other in the same commit.**

There is no codegen. That is a deliberate trade for one backend and two frontends — adding protoc
or an OpenAPI pipeline costs more than it saves at this size — but the trade only works if the
obligation is honoured. Nothing fails at compile time if you forget; it fails at runtime, in front
of a diner, as a missing field.

The safety net is `apps/*/e2e/*.mjs`: they run against a real backend with nothing stubbed, so a
drift shows up there. Run them before merging a DTO change.

## Layers

Each layer talks only to the one below, and each returns a different kind of error. That asymmetry
is the design: it puts every decision in exactly one place.

| Layer | Does | Returns | Never |
| --- | --- | --- | --- |
| `controllers` | bind, resolve principal, call **one** service, reply | whatever the service gave it | contains an `if` about domain state |
| `services` | business rules, owns transactions | `*response.ApplicationError` | imports `gin` |
| `repositories` | GORM queries | wrapped plain errors | validates, or picks an HTTP status |

The rule that earns the most: **only a service knows whether a missing row is an error.**
`gorm.ErrRecordNotFound` for "no session with this token" is a 401; the same error for "no
restaurant with this slug" is a 404. A repository would have to guess; a controller would
duplicate it per endpoint.

`internal/repositories/interfaces.go` and `internal/services/interfaces.go` declare every
signature separately from the implementations — 70 and 44 methods. Two consequences worth the
indirection: every tenant-scoped read takes `restaurantID` **as a parameter**, so a query that
forgets to scope itself does not compile; and transaction-aware methods take a `*gorm.DB`, with
`nil` meaning "use the pool", so one signature serves both cases.

## Things that will be sent back in review

- **A float in a money path.** Amounts are `int64` paise, named `*_minor`, in Go and TypeScript
  alike ([D7](./DECISIONS.md)). Rates are integer basis points.
- **A status comparison written inline.** Go goes through `services.CheckTransition`; TypeScript
  renders `order.next_statuses`. The state machine has one definition ([D1](./DECISIONS.md)) and
  the client is not allowed a second one.
- **`status === 'served'` used to decide whether a diner may rate.** It looks equivalent to
  `order.can_review` and is not. The rating window also opens on a settled counter payment and on
  a timeout after the kitchen stops updating an order, because tying it to that one tap silently
  excludes every diner whose restaurant forgets it ([D16](./DECISIONS.md)).
  `services.ReviewEligibilityFor` is the only authority.
- **One blended rating for a restaurant.** Food and service are rated separately and reported
  separately, and no endpoint returns a single score for a restaurant. "You are a 3.8" gives a
  manager nothing to do; "food 4.6, service 3.2" names a team and a shift ([D17](./DECISIONS.md)).
- **A dish tag on a service rating, or the reverse.** `models.ReviewTag` and `models.ServiceTag`
  are separate types with separate vocabularies and separate refusal codes, precisely so one
  cannot be used where the other belongs.
- **A new "is this thing switched on" boolean folded into a `status` column.** `menu_item` splits
  `is_available` from `status` and `restaurant` splits `accepting_orders` from `status`, both for
  the same reason: the day-to-day toggle and the lifecycle flag have different owners, different
  frequencies and different blast radii ([D18](./DECISIONS.md)).
- **A control rendered twice behind a breakpoint.** One element that MOVES, never two behind
  `sm:hidden` / `hidden sm:flex` -- it doubles the tab stops and gives assistive technology two
  names for one action. Note also that `PageHeader` is hidden below `sm` on the order board, so
  anything in its `actions` slot is unreachable on a phone.
- **Anything added to the shell's top bar without measuring it at 375px.** The brand is a flex
  item, so a neighbour that does not fit shrinks the restaurant name rather than wrapping below it.
  Check both that the name is unclipped (`scrollWidth`, not `innerText` -- `truncate` is CSS) and
  that the bar is still one row ([D18](./DECISIONS.md)).
- **A realtime publish inside a transaction.** It would announce a state a rollback then
  discards. Publish after commit, always.
- **A tenant-scoped query that ignores its `restaurantID`.** A data-isolation bug, not a style note.
- **A repository returning an `ApplicationError`,** or a service importing `gin`.
- **Branching on a payment provider's name.** Branch on `Capabilities()`. Naming providers in
  business logic is how the same string comparison ends up in six files that all have to be found
  when a seventh provider arrives ([D2](./DECISIONS.md)).
- **A read inside a transaction using a method that takes no `tx`.** It goes to the pool and cannot
  see the transaction's own uncommitted writes. This shipped once and returned a stale order status
  to the client; the E2E suite caught it.
- **A partial unique index whose predicate does not match what the ORM writes.** `IS NOT NULL` does
  not exclude `''`, and a Go `string` field writes `''` rather than NULL. This shipped once too and
  silently left counter orders with no payment row.

## Adding a backend endpoint

Bottom-up, so each step compiles:

1. Migration pair in `backend/migrations/postgres/` (`make -C backend migrate-new`). Hand-written
   SQL — a generated migration is one nobody has read.
2. Model in `internal/models/`, mirroring the migration exactly.
3. DTOs in `internal/types/`, and the TypeScript mirror in `packages/shared`.
4. Errors in `internal/response/errors_*.go`. Every code unique; check with
   `grep -rhoE 'TX_[A-Z]+_[0-9]+' backend/internal/response | sort | uniq -d`.
5. Repository method — signature in `interfaces.go` first, then the implementation.
6. Service method — same order. Own the transaction here.
7. Controller, then the route in `cmd/app/routes.go`.
8. An assertion in `scripts/smoke.sh`.
9. **A request in `backend/api_collection/`.** Not optional -- `go test ./cmd/app` fails if a route
   has no request, and fails again if a request points at a route that no longer exists. Put it in
   the folder matching its route group and give it a `seq` that keeps a sequential run working.

## Testing

```bash
make test                    # Go tests + frontend unit tests
make -C backend test-race    # the hub and order locking only misbehave under -race
make smoke                   # 151 API assertions against a running server
make concurrency             # the four races that happen in a real restaurant
make api-collection          # 186 assertions, the Bruno collection end to end
cd apps/diner && node e2e/diner-journey.mjs    # 47 assertions, real browser
cd apps/diner && node e2e/rating-journey.mjs   # 20 assertions, real browser
cd apps/admin && node e2e/admin-journey.mjs    # 81 assertions, real browser
```

`make api-collection` reseeds before running, and judges on assertion results rather than Bruno's
exit code -- Bruno exits 1 for any non-2xx response, and the collection deliberately asserts three
refusals. Verifying a refusal is worth more than a green exit code, so the wrapper reads the JSON
report instead.

The smoke and E2E suites need a **freshly seeded** database (`make reset`): several assertions
check exact order numbers and totals.

Unit tests use SQLite for speed. Anything about locking must be verified against Postgres — SQLite
has no `SELECT … FOR UPDATE`, which is exactly the mechanism under test.

## Frontend

- `packages/shared` — types, money, status labels. No React.
- `packages/api-client` — typed clients, error mapping, timeouts.
- `packages/ui` — only what is **pixel-identical** in both apps. Anything needing a variant prop to
  satisfy both is two components, one per app.
- `apps/diner` — public, anonymous, mobile-first. Ships no icon, animation, charting or
  state-management library; PRD §7 makes payload a product requirement, and the enforcement is
  omission. Icons are inline SVG.
- `apps/admin` — authenticated, dense, cool palette deliberately unlike the diner app so nobody
  confuses the two on one tablet ([D11](./DECISIONS.md)). Unlike the diner app it *does* carry two
  dependencies the payload rule above forbids there: `lucide-react` for icons and a `next/font`
  webfont. The rule is a diner rule — that app is public and mobile-first, this one is opened once
  at the start of a shift and held open — but it stays a deliberate exception, not an invitation:
  nothing else gets added without the same argument. Its design system is documented in
  `.claude/context/admin-ui/SPEC.md`.

Both apps run TypeScript strict with `noUncheckedIndexedAccess`. Handle the `undefined`; do not
reach for `!`.

## Migrations

Numbered `.up.sql`/`.down.sql` pairs. The down migration must actually work — CI applies the whole
stack in reverse, asserts zero tables remain, then applies it forwards again.

For a live deploy use expand/contract: add the column, ship code that writes both, backfill, ship
code that reads the new one, then drop the old. Never rename in one step.
