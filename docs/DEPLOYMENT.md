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
... 14 lines ...
applied 14 migration(s)
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

## Cloudflare R2 — dish photos (optional)

Unset, uploads are disabled: the admin panel hides the control and dishes keep whatever
`image_url` was pasted into them. That is a working deployment (DECISIONS.md D15).

**All five or none.** A partially filled block *fails startup* rather than quietly disabling
uploads — nobody fills in three of five on purpose, and silent disabling would let a deploy
meant to enable them report success.

| Variable | Where it comes from |
|---|---|
| `TABLEX_R2_ACCOUNT_ID` | R2 → Overview, the account ID in the endpoint URL |
| `TABLEX_R2_ACCESS_KEY_ID` | R2 → Manage API Tokens |
| `TABLEX_R2_SECRET_ACCESS_KEY` | shown **once**, at token creation |
| `TABLEX_R2_BUCKET` | the bucket name |
| `TABLEX_R2_PUBLIC_BASE_URL` | `https://img.tabley.in` — a custom domain on the bucket |

### Setting it up

1. **R2 → Create bucket.** Name it (`tablex-images`), location Automatic.
2. **Manage API Tokens → Create API token.** Permission **Object Read & Write**, scoped to
   *this bucket only*. Copy both halves; the secret is shown once.
3. **Bucket → Settings → Public access → Connect Domain.** Add `img.tabley.in`. This is the
   value `TABLEX_R2_PUBLIC_BASE_URL` takes.
4. **Bucket → Settings → CORS policy.** Without this the browser's PUT fails with a network
   error and status 0, which reads as "storage is down":

   ```json
   [{ "AllowedOrigins": ["https://admin.tabley.in"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["content-type"],
      "MaxAgeSeconds": 3600 }]
   ```

5. **Bucket → Settings → Object lifecycle rules.** Add one on prefix `menu/` deleting
   incomplete multipart uploads and, if you want the sweeper, aged objects. **This is the only
   thing that reclaims an abandoned upload** — a file PUT but never confirmed is referenced by
   nothing and nothing in the application deletes it (D15 says so plainly).
6. Add the `img.tabley.in` host to `images.remotePatterns` in both `next.config.ts` files if
   you narrow them from the current wildcard.

### The three ways this goes wrong

**`TABLEX_R2_PUBLIC_BASE_URL` set to the API endpoint.** `<account>.r2.cloudflarestorage.com`
is authenticated and serves nothing publicly, so every dish photo 401s while the bucket,
credentials and keys are all correct. Startup rejects this value by name.

**http instead of https.** Browsers block mixed content, so the menu renders with no
photographs and no error. Startup refuses it in production.

**No CORS policy on the bucket.** Presigning succeeds, the PUT fails at the browser with no
usable detail. Check this first if uploads fail and nothing appears in the API logs — the
upload never reaches the API, so its logs will show the presign and then nothing.

### It is not AWS

`internal/storage/r2.go` imports `github.com/aws/aws-sdk-go-v2/service/s3`. R2 publishes no Go
SDK and speaks the S3 protocol, so that package is the protocol client pointed at Cloudflare.
No AWS account is involved, and AWS credentials will not work in these variables.

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
2. Run the migration (above). Confirm `applied 14 migration(s)`.
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

One thing that cannot be verified from a laptop: `TABLEX_TRUSTED_PROXIES` is set to
`10.0.0.0/8` on the assumption that Render's ingress forwards from that range. If the CIDR
is wrong, Gin reads the wrong entry from `X-Forwarded-For`, the client IP becomes
attacker-controlled, and the per-IP rate limiter stops limiting — silently, and while
appearing healthy. Check a real request's logged client IP against its true public IP.
