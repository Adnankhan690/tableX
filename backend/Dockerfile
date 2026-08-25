# tableX API image.
#
# Build context is backend/, not the repository root: the Go module is self-contained there,
# and the frontend workspace is ~140MB of lockfile and node_modules that the API does not
# need. render.yaml sets dockerContext accordingly.

# ---------- build ----------
FROM golang:1.25-alpine AS build

WORKDIR /src

# Dependencies first, as their own layer: go.sum changes far less often than the source, so
# a normal code push reuses the download.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO off because the image below has no libc to link against. Nothing here needs it --
# the Postgres driver is pgx and the SQLite one is glebarez, both pure Go.
# -trimpath keeps build-host paths out of panics; -s -w drops the symbol table.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/tablex ./cmd/server && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

# ---------- runtime ----------
FROM alpine:3.21

# ca-certificates: the Razorpay client and any managed-Postgres TLS connection need a trust
#   store, and alpine ships without one.
# tzdata: Restaurant.Location calls time.LoadLocation. Without the zone database that call
#   fails and every restaurant silently degrades to the IST fallback -- which is invisibly
#   wrong for a venue in any other timezone, and it decides which business date an order is
#   counted against (DECISIONS.md D9).
RUN apk add --no-cache ca-certificates tzdata

# Non-root. Nothing in the container writes to disk; the database holds all state.
RUN addgroup -S tablex && adduser -S -G tablex tablex

WORKDIR /app

COPY --from=build /out/tablex /app/tablex
COPY --from=build /out/migrate /app/migrate

# The configuration file carries the shape and the non-secret production values. Secrets
# arrive as environment variables at run time and are never baked in here.
COPY config/production.yml /app/config/production.yml

USER tablex

EXPOSE 8080

# Migrations are NOT run here. They are a pre-deploy step (see render.yaml), so a failed
# migration stops the rollout with the previous version still serving, rather than turning
# into a crash loop across every replica.
ENTRYPOINT ["/app/tablex"]
CMD ["--config", "/app/config/production.yml"]
