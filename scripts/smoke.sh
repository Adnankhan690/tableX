#!/usr/bin/env bash
# End-to-end API smoke test.
#
# Exercises the whole product against a running server and a seeded database: the QR scan,
# server-side pricing, idempotent placement, the full order lifecycle, payment settlement,
# role enforcement, tenant isolation, and webhook signature rejection. 68 assertions.
#
# It asserts on real HTTP responses rather than mocks, which is the only way to catch the
# class of bug that unit tests cannot -- a read inside a transaction that misses its own
# uncommitted write, or a partial index whose predicate does not match what the ORM writes.
# Both of those were found here and are now regression-covered below.
#
# Requires a FRESHLY SEEDED database: several assertions check exact order numbers (A-001)
# and totals. Run:
#     make reset && make backend &   # then, once it is listening:
#     ./scripts/smoke.sh
#
# Exits non-zero on any failure, so it is usable as a CI gate.

set -u
API=http://localhost:8080
PUB=$API/api/public/v1
GST=$API/api/guest/v1
ADM=$API/api/admin/v1
QR=demolocaltablequrtoken0000000003
PASS=0; FAIL=0

j() { python3 -c "import sys,json;d=json.load(sys.stdin);
def g(o,p):
  for k in p.split('.'):
    if isinstance(o,list): o=o[int(k)]
    else: o=o.get(k) if o else None
  return o
print(g(d,'$1') if g(d,'$1') is not None else '')" 2>/dev/null; }

ck() { # ck <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1));
  else echo "  FAIL  $1 -- expected [$2] got [$3]"; FAIL=$((FAIL+1)); fi
}

echo "=============== 1. DINER: scan the table QR ==============="
SCAN=$(curl -s $PUB/t/$QR)
TOKEN=$(echo "$SCAN" | j data.session.token)
TABLE=$(echo "$SCAN" | j data.table.label)
RNAME=$(echo "$SCAN" | j data.menu.restaurant.name)
NCAT=$(echo "$SCAN" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['menu']['categories']))")
TAXBPS=$(echo "$SCAN" | j data.menu.tax_bps)
ck "scan returns a session token"        "yes" "$([ -n "$TOKEN" ] && echo yes || echo no)"
ck "scan returns the table label"        "3" "$TABLE"
ck "scan returns the restaurant"         "Spice Garden" "$RNAME"
ck "scan returns the whole menu at once" "7" "$NCAT"
ck "scan returns the tax rate"           "500" "$TAXBPS"

