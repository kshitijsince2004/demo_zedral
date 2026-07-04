# 03 · Preventive Maintenance Engine — Developer Specification

**Component owner:** M2 Backend · **Phase:** M2-1 · **Depends on:** 01 Data Model, 02 Registry, 04 Work Orders · **Consumed by:** 04, 06, Monitoring

---

## 1. Purpose & scope

The engine that makes M2 *preventive*: it evaluates **triggers** and auto-generates **work orders** with their checklists before failure. **In scope:** trigger types, the due-scan algorithm, WO generation, compliance windows, floating re-anchoring, meter projection, basic condition rules. **Out of scope:** WO execution lifecycle (04); predictive forecasting (08).

## 2. Trigger model (MUST)

A `maintenance_plan` binds an asset (or `asset_class` for template plans) to one or more `plan_trigger` rows and a `maintenance_task` checklist. Trigger types (`maint.trigger_type`):

| Type | Fires when | Driving data | Re-anchor on completion? |
|---|---|---|---|
| `TIME_FIXED` | fixed calendar interval since plan epoch | clock | no (fixed cadence) |
| `TIME_FLOATING` | interval elapsed since **last completion** | clock + WO history | **yes** |
| `METER` | meter crosses next threshold | `meter_reading` | yes (next = last + interval) |
| `CONDITION` | measured tag/meter breaches limit | sensor/meter | n/a (event-driven) |
| `EVENT` | a defined canonical event occurs (e.g. N breakdowns) | Event Spine | n/a |
| `INSPECTION_ROUTE` | scheduled rounds / lubrication routes | clock | yes |

## 3. Due-scan algorithm (the core job)

Runs on **Airflow** at the per-tenant cadence (D2, default minutes; edge-deployable per D1). Idempotent — generating the same due WO twice is prevented by `(plan_id, trigger_id, due_ts)` uniqueness on open WOs.

```text
for each active plan_trigger (tenant-scoped):
  case TIME_FIXED:
      due = epoch + ceil((now - epoch)/interval)*interval
      if now >= due and not already_generated(trigger, due): generate_wo(due)
  case TIME_FLOATING / INSPECTION_ROUTE:
      due = last_completed_ts(plan) + interval     (or plan.created if none)
      if now >= due and no open WO for trigger: generate_wo(due)
  case METER:
      latest = meter.current_value
      if latest >= trigger.next_due_meter and no open WO: 
          generate_wo(due_ts=now); trigger.next_due_meter += meter_interval
      else: project_due_date(meter trend)   # for "due in ~X days" forecast
  case CONDITION:
      evaluate(condition_tag, condition_op, condition_value) against latest reading
      if breached: raise condition_alert; if alert.action=WO: generate_wo()
  case EVENT:
      on subscribed canonical event matching rule: generate_wo()
update trigger.next_due_ts / next_due_meter (scheduler cache)
```

`generate_wo(...)` creates a `work_order` (`wo_type='PREVENTIVE'` or `'CONDITION'/'INSPECTION'`, `wo_source='PLAN'`), copies `maintenance_task` → `wo_task`, reserves `task_part` spares (spec 05), sets `due_ts = due + compliance_window_days`, assigns per routing, and emits `maintenance.pm.generated`.

## 4. Meter handling

Meter readings (`maint.meter_reading`, TimescaleDB) arrive from PLC tags (automatic) or manual operator entry (open decision — support both). The engine maintains `meter.current_value` (cached cumulative) and computes `delta_value` for usage-rate, enabling **meter projection**: estimate the date a `METER` trigger will fire from recent average usage → surfaces "due in ~X days/hours" in Monitoring even though the trigger is usage-based.

## 5. Compliance window

Each generated PM has `due_ts` = ideal date + `compliance_window_days`. Completion within the window counts toward **PM compliance** (spec 06). Missed PMs are flagged (state `Skipped`/overdue) and visible on the Monitoring board. Floating and route plans re-anchor `next_due_ts` from `completed_ts`, so cadence never drifts.

## 6. Scheduling vs idle time

Where `shift/calendar` data exists, the engine prefers slotting PM into planned/idle windows (`maintenance_plan.requires_shutdown` influences this) so preventive work does **not** create OEE Availability loss (the M2↔M4 distinction, spec 06).

## 7. Interfaces (spec 07 detail)

`POST /v1/maint/plans`, `POST /v1/maint/plans/{id}/triggers`, `POST /v1/maint/meters/{id}/readings`, `GET /v1/maint/plans/due?as_of=…`. Emits `maintenance.pm.generated`, `maintenance.pm.due`, `maintenance.condition.alert`.

## 8. NFRs

- Due-scan **MUST** complete within one cadence interval for ≥100k active triggers/tenant (batch + index on `plan_trigger.next_due_ts`).
- **Idempotent**: re-runs never double-generate (uniqueness guard).
- **Edge-deployable** (D1): scan runs on-prem when the plant is disconnected; syncs generated WOs on reconnect.

## 9. Acceptance criteria

- **MUST** generate a WO with the correct checklist when any trigger type fires, exactly once.
- **MUST** re-anchor floating/route plans from `completed_ts`.
- **MUST** advance `next_due_meter` and project a due date from meter trend.
- **MUST** raise a `condition_alert` (and optionally a WO) on threshold breach.
- **SHOULD** prefer idle-time slotting when shift/calendar is available.

## 10. Build phasing

**M2-1:** time (fixed/floating) + meter triggers + due-scan + WO generation + compliance window; basic condition alerts. EVENT triggers and idle-time optimization are fast-follow.

## 11. Risks

PM "over-generation" / alarm fatigue (tunable thresholds, dedupe open WOs); clock vs meter drift (projection + reconciliation); manual meter entry gaps (fallback to time-based; flag stale meters).
