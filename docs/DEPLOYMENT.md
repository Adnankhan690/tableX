# Deployment

Three pieces, three providers:

| Piece | Host | Address |
|---|---|---|
| API (Go) | Render, Docker, free plan | `api.tabley.in` |
| Postgres | Supabase, free plan | — |
| Diner app | Vercel | `tabley.in` |
| Admin app | Vercel | `admin.tabley.in` |

The API is defined by [`render.yaml`](../render.yaml) and built from
[`backend/Dockerfile`](../backend/Dockerfile). The two frontends are separate Vercel projects
pointing at the same repository with different root directories.

---

## Migrations are manual, and this is the thing that will bite you

`preDeployCommand` is a paid Render feature and the API runs on the free plan, so **nothing
applies migrations automatically**. The consequences are worth stating plainly, because none
of them announce themselves:

- The server starts fine against a database with no tables. `config.Validate` checks
  configuration, not schema.
- `/api/public/v1/health/ready` reports healthy, because it proves the *connection*, not the
  schema.
- The failure surfaces on the first real query, as a 500 that reads like an application bug.

So: run the migration yourself before the first deploy, and again after every schema change.

### Running a migration

`cmd/migrate` embeds the SQL, so the binary and the schema are one artifact. Build the image
and run the migrate entrypoint against Supabase:

```bash
docker build -f backend/Dockerfile -t tablex-api:local backend

docker run --rm \
  -e TABLEX_ENV=production \
  -e DATABASE_URL="<Supabase session-mode pooler URL>" \
  -e TABLEX_JWT_SECRET="<any 32+ char value; not persisted by this command>" \
  -e TABLEX_DINER_BASE_URL="https://tabley.in" \
  -e TABLEX_TRUSTED_PROXIES="10.0.0.0/8" \
  --entrypoint /app/migrate tablex-api:local \
  --config /app/config/production.yml
```

The three variables beyond `DATABASE_URL` are there because `migrate` loads configuration
through the same `config.Load` the server uses, which validates the whole file. That is
deliberate: a configuration that would not boot the server should not be allowed to migrate
the database either.

Expect, on a fresh database:

```
applied 001_create_restaurant
... 13 lines ...
applied 13 migration(s)
```

It is safe to re-run. Applied versions are recorded in `schema_migration`, and a second run
prints `schema is up to date; nothing to apply`.

To see what would happen without writing anything — safe against production:

```bash
  --config /app/config/production.yml --status
```

Each migration and its version row commit in one transaction. Postgres has transactional
DDL, so a failure leaves neither the tables nor the version row behind and the command can
simply be run again. A session-level advisory lock stops two overlapping runs from both
applying.

### Rollback

There is no `down` subcommand, deliberately — an automated rollback against production data
is a bigger risk than a careful manual one. The `.down.sql` files are in
`backend/migrations/postgres/` and CI proves they work (it applies the whole stack in
reverse, then forwards again, on every run). Apply them by hand, newest first, and delete
the corresponding `schema_migration` rows.

---

## Supabase

Use the **Session mode** pooler connection string, not Transaction mode.

The stack is GORM → pgx, which uses prepared statements by default. The transaction-mode
pooler does not support them, and the resulting `prepared statement already exists` error
only appears once two requests overlap — so it passes a smoke test and fails under load.
Supabase's direct-connection host is also IPv6-only unless the IPv4 add-on is bought, which
the API's host may not be able to reach.

Put the Supabase project in the **same region as the Render service** (currently
`singapore`). Each API request runs several queries, so server-to-database latency is
multiplied in a way that user-to-server latency is not.

Free Supabase projects pause after a week of inactivity. They are not deleted and unpause
from the dashboard, but a paused database is an API returning 500s.

---

## Environment variables

### Render — the API

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase session-mode pooler URL |
| `TABLEX_JWT_SECRET` | `openssl rand -hex 32` |
| `TABLEX_PLATFORM_TOKEN` | `openssl rand -hex 32` — a *different* value |
| `TABLEX_DINER_BASE_URL` | `https://tabley.in` |
| `TABLEX_ADMIN_BASE_URL` | `https://admin.tabley.in` |
| `TABLEX_ALLOWED_ORIGINS` | `https://tabley.in,https://admin.tabley.in` |

The rest are in `render.yaml` and need no attention.

`TABLEX_ALLOWED_ORIGINS` must be the origins a browser actually reports. Pointing it at the
`.vercel.app` hosts while users are on `tabley.in` blocks every call as a CORS error, with a
backend that looks perfectly healthy from `curl`.

`TABLEX_PLATFORM_TOKEN` is optional and is a policy decision (DECISIONS.md D14). Unset,
`/api/platform/v1` is never mounted and the admin app's `/onboard` page has nothing to call —
the first restaurant would have to be created in Supabase's SQL editor instead.

### Vercel — both apps, same two values

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.tabley.in` |
| `NEXT_PUBLIC_WS_BASE_URL` | `wss://api.tabley.in` |

`wss://`, not `https://` — `apps/*/src/lib/env.ts` rejects http/https for the socket URL,
because a WebSocket opened against an http URL fails at connect time with an error that
points nowhere near the configuration.

**These are `NEXT_PUBLIC_`, so Next inlines them at build time.** Changing them in Vercel's
dashboard does nothing to an already-deployed site; both apps must be redeployed. Absent,
they fall back to `http://localhost:8080`, which presents in production as "the backend is
down" rather than as a configuration error.

---

## First deploy, in order

1. Create the Supabase project in `singapore`; copy the session-mode pooler URL.
2. Run the migration (above). Confirm `applied 13 migration(s)`.
3. Apply the Blueprint on Render; fill in the six `sync: false` variables.
4. Point `api.tabley.in` at the Render service; wait for TLS.
5. Set the two `NEXT_PUBLIC_` variables on both Vercel projects and **redeploy both**.
6. Create the first restaurant from `https://admin.tabley.in/onboard` using
   `TABLEX_PLATFORM_TOKEN`.

Steps 1–2 come before 3 on purpose: the API can then serve its first request against a
schema that already exists.

---

## Verifying a deploy

```bash
curl https://api.tabley.in/api/public/v1/health/live    # process is up
curl https://api.tabley.in/api/public/v1/health/ready   # database reachable
```

On the free plan the first of these may take ~50 seconds while the instance wakes.

### The rate limiter is evadable if `TABLEX_TRUSTED_PROXIES` is wrong

`config.Validate` requires the value to be set in production but cannot tell whether it is
correct, and a wrong CIDR fails open: Gin reads the wrong entry from `X-Forwarded-For`, the
client IP becomes attacker-controlled, every forged address lands in its own bucket, and the
per-IP limiter never fires. Nothing logs, nothing 500s, health stays green.

The HTTP log line does not carry the client IP — `ClientIP()` is only printed when a request
is actually throttled — so this has to be tested rather than read:

```bash
seq 1 700 | xargs -P 20 -I{} sh -c 'curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Forwarded-For: 203.0.113.$((RANDOM % 250 + 1))" \
  https://api.tabley.in/api/public/v1/restaurants'
```

Concurrency is not incidental. The limiter's window is aligned to the wall-clock minute, so
700 *sequential* requests spread over 90s straddle boundaries, reset the counter, and return
all 200s regardless of how the proxies are configured — a false pass.

Any 429s mean the forged header was ignored and the limiter holds. All 200s mean it is
evadable. Verified passing on 2026-08-26: 342 of 700 throttled.

Rerun after changing the CIDR or moving hosting platform. Note also that the limiter counts
per instance, so more than one replica multiplies the effective limit (README, known
limitations).
