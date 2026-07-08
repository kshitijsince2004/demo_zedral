#!/usr/bin/env bash
set -euo pipefail
TOKEN=""
for b in 1000 2000 3000 4000 5000; do
  for p in 1234 5678 4321 0000; do
    R=$(curl -sS -X POST http://127.0.0.1/api/auth/badge-pin \
      -H 'Content-Type: application/json' \
      -d "{\"badgeId\":\"$b\",\"pin\":\"$p\"}")
    T=$(echo "$R" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("accessToken",""))' 2>/dev/null || true)
    if [ -n "$T" ]; then
      echo "LOGIN badge=$b pin=$p"
      TOKEN=$T
      break 2
    fi
  done
done
if [ -z "$TOKEN" ]; then echo "NO_LOGIN"; exit 1; fi

echo "--- GET /live/snapshot (kpis) ---"
curl -sS http://127.0.0.1/api/live/snapshot -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get("kpis"), indent=2))'

echo "--- GET /reports/plant-head (kpiStrip) ---"
curl -sS 'http://127.0.0.1/api/reports/plant-head?window=7' -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get("kpiStrip"), indent=2))'

echo "--- GET /shift-logs/active/6HI ---"
ACTIVE=$(curl -sS 'http://127.0.0.1/api/shift-logs/active/6HI?date=2026-07-07&shift=B' -H "Authorization: Bearer $TOKEN")
echo "$ACTIVE" | python3 -m json.tool
SID=$(echo "$ACTIVE" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("shiftLogId",""))')
if [ -n "$SID" ]; then
  echo "--- GET /6hi/shift-summary/$SID ---"
  curl -sS "http://127.0.0.1/api/6hi/shift-summary/${SID}?machine=6HI" -H "Authorization: Bearer $TOKEN" \
    | python3 -m json.tool
fi

echo "--- GET /live/machines ---"
curl -sS http://127.0.0.1/api/live/machines -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; ms=json.load(sys.stdin); print(json.dumps([{"code":m.get("machineCode"),"status":m.get("status"),"order":m.get("currentOrder")} for m in ms], indent=2))'
