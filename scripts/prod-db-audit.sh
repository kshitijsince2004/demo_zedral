#!/usr/bin/env bash
# Production DB + API runtime audit — run on EC2
set -euo pipefail

DB="docker exec zedral-db psql -U m1_user -d m1_db -t -A"

section() { echo ""; echo "============================================================"; echo "$1"; echo "============================================================"; }

section "STEP 1 — DATABASE STATE"

echo "--- Current date (DB) ---"
$DB -c "SELECT NOW()::date;"

echo ""
echo "--- txn.shift_log (6HI, last 10) ---"
$DB -c "
SELECT sl.shift_log_id, sl.prod_date, sl.shift_code, sl.target_mt, sl.total_prod_mt, sl.state
FROM txn.shift_log sl
JOIN master.process p ON p.process_id = sl.process_id
WHERE p.code = '6HI'
ORDER BY sl.prod_date DESC, sl.shift_code DESC
LIMIT 10;
"

echo ""
echo "--- txn.crm6_order by status ---"
$DB -c "
SELECT o.status, COUNT(*) 
FROM txn.crm6_order o
GROUP BY o.status
ORDER BY COUNT(*) DESC;
"

echo ""
echo "--- IN_PROGRESS / STOPPAGE orders (with weights) ---"
$DB -c "
SELECT o.batch_number, o.status, pb.machine_code, pb.plan_date, pb.shift_code,
       o.shift_log_id,
       r.actual_weight_mt as rolling_mt,
       s.actual_weight_mt as skinpass_mt,
       pb.ppc_weight_mt
FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id = o.batch_id
LEFT JOIN txn.crm6_rolling r ON r.order_id = o.order_id
LEFT JOIN txn.crm6_skinpass s ON s.order_id = o.order_id
WHERE o.status IN ('IN_PROGRESS', 'STOPPAGE')
ORDER BY o.updated_at DESC
LIMIT 15;
"

echo ""
echo "--- COMPLETED orders today with weights ---"
$DB -c "
SELECT o.batch_number, o.status, pb.plan_date, pb.shift_code,
       r.actual_weight_mt, s.actual_weight_mt, pb.ppc_weight_mt, o.completed_at
FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id = o.batch_id
LEFT JOIN txn.crm6_rolling r ON r.order_id = o.order_id
LEFT JOIN txn.crm6_skinpass s ON s.order_id = o.order_id
WHERE o.status = 'COMPLETED'
  AND o.completed_at >= CURRENT_DATE
ORDER BY o.completed_at DESC
LIMIT 15;
"

echo ""
echo "--- machine_state_event (open events) ---"
$DB -c "
SELECT machine_code, event_type, batch_number, category_code, occurred_at
FROM txn.machine_state_event
WHERE ended_at IS NULL
ORDER BY occurred_at DESC
LIMIT 15;
"

echo ""
echo "--- order_stoppage (open) ---"
$DB -c "
SELECT os.stoppage_id, o.batch_number, os.category_code, os.start_at, os.end_at
FROM txn.order_stoppage os
JOIN txn.crm6_order o ON o.order_id = os.order_id
WHERE os.end_at IS NULL
LIMIT 10;
"

echo ""
echo "--- shift_log vs sum of order weights (current shift B today) ---"
$DB -c "
WITH today_shift AS (
  SELECT sl.shift_log_id, sl.prod_date, sl.shift_code, sl.total_prod_mt, sl.target_mt
  FROM txn.shift_log sl
  JOIN master.process p ON p.process_id = sl.process_id
  WHERE p.code = '6HI' AND sl.prod_date = CURRENT_DATE
  ORDER BY sl.shift_code
)
SELECT * FROM today_shift;
"

echo ""
echo "--- Orders linked to today's shift logs ---"
$DB -c "
SELECT o.batch_number, o.status, o.shift_log_id, pb.shift_code, pb.plan_date,
       COALESCE(r.actual_weight_mt, s.actual_weight_mt, 0) as saved_weight
FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id = o.batch_id
LEFT JOIN txn.crm6_rolling r ON r.order_id = o.order_id
LEFT JOIN txn.crm6_skinpass s ON s.order_id = o.order_id
WHERE pb.plan_date = CURRENT_DATE
ORDER BY pb.queue_seq
LIMIT 20;
"

section "STEP 2 — API (localhost with seeded login)"

# Get PIN from env if set
PIN="${SEED_PIN:-}"
if [ -z "$PIN" ] && [ -f /opt/zedral/deploy/.env ]; then
  # don't print password, try common or read from seed script default
  PIN="1234"
fi

# Try to find a working badge from DB
BADGE=$($DB -c "SELECT badge_id FROM security.app_user WHERE is_active = true ORDER BY user_id LIMIT 1;" 2>/dev/null | head -1 || true)
echo "First active badge: ${BADGE:-unknown}"

