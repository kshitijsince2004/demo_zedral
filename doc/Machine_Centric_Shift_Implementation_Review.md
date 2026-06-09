# Machine-Centric Shift Management — Implementation Review

**Status:** Pre-implementation analysis  
**Overrides:** All prior shift workflow assumptions (line-centric handover, shift-boundary order restart, CRM summary-only “end shift”)

---

## 1. Core principle vs current system

| Principle (new spec) | Current implementation | Gap |
|------------------------|------------------------|-----|
| Shifts change; machines do not stop | Handover closes outgoing `shift_log` (SUBMITTED) and creates new DRAFT; carry-forward moves open **line entries** | CRM orders use `txn.crm6_order.status`, not `time_to` — **active orders are not carried** and are **not stopped** at boundary (good) but **no pending handover** is created |
| Orders belong to machine journey | `crm6_order` is per batch; `shift_log_id` set at `ensureOrder()` | Order stays on one `shift_log_id` forever — **no per-shift attribution** (runtime/production by shift) |
| Shift = operator responsibility | `shift_log` is per **process line** (one header for all 6HI/4HI/2HI) | **No machine-scoped session**; no “who is responsible for this machine now” |
| Handover transfers responsibility, not production | Line handover moves `stoppage_entry` + open prod rows to new `shift_log_id` | CRM uses `order_stoppage` — **ignored**; handover would incorrectly try `time_to IS NULL` on `crm6_order` |
| Incoming operator must accept before production changes | No acceptance gate | Operator can start/modify orders immediately after login |

---

## 2. Current architecture (as-built)

### 2.1 Database

| Table | Role today |
|-------|------------|
| `master.shift` | Shift windows (`shift_code`, `start_time`, `end_time`) — **exists, seeded A/B/C** |
| `txn.shift_log` | Line/process header: `(prod_date, shift_code, process_id, mill_type)` unique |
| `txn.stoppage_entry` | Line-level stoppages (carry-forward on handover) |
| `txn.crew_entry` | Crew per `shift_log_id` |
| `txn.crm6_order` | Machine orders; `shift_log_id`, `status` IN_PROGRESS/STOPPAGE/… |
| `txn.order_stoppage` | Order-level stoppages (CRM) |
| `txn.crm6_shift_summary` | End-of-shift totals (scrap, coolant) — **reporting only** |
| `security.tenant_config` | Platform config JSONB — **no shift settings column yet** |
| Handover attestation cols on `shift_log` | `handover_notes`, `handover_*_user_id`, `handover_at` |

**Missing entities (spec requires):**

- Dedicated **machine handover** record (machine, order, outgoing/incoming shift & operator, status, queue snapshot, acceptance)
- **Machine shift session** (operator responsibility per machine per shift)
- **Shift override audit** (reason, selected shift, who, when)
- **Order shift attribution** (runtime/production/stoppages per shift per order)
- **Shift boundary job** (14:00 / 22:00 / 06:00 pending handover creation)
- **Machine status at handover** (Running / Idle / Breakdown / Maintenance / Stoppage)

### 2.2 Backend services & APIs

| Service / route | Behavior |
|-----------------|----------|
| `ShiftLogService` | Create/submit/approve; `getHandoverSummary`; `handover()` — line-centric |
| `GET /shift-logs/active/:processCode` | Latest DRAFT shift log |
| `POST /shift-logs/:id/handover` | Outgoing closes + incoming DRAFT; carry-forward |
| `SixHiService.ensureActiveShiftLog()` | One DRAFT for process `6HI` — **not per machine** |
| `GET/POST /6hi/shift-summary/:shiftLogId` | Aggregated totals — **not handover** |
| `shiftLogValidationService` | **No `6HI` branch** — empty validation |
| `LiveService` | `formatShiftWindow()` from `master.shift` |

**Missing APIs:**

- `GET /shifts/current` — clock-based shift (+ optional override from session)
- `POST /shifts/override` — manual shift with reason (audited)
- `GET /machines/:code/session` — active operator session + pending handover
- `POST /machines/:code/handover` — outgoing handover submit
- `POST /machines/handover/:id/accept` — incoming acceptance
- `POST /machines/handover/:id/clarification` — request clarification
- `GET /plant/live/handovers` — pending/recent for plant head
- Boundary scheduler / cron hook

