# Refined Prompt / Spec — Standardize Order Identifier Display (Mother Coil ID + Slit ID)

**Target tree:** mounted **`hsl_zedral-main`**. **Spec only** — no edits made. Confirm line numbers
before editing (not git-tracked).

**Goal:** every dashboard shows an order as **Mother Coil ID (primary) + Slit ID (secondary, e.g. A/B/C)**
— consistent across Operator, Machine Head, and Plant Head — with complete, synchronized operator inputs
visible on all three.

**Key context (verified):** the Operator profile is already correct. It renders order identity through a
single shared source of truth:
- Formatter: `packages/client/src/lib/sixHiOrderIdentity.ts` → `displayMotherCoilId(order)` returns
  `"{motherCoil} {slitId}"` (e.g. `"1100038319 A"`), falling back to `coilNo`/`batchNumber` when
  `motherCoil`/`slitId` are absent.
- Component: `packages/client/src/components/orders/OrderIdentityDisplay.tsx` (bold Mother Coil + Slit as
  primary, subtitle below).
- Data: `SixHiOrderDetail` / `SixHiQueueCard` carry `batchNumber`, `motherCoil`, `slitId`
  (`packages/shared-validation/src/types/sixHi.ts:64-68`). Underlying columns exist:
  `txn.crm_order.coil_no` + `txn.crm_order.slit_id`, `planning.ppc_batch.coil_no` + `slit_id`.

**Root cause of the inconsistency (two layers):**
1. **Display layer:** Machine Head and Plant Head render **raw `batchNumber`** (or `coilNo` without slit),
   or call `OrderIdentityDisplay` but pass `{ batchNumber, coilNo: batchNumber }` — i.e. **no `slitId`**.
2. **Data layer:** the **dashboard/reporting DTOs don't carry `motherCoil`/`slitId`** — so even where
   `OrderIdentityDisplay` is used it falls back to `batchNumber`. (`DashboardReportingService` /
   MH-dashboard + PH reporting order rows return only `batchNumber`, sometimes `coilNo`.)

Fix **both** layers. Rule: **never render a raw `batchNumber` as the visible order ID** — always go
through `OrderIdentityDisplay` (or `displayMotherCoilId`) with real `motherCoil` + `slitId`.

---

## PART 1 — Standardize the display (Mother Coil + Slit) everywhere

### 1A. Backend — add `motherCoil` + `slitId` to every order-bearing DTO
Wherever an order row is returned to MH or PH, include `motherCoil` (from `crm_order.coil_no`/mother coil)
and `slitId` (from `crm_order.slit_id`). Join `txn.crm_order` by `batch_number`/`order_id` (fallback to
`planning.ppc_batch`).

| Where | File | Add fields to |
| --- | --- | --- |
| MH dashboard: order queue, production/completed, operator activity, stoppage rows | `packages/server/src/services/reporting/DashboardReportingService.ts` (+ the MH-dashboard route in `routes/liveRoutes.ts`/`reportRoutes.ts`) | each order row DTO → `motherCoil`, `slitId` |
| PH: rejected orders, backlog, order tracking/traceability, production rows | `packages/server/src/services/ReportingService.ts`; `services/TraceabilityService.ts` (`machineJourney`/`orderInfo`) | each order row → `motherCoil`, `slitId` |
| Shared DTO types | `packages/shared-validation/src/types/*` (the reporting/dashboard DTOs) | add optional `motherCoil?: string; slitId?: string` |

### 1B. Frontend — Machine Head: use `OrderIdentityDisplay` with slit, kill raw `batchNumber`
| File | Line(s) | Change |
| --- | --- | --- |
| `components/machinehead/MachineHeadOrderDetailModal.tsx` | ~73 (`<h2>{batchNumber}</h2>`) and ~78 subtitle | replace the raw `{batchNumber}` heading with `<OrderIdentityDisplay order={order} size="lg" />` (the fetched `order` already has `motherCoil`+`slitId`) |
| `pages/live/MachineHeadDashboard.tsx` | ~475 handover row (`coilNo: h.batchNumber`), ~507/562 (`coilNo: a.batchNumber`/`s.batchNumber`) | pass real `{ motherCoil: r.motherCoil, coilNo: r.coilNo, batchNumber, slitId: r.slitId }` (available after 1A) instead of `coilNo: batchNumber` |
| `pages/live/MachineHeadDashboard.tsx` | ~514 (`{a.batchNumber}`), ~567 (`{s.batchNumber}`), order-queue rows ~431-439 | replace raw `batchNumber` cells with `<OrderIdentityDisplay order={{motherCoil, coilNo, batchNumber, slitId}} size="sm" />` |
| `components/machinehead/MachineHeadOrderSidePanel.tsx` | order header | render `OrderIdentityDisplay` (the panel fetches `SixHiOrderDetail`, so it has the fields) |