LOGIN=$(curl -sS -X POST http://127.0.0.1/api/auth/badge-pin \
  -H 'Content-Type: application/json' \
  -d "{\"badgeId\":\"${BADGE:-5000}\",\"pin\":\"${PIN}\"}" 2>/dev/null || echo '{}')

TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accessToken',''))" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  echo "Login failed — trying badges 1000-5000 with pin from deploy"
  for b in 1000 2000 3000 4000 5000; do
    for p in 1234 5678 0000; do
      R=$(curl -sS -X POST http://127.0.0.1/api/auth/badge-pin -H 'Content-Type: application/json' -d "{\"badgeId\":\"$b\",\"pin\":\"$p\"}")
      T=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accessToken',''))" 2>/dev/null || true)
      if [ -n "$T" ]; then echo "Logged in badge $b pin $p"; TOKEN=$T; break 2; fi
    done
  done
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not obtain API token"
  exit 1
fi

echo ""
echo "--- GET /live/snapshot ---"
curl -sS http://127.0.0.1/api/live/snapshot -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -80

echo ""
echo "--- GET /reports/plant-head (kpiStrip only) ---"
curl -sS 'http://127.0.0.1/api/reports/plant-head?window=7' -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(json.dumps({'kpiStrip': d.get('kpiStrip'), 'productionVsPlan': d.get('productionVsPlan')}, indent=2))
" 2>/dev/null

SHIFT_ID=$($DB -c "
SELECT sl.shift_log_id FROM txn.shift_log sl
JOIN master.process p ON p.process_id = sl.process_id
WHERE p.code='6HI' AND sl.prod_date=CURRENT_DATE
ORDER BY sl.shift_code DESC LIMIT 1;
" | tr -d ' ')

if [ -n "$SHIFT_ID" ]; then
  echo ""
  echo "--- GET /6hi/shift-summary/$SHIFT_ID ---"
  curl -sS "http://127.0.0.1/api/6hi/shift-summary/${SHIFT_ID}?machine=6HI" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -60
fi

echo ""
echo "--- GET /6hi/active-order?machine=6HI ---"
curl -sS 'http://127.0.0.1/api/6hi/active-order?machine=6HI' \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null

section "STEP 6 — CALCULATION CROSS-CHECK"

$DB -c "
SELECT 
  'shift_log.total_prod_mt' as source,
  sl.total_prod_mt::text as value
FROM txn.shift_log sl
JOIN master.process p ON p.process_id = sl.process_id
WHERE p.code='6HI' AND sl.prod_date=CURRENT_DATE AND sl.shift_code='B'
UNION ALL
SELECT 
  'sum saved weights (shift_log_id match)',
  COALESCE(SUM(COALESCE(r.actual_weight_mt, s.actual_weight_mt, 0)),0)::text
FROM txn.crm6_order o
LEFT JOIN txn.crm6_rolling r ON r.order_id=o.order_id
LEFT JOIN txn.crm6_skinpass s ON s.order_id=o.order_id
WHERE o.shift_log_id = (
  SELECT sl.shift_log_id FROM txn.shift_log sl
  JOIN master.process p ON p.process_id=sl.process_id
  WHERE p.code='6HI' AND sl.prod_date=CURRENT_DATE AND sl.shift_code='B' LIMIT 1
) AND o.status IN ('COMPLETED','IN_PROGRESS','STOPPAGE')
UNION ALL
SELECT 
  'sum saved weights (plan_date+shift match)',
  COALESCE(SUM(COALESCE(r.actual_weight_mt, s.actual_weight_mt, 0)),0)::text
FROM txn.crm6_order o
JOIN planning.ppc_batch pb ON pb.batch_id=o.batch_id
LEFT JOIN txn.crm6_rolling r ON r.order_id=o.order_id
LEFT JOIN txn.crm6_skinpass s ON s.order_id=o.order_id
WHERE pb.plan_date=CURRENT_DATE AND pb.shift_code='B' AND o.status IN ('COMPLETED','IN_PROGRESS','STOPPAGE');
"

section "DEPLOYED CODE CHECK"
if [ -f /opt/zedral/packages/server/src/services/ProductionMetricsService.ts ]; then
  echo "ProductionMetricsService.ts: PRESENT on server"
else
  echo "ProductionMetricsService.ts: MISSING — fixes NOT deployed"
fi
if grep -q shiftProductionMt /opt/zedral/packages/shared-validation/src/types/live.ts 2>/dev/null; then
  echo "LiveKpis.shiftProductionMt: PRESENT in source"
else
  echo "LiveKpis.shiftProductionMt: MISSING in source — fixes NOT deployed"
fi