### 2.3 Frontend

| Surface | Shift behavior today |
|---------|---------------------|
| `Login.tsx` | No shift detection; resets `shiftStore` |
| `SixHiLayout` | `GET /shift-logs/active/{mill}` — CRM only |
| `ShiftLogPage` | Synthetic `shiftLogId`, no active-shift API |
| `HandoverPage` | Line handover: summary + incoming badge/PIN + logout |
| `SixHiShiftSummaryPage` | CRM “end shift” = summary POST — **no handover acceptance** |
| `StatusRail` | Shows `shiftDate · shiftCode` from store |
| `PlantHeadDashboard` | No handover visibility |
| `MachineHeadDashboard` | Shows shift code per machine — read-only |
| `CrewSubForm` | POST only; no load; synthetic IDs on line path |

---

## 3. Gap matrix (spec requirement → status)

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Configurable shift windows (A/B/C) in DB | **Partial** — `master.shift` exists; admin UI later |
| 2 | Auto shift detection on login | **Missing** |
| 3 | Global shift display in header | **Partial** — CRM only, not clock-derived |
| 4 | Shift override with reason + audit | **Missing** |
| 5 | Boundary detection 06/14/22 | **Missing** |
| 6 | Case 1: no active order → auto close shift | **Missing** |
| 7 | Case 2: active order → pending handover, order continues | **Missing** |
| 8 | Outgoing handover form (machine status, order, runtime, queue, remarks) | **Partial** — line summary only |
| 9 | Incoming acceptance gate (block production until accept) | **Missing** |
| 10 | Order continuity (no restart/duplicate/runtime reset) | **Partial** — orders don't restart today, but handover logic would break CRM if applied naively |
| 11 | Per-shift production tracking on order | **Missing** |
| 12 | Dedicated handover entity | **Missing** |
| 13 | Breakdown handover fields | **Missing** |
| 14 | Plant head: pending/recent handovers | **Missing** |
| 15 | Machine head: pending handovers, operator, queue | **Partial** |
| 16 | Shift summary screen (auto calc + manual scrap/coolant/crew) | **Partial** — CRM summary only |
| 17 | Crew capture (multi role, add multiple) | **Partial** — form exists, weak persistence |
| 18 | Audit: detection, override, handover, acceptance, closure | **Partial** — `shift_log` triggers only |

---

## 4. Affected workflows

### 4.1 Operator (CRM)

**Today:** Login → `/username.role` → active shift log loaded → operate orders → End Shift → summary submit → home.

**Target:**

1. Login → resolve shift from server clock (+ show override if any)
2. If **pending handover** for assigned machine → acceptance screen **before** hub
3. Operate orders (order unchanged across shifts)
4. At boundary or logout → outgoing handover (remarks mandatory)
5. If no active order at boundary → auto shift summary + close (no handover)

### 4.2 Operator (line capture)

**Today:** `/shift-log/HRS` with synthetic IDs; `/handover` with badge/PIN.

**Target:** Same machine-centric model where applicable; unify on real `shift_log_id` + machine/line session.

### 4.3 Supervisor

**Today:** Review queue, command center — no handover oversight.

**Target:** View overrides, clarification requests, approve shift corrections.

### 4.4 Plant head

**Today:** Analytics only.

**Target:** Live dashboard widgets: pending handovers, recent handovers, machines awaiting acceptance, shift status.

### 4.5 Machine head

**Today:** Machine board + shift code display.

**Target:** Pending handovers, current operator, acceptance status, queue.

---

## 5. Proposed data model (new)

```
master.shift                    -- keep; admin-editable windows (already has start/end TIME)

txn.machine_shift_session       -- operator responsibility per machine
  session_id, machine_code, shift_code, prod_date, operator_user_id,
  shift_log_id (attribution), status (ACTIVE|CLOSED|PENDING_ACCEPTANCE),
  started_at, closed_at, override_id?

txn.machine_handover            -- dedicated handover entity (spec)
  handover_id, machine_code, order_id?, batch_number?,
  outgoing_shift_code/date, incoming_shift_code/date,
  outgoing_operator_id, incoming_operator_id?,
  machine_status, breakdown_*, remarks (required),
  queue_snapshot JSONB, production_snapshot JSONB, open_stoppages JSONB,
  status (PENDING|ACCEPTED|CLARIFICATION|CANCELLED),
  created_at, accepted_at

txn.shift_override_audit
  override_id, user_id, machine_code?, selected_shift_code, prod_date,
  reason_code, reason_detail, created_at

txn.order_shift_attribution     -- per-shift slice of order journey
  order_id, shift_log_id, machine_code,
  runtime_minutes, production_mt, stoppage_minutes, breakdown_minutes

txn.shift_event_audit           -- explicit app events (or extend audit triggers)
  event_type, entity_type, entity_id, payload JSONB, user_id, created_at
```

