#!/usr/bin/env bash
# Runs the Bruno API collection against a running server.
#
# Wraps `bru run` for two reasons that are not obvious:
#
#  1. **The exit code cannot be trusted on its own.** Bruno exits 1 whenever any response is
#     non-2xx, even when every assertion passed. This collection deliberately asserts three
#     refusals -- rejecting a served order, cancelling a nonexistent line, failing an already-paid
#     payment -- so it can never exit 0. Verifying a refusal is worth more than a green exit code,
#     so this script judges on the JSON report's test results instead.
#
#  2. **The collection is not idempotent.** Requests chain state and several assert exact
#     statuses ("this order is now accepted"), which only holds against a freshly seeded database.
#     The alternative -- loosening every assertion to "200 or 409" -- would let real regressions
#     pass, which is how an API collection becomes decoration. So this reseeds first.
#
# Usage:
#     make backend &            # API on :8080
#     ./scripts/api-collection.sh
#
# Requires @usebruno/cli (bun add -D @usebruno/cli) and Docker for the reseed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRU="$ROOT/node_modules/.bin/bru"
COLLECTION="$ROOT/backend/api_collection"
REPORT="${TMPDIR:-/tmp}/tablex-bruno-report.json"

DB_CONTAINER="${DB_CONTAINER:-tablex-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-tablex}"

if [ ! -x "$BRU" ]; then
  echo "Bruno CLI not found at $BRU"
  echo "Install it with:  bun add -D @usebruno/cli"
  exit 1
fi

if ! curl -sf -o /dev/null -m 5 http://localhost:8080/api/public/v1/health/live; then
  echo "The API is not answering on :8080. Start it with:  make backend"
  exit 1
fi

echo "==> reseeding, so the sequenced assertions start from a known state"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q -c "
  TRUNCATE payment_webhook_event, payment, order_status_event, order_item, orders, order_counter,
           guest_session, menu_item, menu_category, restaurant_table, staff_user, restaurant
  RESTART IDENTITY CASCADE;" >/dev/null
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
  < "$ROOT/backend/seeds/local_seed.sql" >/dev/null

echo "==> running the collection"
# --exclude-tags manual skips the two WebSocket handshake requests. A 101 response leaves the
# connection upgraded, which silently halts Bruno's HTTP runner -- every request after it is
# skipped, with no error and a zero exit code. They are for driving by hand.
(cd "$COLLECTION" && "$BRU" run . --env local -r \
  --exclude-tags manual --reporter-json "$REPORT") | tail -n 40

python3 - "$REPORT" <<'PY'
import json, sys

with open(sys.argv[1]) as fh:
    report = json.load(fh)

def requests(node):
    """Yield every request result, whatever nesting this CLI version used."""
    if isinstance(node, dict):
        if "testResults" in node or "assertionResults" in node:
            yield node
        for value in node.values():
            yield from requests(value)
    elif isinstance(node, list):
        for value in node:
            yield from requests(value)

passed, failed = 0, []
for req in requests(report):
    name = req.get("suitename") or (req.get("request") or {}).get("url", "?")
    for test in (req.get("testResults") or []) + (req.get("assertionResults") or []):
        if test.get("status") == "pass":
            passed += 1
        else:
            failed.append(f"{name}: {test.get('description') or test.get('lhsExpr')} "
                          f"-- {test.get('error', 'failed')}")

print()
print("=" * 60)
print(f"  assertions passed: {passed}")
print(f"  assertions failed: {len(failed)}")
print("=" * 60)
for line in failed:
    print("  FAIL", line)

# Judged on assertions, not on Bruno's exit code -- see the header.
sys.exit(1 if failed else 0)
PY