### 1C. Frontend — Plant Head: same treatment
| File | Change |
| --- | --- |
| `pages/reports/PlantOrderTracking.tsx` (~156-157 `['Batch', batchNumber]`, `['Coil', coilNo]`; journey rows ~241) | show **Mother Coil + Slit** as the primary identifier (`OrderIdentityDisplay` with `motherCoil`+`slitId`); keep Batch/SAP as secondary metadata rows |
| `components/plant-head/RejectedOrdersDrawer.tsx` (~82 `order={{ batchNumber, coilNo }}`) | add `slitId` (and `motherCoil`) to the `order` prop |
| `components/plant-head/BacklogDetailDrawer.tsx`, `PlantOperationsArea.tsx` | route every order-ID render through `OrderIdentityDisplay` with `motherCoil`+`slitId` |

**Verify (Part 1):** the same order shows identically (e.g. `1100038319 A`) on Operator, MH, and PH.
Grep gate: no visible order-ID render uses a bare `{batchNumber}` — all go through `OrderIdentityDisplay`
/`displayMotherCoilId`.

---

## PART 2 — Machine Head: Order Details completeness

**Current (verified):** `MachineHeadOrderDetailModal.tsx` fetches `GET /6hi/orders/:batchNo` →
`SixHiOrderDetail` (the **same endpoint the operator uses**) and renders
`<OrderProductionHistory order={order} />` (line 107) — so operator inputs *do* flow to MH.

**Do:**
1. Fix the heading (Part 1B) so the modal is identified by Mother Coil + Slit, not `batchNumber`.
2. Audit `components/sixHi/OrderProductionHistory.tsx` renders **all** operator-entered sections:
   rolling passes (input/output thickness, pass count), skin-pass (elongation, thickness), defects
   (codes + qty), stoppages (category, duration), remarks, actual weight, roll change. List any field
   present in `SixHiOrderDetail` but not shown, and add it.
3. Confirm the modal handles both process types: 4HI/6HI rolling **and** skin-pass; 2HI skin-pass only
   (no empty rolling section).

**Verify (Part 2):** every field an operator submits on an order is visible, correctly labelled, in the
MH Order Details modal — no missing/blank fields for a fully-completed order.

---

## PART 3 — Cross-profile data validation (Operator ↔ MH ↔ PH)

**Current (verified):** Operator and MH read the **same** `/6hi/orders/:batchNo` + shared components, and
all three profiles ultimately read the same tables (`txn.crm_order`, `crm_rolling`, `crm_skinpass`,
`crm_shift_summary`, `txn.stoppage`, `txn.defect_entry`, `order_shift_attribution`). So the data source is
consistent; the risks are (a) reporting DTOs dropping fields (Part 1A) and (b) any profile computing its
own numbers.

**Do:**
1. For a completed order, assert the **same values** appear on Operator, MH detail, and PH:
   Mother Coil + Slit, weight, thickness, defects, stoppages, shift/attribution.
2. Confirm PH aggregates read the same production the operator wrote (watch for the `ReportingService`
   `lineId === '6HI'` hardcode which drops 4HI/2HI — cross-ref `ZEDRAL_TASKS_1-3_FIX_SPEC_hsl.md` §3.1a).
3. Add a test: create an order as operator (rolling passes + skin-pass + a defect + a stoppage) → assert
   identical identity + values via the MH order endpoint and the PH reporting endpoints.

**Verify (Part 3):** operator-entered data is identical and complete across all three roles; no field is
visible in one profile but missing/different in another.

---

## Deliverable / Expected outcome
- One identifier everywhere: **Mother Coil ID + Slit ID**, via `OrderIdentityDisplay` /
  `displayMotherCoilId`, backed by DTOs that always carry `motherCoil` + `slitId`.
- MH Order Details complete (all operator inputs shown), identified by Mother Coil + Slit.
- Verified data consistency Operator ↔ Machine Head ↔ Plant Head.

## Suggested order
1. Part 1A (backend DTO fields) — unblocks correct display everywhere.
2. Part 1B + 1C (MH + PH `OrderIdentityDisplay` swaps).
3. Part 2 (MH details audit) → Part 3 (cross-profile test).

## Intersections with existing specs
- Part 3 §2 touches the **same `ReportingService` `6HI` hardcode** as `ZEDRAL_TASKS_1-3_FIX_SPEC_hsl.md`
  §3.1a — coordinate so 4HI/2HI orders appear before validating cross-profile consistency.
- No overlap with `ZEDRAL_HOLD_4HI_2HI_SPEC.md` (different files/concerns).