echo "--- the two sold-out items are returned, not hidden ---"
SOLDOUT=$(echo "$SCAN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']['menu']['categories']
items=[i for c in d for i in c['items']]
print(sum(1 for i in items if not i['is_available']))")
TOTITEMS=$(echo "$SCAN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']['menu']['categories']
print(sum(len(c['items']) for c in d))")
ck "all 28 items present"                "28" "$TOTITEMS"
ck "sold-out items greyed not hidden"    "2" "$SOLDOUT"

echo "--- an unknown QR token is a friendly dead end, not a 500 ---"
BADQR=$(curl -s -o /dev/null -w "%{http_code}" $PUB/t/nosuchtokenatall)
BADCODE=$(curl -s $PUB/t/nosuchtokenatall | j code)
ck "unknown QR -> 404"                   "404" "$BADQR"
ck "unknown QR -> TX_TBL_004"            "TX_TBL_004" "$BADCODE"

echo
echo "=============== 2. DINER: place an order ==============="
PANEER=$(echo "$SCAN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']['menu']['categories']
for c in d:
  for i in c['items']:
    if i['name']=='Paneer Tikka': print(i['uid'])")
NAAN=$(echo "$SCAN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']['menu']['categories']
for c in d:
  for i in c['items']:
    if i['name']=='Garlic Naan': print(i['uid'])")

IDEM=$(python3 -c "import uuid;print(uuid.uuid4())")
BODY="{\"items\":[{\"menu_item_uid\":\"$PANEER\",\"quantity\":2},{\"menu_item_uid\":\"$NAAN\",\"quantity\":3,\"note\":\"extra garlic\"}],\"payment_method\":\"counter\",\"customer_name\":\"Anita\",\"note\":\"less spicy\"}"

ORD=$(curl -s -X POST $GST/orders -H "X-Guest-Token: $TOKEN" -H "Idempotency-Key: $IDEM" -H 'Content-Type: application/json' -d "$BODY")
OUID=$(echo "$ORD" | j data.order.uid)
ONUM=$(echo "$ORD" | j data.order.order_number)
SUB=$(echo "$ORD" | j data.order.totals.subtotal.minor)
TAX=$(echo "$ORD" | j data.order.totals.tax.minor)
TOT=$(echo "$ORD" | j data.order.totals.total.minor)
DISP=$(echo "$ORD" | j data.order.totals.total.display)
STATUS=$(echo "$ORD" | j data.order.status)
CANCANCEL=$(echo "$ORD" | j data.order.can_guest_cancel)

# 2 x Paneer Tikka @ 28000 = 56000; 3 x Garlic Naan @ 6500 = 19500; subtotal 75500
# tax 5% of 75500 = 3775; total 79275
ck "order created"                       "yes" "$([ -n "$OUID" ] && echo yes || echo no)"
ck "human order number allocated"        "A-001" "$ONUM"
ck "subtotal priced server-side"         "75500" "$SUB"
ck "tax = 5% of subtotal, integer math"  "3775" "$TAX"
ck "total = subtotal + tax"              "79275" "$TOT"
ck "display uses Indian grouping"        "₹792.75" "$DISP"
ck "starts at placed"                    "placed" "$STATUS"
ck "guest may cancel while placed"       "True" "$CANCANCEL"

echo "--- the client cannot dictate a price ---"
CHEAT=$(curl -s -X POST $GST/orders -H "X-Guest-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"menu_item_uid\":\"$PANEER\",\"quantity\":1}],\"payment_method\":\"counter\",\"total_minor\":1,\"subtotal_minor\":1}")
CHEATTOT=$(echo "$CHEAT" | j data.order.totals.total.minor)
ck "injected total_minor ignored"        "29400" "$CHEATTOT"

echo "--- idempotency: the same key must not create a second order (D12) ---"
REPLAY=$(curl -s -X POST $GST/orders -H "X-Guest-Token: $TOKEN" -H "Idempotency-Key: $IDEM" -H 'Content-Type: application/json' -d "$BODY")
RUID=$(echo "$REPLAY" | j data.order.uid)
ck "replay returns the SAME order"       "$OUID" "$RUID"

echo "--- a sold-out dish is refused at checkout, by name ---"
RASMALAI=$(echo "$SCAN" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']['menu']['categories']
for c in d:
  for i in c['items']:
    if i['name']=='Ras Malai': print(i['uid'])")
SOLD=$(curl -s -X POST $GST/orders -H "X-Guest-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"menu_item_uid\":\"$RASMALAI\",\"quantity\":1}],\"payment_method\":\"counter\"}")
SOLDCODE=$(echo "$SOLD" | j code)
SOLDMSG=$(echo "$SOLD" | j message)
ck "unavailable item -> TX_MNU_018"      "TX_MNU_018" "$SOLDCODE"
ck "message names the dish"              "Ras Malai is no longer available" "$SOLDMSG"

echo "--- duplicate lines are merged, not rejected ---"
DUP=$(curl -s -X POST $GST/orders -H "X-Guest-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"menu_item_uid\":\"$NAAN\",\"quantity\":1},{\"menu_item_uid\":\"$NAAN\",\"quantity\":2}],\"payment_method\":\"counter\"}")
DUPQTY=$(echo "$DUP" | j data.order.items.0.quantity)
DUPLINES=$(echo "$DUP" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['order']['items']))")
ck "duplicate lines merged to one"       "1" "$DUPLINES"
ck "quantities summed"                   "3" "$DUPQTY"

echo "--- no session, no ordering ---"
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST $GST/orders -H 'Content-Type: application/json' -d "$BODY")
ck "missing guest token -> 401"          "401" "$NOAUTH"

echo
echo "=============== 3. ADMIN: sign in ==============="
LOGIN=$(curl -s -X POST $ADM/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@spicegarden.test","password":"password123"}')
JWT=$(echo "$LOGIN" | j data.access_token)
ROLE=$(echo "$LOGIN" | j data.staff.role)
ck "owner login succeeds"                "yes" "$([ -n "$JWT" ] && echo yes || echo no)"
ck "role returned"                       "owner" "$ROLE"

echo "--- a wrong password and an unknown email are indistinguishable ---"
WRONGPW=$(curl -s -X POST $ADM/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@spicegarden.test","password":"wrong"}' | j message)
NOUSER=$(curl -s -X POST $ADM/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"nobody@nowhere.test","password":"wrong"}' | j message)
ck "same message for both"               "$WRONGPW" "$NOUSER"
ck "message is non-committal"            "incorrect email or password" "$WRONGPW"

echo "--- no token, no admin ---"
NOJWT=$(curl -s -o /dev/null -w "%{http_code}" $ADM/orders)
ck "admin route without JWT -> 401"      "401" "$NOJWT"

echo
echo "=============== 4. ADMIN: the order queue ==============="
LIST=$(curl -s "$ADM/orders?live=true" -H "Authorization: Bearer $JWT")
NLIVE=$(echo "$LIST" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['orders']))")
FIRSTNUM=$(echo "$LIST" | j data.orders.0.order_number)
NEXTS=$(echo "$LIST" | python3 -c "import sys,json;print(','.join(json.load(sys.stdin)['data']['orders'][-1]['next_statuses']))")
ck "live orders visible to staff"        "yes" "$([ "$NLIVE" -ge 1 ] && echo yes || echo no)"
ck "server dictates the legal buttons"   "accepted,cancelled,rejected" "$NEXTS"

echo
echo "=============== 5. THE ORDER LIFECYCLE (D1) ==============="
tr() { curl -s -X POST $ADM/orders/$1/transition -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' -d "{\"status\":\"$2\"${3:+,\"reason\":\"$3\"}}"; }

echo "--- states cannot be skipped ---"
SKIP=$(tr "$OUID" served)
ck "placed -> served refused (409)"      "TX_ORD_006" "$(echo "$SKIP" | j code)"

echo "--- reject requires a reason ---"
NOREASON=$(tr "$OUID" rejected)
ck "reject with no reason -> TX_ORD_015" "TX_ORD_015" "$(echo "$NOREASON" | j code)"

echo "--- the happy path ---"
for step in accepted preparing ready served; do
  R=$(tr "$OUID" $step)
  ck "-> $step" "$step" "$(echo "$R" | j data.status)"
done

echo "--- a second accept loses the race, and is told so ---"
DOUBLE=$(tr "$OUID" accepted)
ck "re-accept -> TX_ORD_007"             "TX_ORD_007" "$(echo "$DOUBLE" | j code)"

echo "--- the guest cancel window has closed (D6) ---"
LATE=$(curl -s -X POST $GST/orders/$OUID/cancel -H "X-Guest-Token: $TOKEN")
ck "guest cancel after accept -> TX_ORD_010" "TX_ORD_010" "$(echo "$LATE" | j code)"

echo
echo "=============== 6. PAYMENT: staff confirmation (D2) ==============="
PAY=$(curl -s -X POST $ADM/orders/$OUID/payment/confirm -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' -d '{"reference":"UTR123456","note":"cash at counter"}')
ck "payment confirmed"                   "paid" "$(echo "$PAY" | j data.status)"

AFTER=$(curl -s $ADM/orders/$OUID -H "Authorization: Bearer $JWT")
ck "order auto-completed on payment"     "completed" "$(echo "$AFTER" | j data.status)"
ck "payment status recorded"             "paid" "$(echo "$AFTER" | j data.payment_status)"
ck "no further transitions offered"      "" "$(echo "$AFTER" | python3 -c "import sys,json;print(','.join(json.load(sys.stdin)['data'].get('next_statuses') or []))")"

echo "--- double settlement refused ---"
AGAIN=$(curl -s -X POST $ADM/orders/$OUID/payment/confirm -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}')
ck "second confirm -> TX_PAY_002"        "TX_PAY_002" "$(echo "$AGAIN" | j code)"

echo "--- a closed order is closed ---"
CLOSED=$(tr "$OUID" preparing)
ck "transition on completed -> TX_ORD_008" "TX_ORD_008" "$(echo "$CLOSED" | j code)"

echo "--- the audit trail is complete ---"
TL=$(echo "$AFTER" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(','.join(e['status'] for e in d.get('timeline') or []))")
ck "timeline records every transition"   "placed,accepted,preparing,ready,served,completed" "$TL"

echo
echo "=============== 7. DINER: tracking their own order ==============="
MINE=$(curl -s $GST/orders/$OUID -H "X-Guest-Token: $TOKEN")
ck "diner sees the final status"         "completed" "$(echo "$MINE" | j data.status)"
MYLIST=$(curl -s $GST/orders -H "X-Guest-Token: $TOKEN")
NMINE=$(echo "$MYLIST" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['orders']))")
ck "session sees its own orders (D5)"    "yes" "$([ "$NMINE" -ge 3 ] && echo yes || echo no)"

echo "--- another table's session cannot read this order ---"
OTHER=$(curl -s $PUB/t/demolocaltablequrtoken0000000005 | j data.session.token)
STEAL=$(curl -s -o /dev/null -w "%{http_code}" $GST/orders/$OUID -H "X-Guest-Token: $OTHER")
STEALC=$(curl -s $GST/orders/$OUID -H "X-Guest-Token: $OTHER" | j code)
ck "other session -> 404 not 403"        "404" "$STEAL"
ck "existence not confirmed"             "TX_ORD_009" "$STEALC"

echo
echo "=============== 8. UPI PAYMENT (D2) ==============="
UPIORD=$(curl -s -X POST $GST/orders -H "X-Guest-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"menu_item_uid\":\"$PANEER\",\"quantity\":1}],\"payment_method\":\"online_upi\"}")
UUID=$(echo "$UPIORD" | j data.order.uid)
INTENT=$(echo "$UPIORD" | j data.payment.upi_intent_url)
REF=$(echo "$UPIORD" | j data.payment.reference)
MANUAL=$(echo "$UPIORD" | j data.payment.requires_manual_confirmation)
HASQR=$(echo "$UPIORD" | python3 -c "import sys,json;d=json.load(sys.stdin);print('yes' if (d['data'].get('payment') or {}).get('qr_png_base64') else 'no')")
ck "UPI order gets an intent URL"        "yes" "$([ -n "$INTENT" ] && echo yes || echo no)"
ck "intent is a upi:// deep link"        "yes" "$(echo "$INTENT" | grep -q '^upi://pay?' && echo yes || echo no)"
ck "amount encoded correctly"            "yes" "$(echo "$INTENT" | grep -q 'am=294.00' && echo yes || echo no)"
ck "payee VPA from the restaurant"       "yes" "$(echo "$INTENT" | grep -q 'spicegarden%40okhdfcbank' && echo yes || echo no)"
ck "reference in the transaction note"   "yes" "$(echo "$INTENT" | grep -q "$REF" && echo yes || echo no)"
ck "scannable QR rendered server-side"   "yes" "$HASQR"
ck "static UPI admits it cannot confirm" "True" "$MANUAL"

echo
echo "=============== 9. ROLES (D3) ==============="
SLOGIN=$(curl -s -X POST $ADM/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"staff@spicegarden.test","password":"password123"}')
SJWT=$(echo "$SLOGIN" | j data.access_token)
NEWITEM=$(curl -s -o /dev/null -w "%{http_code}" -X POST $ADM/menu/items -H "Authorization: Bearer $SJWT" \
  -H 'Content-Type: application/json' -d "{\"category_uid\":\"x\",\"name\":\"Test\",\"price_minor\":100,\"food_type\":\"veg\"}")
ck "floor staff cannot add menu items"   "403" "$NEWITEM"
AVAIL=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH $ADM/menu/items/$PANEER/availability -H "Authorization: Bearer $SJWT" \
  -H 'Content-Type: application/json' -d '{"is_available":false}')
ck "floor staff CAN mark sold out"       "200" "$AVAIL"
# restore
curl -s -X PATCH $ADM/menu/items/$PANEER/availability -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' -d '{"is_available":true}' >/dev/null
STAFFADD=$(curl -s -o /dev/null -w "%{http_code}" -X POST $ADM/staff -H "Authorization: Bearer $SJWT" \
  -H 'Content-Type: application/json' -d '{"name":"X","email":"x@y.test","password":"password123","role":"staff"}')
ck "only owners create staff"            "403" "$STAFFADD"

echo
echo "=============== 10. QR & TABLES (D4) ==============="
TABLES=$(curl -s $ADM/tables -H "Authorization: Bearer $JWT")
NTAB=$(echo "$TABLES" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['tables']))")
T3UID=$(echo "$TABLES" | python3 -c "
import sys,json
for t in json.load(sys.stdin)['data']['tables']:
  if t['label']=='3': print(t['uid'])")
ck "all 8 tables listed"                 "8" "$NTAB"
QRR=$(curl -s "$ADM/tables/$T3UID/qr?size=256" -H "Authorization: Bearer $JWT")
ck "QR URL points at the diner app"      "yes" "$(echo "$QRR" | j data.qr_url | grep -q "localhost:3000/t/$QR" && echo yes || echo no)"
ck "QR PNG rendered"                     "yes" "$([ -n "$(echo "$QRR" | j data.png_base64)" ] && echo yes || echo no)"

echo "--- the public landing must not leak the qr_token (D4) ---"
LAND=$(curl -s $PUB/r/spice-garden)
echo "$LAND" > /tmp/tx_land.json
ck "landing lists tables"                "8" "$(python3 -c "import json;print(len(json.load(open('/tmp/tx_land.json'))['data']['tables']))")"
LEAKS=$(python3 -c "
raw=open('/tmp/tx_land.json').read()
bad=[k for k in ('qr_token','upi_vpa','gst_number','tax_bps','password') if k in raw]
print(','.join(bad) if bad else 'none')")
ck "no staff-only field leaks publicly"  "none" "$LEAKS"

echo
echo "=============== 11. STATS (PRD 3) ==============="
ST=$(curl -s $ADM/stats/today -H "Authorization: Bearer $JWT")
ck "orders counted today"                "yes" "$([ "$(echo "$ST" | j orders_placed)" != "" ] || [ "$(echo "$ST" | j data.orders_placed)" != "" ] && echo yes || echo no)"
echo "  stats: $(echo "$ST" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data') or {}
print('placed=%s live=%s completed=%s revenue=%s unpaid=%s accept_avg=%s' % (
 d.get('orders_placed'),d.get('orders_live'),d.get('orders_completed'),
 (d.get('revenue') or {}).get('display'),(d.get('unpaid_amount') or {}).get('display'),
 d.get('avg_accept_secs')))" 2>/dev/null)"

echo
echo "=============== 12. WEBHOOK SECURITY (D2) ==============="
UNSIGNED=$(curl -s -o /dev/null -w "%{http_code}" -X POST $PUB/webhooks/payments/razorpay \
  -H 'Content-Type: application/json' -d '{"event":"payment.captured"}')
ck "unsigned razorpay webhook rejected"  "409" "$UNSIGNED"
BOGUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST $PUB/webhooks/payments/nosuchprovider -d '{}')
ck "unknown provider rejected"           "409" "$BOGUS"

echo
echo "==================================================="
echo "  PASS: $PASS    FAIL: $FAIL"
echo "==================================================="
[ "$FAIL" -eq 0 ] || exit 1
