# 06 · KPIs, Analytics & Financial Impact — Developer Specification

**Component owner:** M2 Backend + Analytics · **Phase:** M2-2 · **Depends on:** 04 Work Orders, 05 Cost, platform 04 UIL, 07 Financial Impact · **Consumed by:** UIL, Monitoring, Reporting

---

## 1. Purpose & scope

M2's contribution to the **shared KPI registry** (platform 04 UIL): the maintenance KPI family, their exact definitions and SQL, the rollup grain, and the **M2↔M4 reconciliation** rule. Every formula is the industry-standard definition; OEE-linked terms reuse the platform's ISO 22400 definitions — **no parallel truth**.

## 2. KPI definitions (MUST match these)

| KPI | Definition | Notes |
|---|---|---|
| **MTBF** | operating_time ÷ failures | repairable assets |
| **MTTR** | Σ repair_time ÷ repairs | maintainability |
| **MTTF** | operating_time ÷ failures | non-repairable items |
| **MTBM** | operating_time ÷ all maintenance actions (PM+CM) | total demand |
| **Inherent Availability** | MTBF ÷ (MTBF + MTTR) | reliability-based (distinct from OEE availability) |
| **PM Compliance** | completed_PM ÷ scheduled_PM × 100 | within compliance window; target ≥90% |
| **Schedule Compliance** | on_time_WOs ÷ scheduled_WOs × 100 | planning discipline |
| **PMP (Planned Maint %)** | planned_maint_hours ÷ total_maint_hours × 100 | proactive ratio |
| **Planned:Unplanned** | planned_WOs ÷ unplanned_WOs | maturity |
| **Backlog** | open ready-to-schedule WO hours ÷ weekly capacity | weeks of work |
| **Failure Pareto / bad actors** | failures (or downtime/cost) grouped by asset & failure_mode | RCM focus |

## 3. Reference SQL (illustrative; computed into `kpi_asset_daily` / mart)

```sql
-- MTBF, MTTR, inherent availability per asset over a window
WITH f AS (
  SELECT asset_id,
         COUNT(*)                         AS failures,
         SUM(downtime_h)                  AS downtime_h,
         SUM(EXTRACT(EPOCH FROM (actual_end-actual_start))/3600.0) AS repair_h
  FROM maint.failure_event fe
  LEFT JOIN maint.work_order wo ON wo.failure_event_id = fe.failure_event_id
  WHERE fe.tenant_id = :t AND fe.down_ts >= :from AND fe.down_ts < :to
  GROUP BY asset_id
)
SELECT asset_id,
       (:operating_h / NULLIF(failures,0))            AS mtbf_h,
       (repair_h     / NULLIF(failures,0))            AS mttr_h,
       (:operating_h / NULLIF(failures,0)) /
         NULLIF((:operating_h/NULLIF(failures,0)) +
                (repair_h/NULLIF(failures,0)),0)      AS availability   -- MTBF/(MTBF+MTTR)
FROM f;

-- PM compliance per asset
SELECT asset_id,
       100.0 * COUNT(*) FILTER (WHERE status='CLOSED' AND completed_ts <= due_ts)
              / NULLIF(COUNT(*) FILTER (WHERE wo_type='PREVENTIVE'),0) AS pm_compliance
FROM maint.work_order
WHERE tenant_id=:t AND created_ts >= :from AND created_ts < :to
GROUP BY asset_id;
```

`operating_time` comes from `shift/calendar` planned production time minus downtime (consistent with ISO 22400) — sourced from the canonical serving layer, not recomputed differently here.

## 4. Rollup grain & publication

- Materialize daily to `maint.kpi_asset_daily`; aggregate up the ISA-95 hierarchy (asset→work_center→site) and by failure_mode for Pareto.
- **Publish** each KPI to the shared **KPI registry** (UIL) with: `kpi_code`, `scope` (asset/site/tenant), `period`, `value`, `unit`, `definition_ref`. UIL handles cross-module synthesis (e.g. maintenance↔quality↔yield); M2 just contributes its metrics.

## 5. M2↔M4 reconciliation (MUST)

A breakdown is one `canon.event` downtime row (`downtime_event_ref`). **M2** derives failure-centric metrics (MTBF, MTTR, inherent availability); **M4** derives time-based **OEE availability** (`Operating ÷ Planned Production Time`). The two availability figures are *different metrics by design*, but both consume the **same downtime hours**, so they reconcile and never contradict. Acceptance test: Σ M2 breakdown-downtime_h for an asset/period == Σ M4 Availability-loss hours attributed to breakdowns for the same asset/period.

## 6. Financial Impact tagging

Each KPI is priced where a `cost_rate` exists (spec 05, D7): downtime cost = downtime_h × downtime rate; repair cost = labour+parts; **avoided-failure value** (future, when a condition catch prevents a breakdown). Priced KPIs flow to the executive financial report and to alerts ("£X/yr avoided"). Pricing uses the rate effective at the event date so historical reports stay correct.

## 7. Interfaces (spec 07)

`GET /v1/maint/kpis?scope=&asset=&from=&to=`, `GET /v1/maint/analytics/pareto?dim=failure_mode`. Emits `maintenance.kpi.published`. Live tiles (due/overdue PM, open breakdowns, asset health) pushed to Redis for Monitoring.

## 8. NFRs

KPI rollups run on Airflow at tenant cadence; mart queries sub-second for dashboards (ClickHouse/columnar); definitions versioned (`definition_ref`) so a number is always traceable to its formula.

## 9. Acceptance criteria

- **MUST** compute MTBF/MTTR/inherent-availability/PM-compliance per the §2 definitions.
- **MUST** reconcile breakdown downtime hours with M4 (§5 test).
- **MUST** publish KPIs to the shared registry with definition provenance.
- **MUST** price downtime/repair via the effective-dated rate (D7).
- **SHOULD** expose failure-mode Pareto and bad-actor ranking.

## 10. Build phasing

**M2-2:** core KPIs + daily rollup + registry publish + financial tagging + M4 reconciliation test. Backlog/wrench-time and avoided-failure value fast-follow.

## 11. Risks

Definition drift across modules (single registry + versioned definitions); operating-time source ambiguity (take from canonical serving, document it); small-sample MTBF noise (show confidence/minimum-failures guard).
