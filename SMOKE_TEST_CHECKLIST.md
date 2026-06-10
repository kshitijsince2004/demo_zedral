# Smoke Test Checklist — Hero Steels Pilot

Use after every production deploy and weekly during pilot operation.

**Automated:** Deploy workflow runs `/health` smoke test when `GCP_PUBLIC_URL` is set.  
**Manual:** Complete this checklist for full functional verification.

---

## Environment Setup

- [ ] URL: `https://<production-domain>`
- [ ] Test users provisioned with **non-default PINs** (not 1234/0000)
- [ ] Browser: Chrome/Edge on operator kiosk or laptop

### Test Users (Example)

| Role | Badge | Purpose |
|------|-------|---------|
| Operator | 3000 | Production entry |
| Supervisor | 2000 | Override, device setup |
| Plant Head | 1001 | Dashboard, reports |
| Admin | 1000 | User/machine admin |

---

## 1. Authentication

### Login
- [ ] Navigate to `/login`
- [ ] Enter operator badge + PIN
- [ ] Redirected to `/:userScope` (e.g. `/operator.operator`)
- [ ] No console errors

### Token Refresh
- [ ] Wait 16+ minutes OR manually expire token in devtools
- [ ] Perform an action (load queue)
- [ ] Request succeeds without re-login

### Logout
- [ ] Click logout
- [ ] Redirected to `/login`
- [ ] Back button does not restore session
- [ ] `/api/live/snapshot` returns 401 without token

### Screen Lock (Server PIN)
- [ ] Wait 15 min inactivity OR trigger lock in devtools
- [ ] Lock screen appears
- [ ] Wrong PIN shows error
- [ ] Correct PIN unlocks (verified via `POST /auth/verify-pin`)
- [ ] PIN `1234` does **not** work unless it is the user's actual PIN

---

## 2. Operator Flow

### Machine Selection
- [ ] CRM mill visible in nav rail (if assigned)
- [ ] Switch machine updates workspace

### Production Entry
- [ ] Open active order from queue
- [ ] Record rolling pass values
- [ ] Save succeeds, values persist on refresh

### Stoppage Entry
- [ ] Start stoppage on active order
- [ ] End stoppage
- [ ] Duration appears in stoppage list

### Defect Entry
- [ ] Record defect/rejection on order
- [ ] Defect count updates

### Shift Handover
- [ ] Navigate to handover page
- [ ] Complete outgoing handover
- [ ] Next shift operator sees handover accept gate
- [ ] Accept handover unlocks capture

---

## 3. Machine Head Flow

- [ ] Login as machine head
- [ ] `/machine-head-dashboard` loads
- [ ] Live machine cards show status
- [ ] Order list visible with runtime

---

## 4. Plant Head Flow

- [ ] Login as plant head
- [ ] `/plant` dashboard loads within 10s
- [ ] KPI strip shows OEE, production, quality values (not all zeros if data exists)
- [ ] Production vs plan chart renders
- [ ] Navigate to export history — past jobs listed

### Reports
- [ ] Trigger line log export (Excel)
- [ ] Job completes with download link
- [ ] DPR export page accessible

---

## 5. Exports

### Excel (Line Log / Raw)
- [ ] Request export from `/reports/export`
- [ ] Job status progresses to `completed`
- [ ] Download opens valid `.xlsx`

### DPR
- [ ] Navigate to DPR export
- [ ] Generate current month DPR
- [ ] Job completes, file downloadable

### PDF
- [ ] Request PDF export if available
- [ ] **Known limitation:** PDF may fail in Alpine container without Chromium — Excel is primary for pilot

---

## 6. Security Checks

- [ ] `AUTH_STRICT=true` in production `.env`
- [ ] `/setup` requires supervisor/admin login
- [ ] Unauthenticated `POST /device/register` returns 401
- [ ] Supervisor override in form requires valid supervisor PIN (not hardcoded 1234)
- [ ] `/health` returns `database: ok`

---

## 7. Infrastructure

- [ ] HTTPS certificate valid
- [ ] HTTP redirects to HTTPS
- [ ] Backup file exists in `/var/backups/zedral/` (after first cron run)
- [ ] `docker compose ps` — all containers healthy

---

## Automated API Smoke (Optional)

From VM or CI:

```bash
BASE="https://zedral.hero-steels.example.com"

# Health
curl -fsS "${BASE}/health" | jq .

# Auth (replace credentials)
TOKEN=$(curl -fsS -X POST "${BASE}/api/auth/badge-pin" \
  -H "Content-Type: application/json" \
  -d '{"badgeId":"3000","pin":"<PIN>"}' | jq -r .accessToken)

# Protected endpoint
curl -fsS "${BASE}/api/live/snapshot" \
  -H "Authorization: Bearer ${TOKEN}" | jq .refreshedAt
```

Existing scripts: `npm run smoke:api -w @m1/server` (local/dev).

---

## Sign-Off

| Tester | Date | Pass/Fail | Notes |
|--------|------|-----------|-------|
| | | | |

---

*Complete all Critical (sections 1, 6, 7) items before opening pilot to operators.*
