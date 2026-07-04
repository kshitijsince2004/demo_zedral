# M3 · 05 — Production-Order Lifecycle & Events Spec
**Deep-plan ref:** §4, §11. **Standards:** ISA-95 Part 3 (dispatching, execution, tracking); SAP PP order→confirmation flow.

## 1. Lifecycle state machine (`ops.order_status`)
```
PLANNED → FIRMED → RELEASED → SCHEDULED → DISPATCHED → IN_PROGRESS → COMPLETED → CLOSED
                                                              ↘ (open at shift end) carried → resumes
PLANNED → CANCELLED   (re-plan / demand drop)
```
- **PLANNED** — from MRP (Posture C) or ingest (A/B).
- **FIRMED** — planner fixes qty/dates (eligible for release).
- **RELEASED** — materials + capacity confirmed; `release_ts` set; order is now real work.
- **SCHEDULED** — placed in a committed `schedule_entry` (spec 03).
- **DISPATCHED** — on `v_dispatch_list` for a work centre/shift.
- **IN_PROGRESS** — first confirmation booked; run clock active.
- **COMPLETED** — all operations confirmed, `good_qty` booked, `completed_ts` set.
- **CLOSED** — variances settled & costed (Financial Impact); immutable.
- **CARRIED** is not a status but a handover relationship (spec 04) — an `IN_PROGRESS` order referenced by `handover_carryover`.

Transitions are validated server-side; illegal jumps rejected. Each transition emits a domain event (§3).

## 2. Operation-level tracking (`production_operation`)
Each order instantiates its routing into `production_operation` rows (`PENDING→DISPATCHED→IN_PROGRESS→CONFIRMED`). Tracking gives WIP location, genealogy (which op a unit is at), and — at Hero Steels — ties to the **M1 COIL_NO** spine via `production_order.m1_coil_ref` for end-to-end traceability.

## 3. Domain events (Kafka topics — see spec 07)
`order.planned`, `order.firmed`, `order.released`, `order.scheduled`, `order.dispatched`, `order.started`, `production.confirmed`, `order.completed`, `order.closed`, `order.cancelled`, `handover.signed_off`. Each carries `tenant_id`, ids, ts, lineage. Consumers: Monitoring (board), KPI svc, M4 (ProductionCount), Financial Impact, Reporting.

## 4. M1 bootstrap (fastest first value)
- `planning.plan_order` / `coil_plan` (M1's SAP-PP CSV) → `production_order` (`source='M1_PLAN_CSV'`).
- `prod_*` capture (per-process output) → `production_confirmation` (`m1_source_ref` set) → ProductionCount.
- M1 `shift_log` handover → seed `shift_handover` (spec 04).
This lights up the order lifecycle + adherence **before** any ERP connector exists.

## 5. Acceptance criteria
- **MUST** enforce the state machine; reject illegal transitions; audit every transition.
- **MUST** emit the domain event for each transition exactly once (idempotent producer).
- **MUST** support ingest (A/B) and MRP-generated (C) orders identically downstream.
- **MUST** preserve `source_ref`/lineage from M1/ERP on every order & confirmation.
- **SHOULD** expose order genealogy (operation-level WIP) for tracking & the M1 coil link.
