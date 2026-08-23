#!/usr/bin/env bash
# Concurrency test.
#
# Verifies the three races that actually happen in a restaurant, and that the row locking in
# DECISIONS.md D1, D9 and D12 handles them:
#
#   A. Two staff devices tap Accept on the same order at the same moment.
#      Exactly one must win; the rest must get 409, never a silent second success.
#   B. Twenty diners check out simultaneously.
#      Every order must get a distinct human order number -- SELECT COUNT(*) would give
#      several of them the same one.
#   C. One diner double-taps Place Order on a stalled connection.
#      Every duplicate must resolve to the SAME order, with no error surfaced.
#
# These pass only against Postgres. SQLite has no SELECT ... FOR UPDATE, which is why the
# unit tests use SQLite for speed and this runs against the real thing.
#
#     make up && make migrate && make seed && make backend &
#     ./scripts/concurrency.sh

set -u
API=http://localhost:8080
PUB=$API/api/public/v1; GST=$API/api/guest/v1; ADM=$API/api/admin/v1
j(){ python3 -c "import sys,json;d=json.load(sys.stdin)
o=d
for k in '$1'.split('.'):
  o=o[int(k)] if isinstance(o,list) else (o.get(k) if o else None)
print(o if o is not None else '')" 2>/dev/null; }

JWT=$(curl -s -X POST $ADM/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@spicegarden.test","password":"password123"}' | j data.access_token)

echo "=== A. Two staff devices tap Accept simultaneously (D1) ==="
echo "    Exactly one must win; the other must get a 409, not a silent success."
WINS=0; CONFLICTS=0; OTHER=0
for trial in 1 2 3 4 5; do
  TOK=$(curl -s $PUB/t/demolocaltablequrtoken0000000001 | j data.session.token)
  ITEM=$(curl -s $GST/menu -H "X-Guest-Token: $TOK" | python3 -c "
import sys,json
print(json.load(sys.stdin)['data']['categories'][0]['items'][0]['uid'])")
  OUID=$(curl -s -X POST $GST/orders -H "X-Guest-Token: $TOK" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"menu_item_uid\":\"$ITEM\",\"quantity\":1}],\"payment_method\":\"counter\"}" | j data.order.uid)

  # Fire eight concurrent accepts at the same order.
  rm -f /tmp/tx_acc_*.txt
  for n in $(seq 1 8); do
    ( curl -s -o /dev/null -w "%{http_code}" -X POST $ADM/orders/$OUID/transition \
        -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
        -d '{"status":"accepted"}' > /tmp/tx_acc_$n.txt ) &
  done
  wait

  w=$(grep -l '^200$' /tmp/tx_acc_*.txt 2>/dev/null | wc -l | tr -d ' ')
  c=$(grep -l '^409$' /tmp/tx_acc_*.txt 2>/dev/null | wc -l | tr -d ' ')
  o=$((8 - w - c))
  WINS=$((WINS+w)); CONFLICTS=$((CONFLICTS+c)); OTHER=$((OTHER+o))
  printf "    trial %d: %d accepted, %d conflicted, %d other\n" "$trial" "$w" "$c" "$o"
done
echo "    ---"
echo "    total: $WINS won, $CONFLICTS conflicted, $OTHER unexpected  (want 5 / 35 / 0)"
[ "$WINS" -eq 5 ] && [ "$CONFLICTS" -eq 35 ] && [ "$OTHER" -eq 0 ] \
  && echo "    PASS  exactly one winner per order" \
  || echo "    FAIL  the lock did not serialise accepts"

echo
echo "=== B. Concurrent order placement must never reuse an order number (D9) ==="
echo "    20 diners checking out at once."
TOK=$(curl -s $PUB/t/demolocaltablequrtoken0000000002 | j data.session.token)
ITEM=$(curl -s $GST/menu -H "X-Guest-Token: $TOK" | python3 -c "
import sys,json
print(json.load(sys.stdin)['data']['categories'][0]['items'][0]['uid'])")
rm -f /tmp/tx_num_*.txt
for n in $(seq 1 20); do
  ( curl -s -X POST $GST/orders -H "X-Guest-Token: $TOK" -H 'Content-Type: application/json' \
      -d "{\"items\":[{\"menu_item_uid\":\"$ITEM\",\"quantity\":1}],\"payment_method\":\"counter\"}" \
      | python3 -c "import sys,json
try: print(json.load(sys.stdin)['data']['order']['order_number'])
except Exception: print('ERR')" > /tmp/tx_num_$n.txt ) &
done
wait
cat /tmp/tx_num_*.txt | sort > /tmp/tx_nums_all.txt
TOTAL=$(grep -vc ERR /tmp/tx_nums_all.txt || true)
UNIQ=$(grep -v ERR /tmp/tx_nums_all.txt | sort -u | wc -l | tr -d ' ')
ERRS=$(grep -c ERR /tmp/tx_nums_all.txt || true)
echo "    placed: $TOTAL   distinct numbers: $UNIQ   errors: $ERRS"
if [ "$TOTAL" -eq "$UNIQ" ] && [ "$ERRS" -eq 0 ]; then
  echo "    PASS  every concurrent order got a unique number"
else
  echo "    FAIL  duplicate or failed allocation"
  grep -v ERR /tmp/tx_nums_all.txt | sort | uniq -d | sed 's/^/      duplicate: /'
fi

echo
echo "=== C. Idempotency under concurrency (D12) ==="
echo "    The same key fired 10 times at once must yield ONE order."
TOK=$(curl -s $PUB/t/demolocaltablequrtoken0000000004 | j data.session.token)
ITEM=$(curl -s $GST/menu -H "X-Guest-Token: $TOK" | python3 -c "
import sys,json
print(json.load(sys.stdin)['data']['categories'][0]['items'][0]['uid'])")
KEY=$(python3 -c "import uuid;print(uuid.uuid4())")
rm -f /tmp/tx_idem_*.txt
for n in $(seq 1 10); do
  ( curl -s -X POST $GST/orders -H "X-Guest-Token: $TOK" -H "Idempotency-Key: $KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"items\":[{\"menu_item_uid\":\"$ITEM\",\"quantity\":1}],\"payment_method\":\"counter\"}" \
      | python3 -c "import sys,json
try: print(json.load(sys.stdin)['data']['order']['uid'])
except Exception: print('ERR')" > /tmp/tx_idem_$n.txt ) &
done
wait
IDU=$(cat /tmp/tx_idem_*.txt | grep -v ERR | sort -u | wc -l | tr -d ' ')
IDE=$(cat /tmp/tx_idem_*.txt | grep -c ERR || true)
echo "    distinct orders created: $IDU   errors: $IDE"
[ "$IDU" -eq 1 ] && echo "    PASS  one order despite 10 concurrent submits" \
  || echo "    FAIL  the double-tap created $IDU orders"

echo
echo "=== D. Database-level confirmation ==="
docker exec tablex-postgres psql -U postgres -d tablex -tAc "
SELECT '    orders: ' || COUNT(*) || ',  distinct order_numbers: ' || COUNT(DISTINCT order_number)
FROM orders;"
docker exec tablex-postgres psql -U postgres -d tablex -tAc "
SELECT '    accepted-transition events: ' || COUNT(*) || ' (must equal the number of accepted orders)'
FROM order_status_event WHERE to_status='accepted';"
docker exec tablex-postgres psql -U postgres -d tablex -tAc "
SELECT '    orders that reached accepted-or-beyond: ' || COUNT(*)
FROM orders WHERE accepted_at IS NOT NULL;"
