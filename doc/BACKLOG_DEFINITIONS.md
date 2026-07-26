# Backlog Definitions

Plant and operator surfaces compute “backlog” from `planning.ppc_batch` (joined to
`txn.crm_order` and optionally `master.machine`), but **filters differ by audience**.

| Surface | Source | Date rule | Status rule | Machine rule | Coverage |
| --- | --- | --- | --- | --- | --- |
| **Plant Head KPI** (`backlogCount`) | `ReportingService` → `countPlantHeadBacklog()` | `plan_date < today` (plant calendar) | missing `crm_order` **or** status ∉ `{COMPLETED, REJECTED}` | exclude `machine_status = OFFLINE` | **All** lines with `ppc_batch` rows (not 6HI-only) |
| **Plant Head drawer** (`GET /reports/plant-head/backlog`) | same module → `listPlantHeadBacklog()` | **identical** to KPI | **identical** | **identical** | **identical**; optional `machineCode` / `search`; returns `availableMachines` |
| **Operator queue (CRM mills)** | `SixHiService.getQueue` via `SixHiOrderSource` | prior days **plus** same-day earlier shifts | incomplete statuses (null or INCOMPLETE set) | scoped to machine + sub_process; unallocated pool | 6HI / 4HI / 2HI (`CRM_MILL_CODES`) |
| **Handover queue (legacy lines)** | `LegacyOrderSource.getQueueSnapshot` | `plan_date < view date` (calendar; no same-day earlier-shift) | missing order **or** ∉ COMPLETED/REJECTED | machine + not OFFLINE | HRS/PKL/CRS/CTL/RWD **when** they have `ppc_batch` rows |

## Why operator ≠ plant

- **Operator / SixHi hub:** floor view — “what is overdue relative to the shift I am working.” Same-day earlier shifts still count as backlog so Shift B sees unfinished Shift A plans.
- **Plant Head:** strategic view — “how many planned batches are older than today’s plant date,” plant-wide, hiding OFFLINE machines. KPI count and drawer list share one query module so they cannot drift.

## Schema note (legacy vs CRM)

- CRM mills plan and execute via `planning.ppc_batch` + `txn.crm_order`.
- Classic lines (HRS, PKL, …) often capture production in `txn.prod_*` without a PPC batch. Legacy handover backlog uses the **same PPC/crm_order rules** as Plant Head; entries that exist only in `prod_*` are not inventing a second backlog model.

## Implementation anchors

- Shared plant filters: `packages/server/src/reporting/plantHeadBacklog.ts`
- Operator filter: `SixHiService` `backlogPlanFilter`
- Legacy handover: `packages/server/src/services/handover/LegacyOrderSource.ts`