**`txn.shift_log` changes (minimal):**

- Add optional `machine_code` for machine-scoped shift logs (nullable for legacy lines)
- Or keep process-level log for accounting and use `machine_shift_session` for responsibility (recommended: **dual layer** — session for ops, shift_log for totals)

**`crm6_order` — no schema change for continuity:**

- Do **not** change `shift_log_id` on handover
- Add `order_shift_attribution` rows at boundary / handover accept

---

## 6. Migration strategy

### Phase 1 — Foundation (no workflow break)

1. Migration: new tables + seed `master.shift` times if missing + `shift_override_audit`
2. `ShiftDetectionService` — read windows from `master.shift`, IST clock
3. `GET /shifts/current` + include in login/JWT bootstrap
4. Client: header shows detected shift; store `detectedShift` vs `activeShift` (override)

### Phase 2 — Machine handover entity

1. `MachineHandoverService` — create pending handover (outgoing)
2. Accept / clarification endpoints
3. Production gate middleware: block order mutations if pending handover not accepted
4. Outgoing handover UI (tablet, sticky machine/order info)

### Phase 3 — Boundary automation

1. Scheduler at 06:00 / 14:00 / 22:00 (IST)
2. Per machine: if active order → create PENDING handover; else → close session + shift summary pipeline
3. Snap queue + production snapshot into handover record

### Phase 4 — Shift attribution & summary

1. `order_shift_attribution` writer on boundary and periodic tick
2. Unified shift summary screen (auto metrics + manual scrap/coolant/crew)
3. Extend `crm6_shift_summary` or link to machine session close

### Phase 5 — Dashboards & admin

1. Plant head / machine head handover panels
2. Admin settings UI for `master.shift` windows
3. Audit report for overrides and handovers
4. Deprecate line-only `HandoverPage` badge flow for CRM (keep for classic lines until unified)

### Backward compatibility

- Existing `shift_log` rows unchanged
- Legacy `/shift-logs/:id/handover` remains for HRS/PKL lines
- CRM routes add parallel `/machines/:code/handover/*`
- Feature flag: `tenant_config.enabled_modules` includes `machine_handover_v2`

---

## 7. Implementation phases (task breakdown)

See `.kiro/specs/machine-centric-shift/tasks.md` for executable checklist.

**Priority order:**

1. Shift detection + config from DB  
2. Machine handover table + outgoing/incoming API  
3. Login acceptance gate  
4. Boundary scheduler  
5. Shift attribution + summary  
6. Dashboards + audit UI  

---

## 8. Risk register

| Risk | Mitigation |
|------|------------|
| Applying line handover carry-forward to `crm6_order` | Never move orders between shift logs; only attribution rows |
| Two handover UIs (line vs CRM) | Converge on `MachineHandover` component; route by machine type |
| Synthetic `shiftLogId` on line capture | Bootstrap `/shift-logs/active` in `OperatorShell` for all processes |
| Timezone | Use `Asia/Kolkata` consistently server-side |
| Multi-machine operators | One pending handover per machine; acceptance list on login |

---

## 9. Files to touch (estimated)

**Server:** new migration, `ShiftDetectionService`, `MachineHandoverService`, `MachineShiftSessionService`, routes, `SixHiService` (production gate), `LiveService`, scheduler, audit  
**Client:** `shiftStore` (detected/overridden shift), `Login`, `OperatorShell`, new `HandoverAcceptPage`, `OutgoingHandoverPage`, `StatusRail`, `SixHiShiftSummaryPage` merge, plant/machine dashboards, `CrewSubForm` load  
**Shared:** Zod schemas for handover, override reasons, machine status enum  

---

*This document is the authoritative gap analysis for the machine-centric shift spec. Implementation proceeds phase-by-phase without breaking existing line capture.*
