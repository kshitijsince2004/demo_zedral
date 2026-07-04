# M3 · 06 — KPIs, Analytics & Financial Impact Spec
**Deep-plan ref:** §9, §12. **Standards:** ISO 22400 (shared with M4); APICS adherence metrics.

## 1. KPI family (published to the shared registry, doc 03)
| KPI | Formula | Notes |
|---|---|---|
| Schedule attainment | completed-on-schedule ÷ scheduled × 100 | planning discipline |
| Qty attainment | actual good ÷ planned × 100 | per order/WC/day |
| OTIF | on-time AND complete ÷ total orders × 100 | customer reliability |
| On-time delivery | on/before due ÷ total | |
| Throughput | good output ÷ time | |
| Capacity utilisation | load ÷ available × 100 | watch overload |
| Setup ratio | setup time ÷ available × 100 | + `changeover_count` |
| Sequence compliance | jobs run in planned sequence ÷ total | steel campaign discipline |
| WIP / cycle time | release→completion elapsed | lean flow |
| Schedule stability | plan changes ÷ horizon | nervousness |
| Forecast accuracy | 1 − |fcst−act| ÷ act | Posture C |

## 2. Rollup
Airflow job aggregates `production_confirmation` + `schedule_entry` + `work_center_capacity` into `kpi_plan_daily` (WC × day). Served to UIL/Reporting; cached in Redis for the live board.

Example (attainment):
```sql
-- qty attainment per work centre per day
SELECT c.work_center_ref, date_trunc('day', c.confirmed_ts) AS d,
       SUM(c.good_qty)                                   AS actual_good,
       SUM(po.planned_qty)                               AS planned,
       100.0 * SUM(c.good_qty) / NULLIF(SUM(po.planned_qty),0) AS qty_attainment_pct
FROM ops.production_confirmation c
JOIN ops.production_order po ON po.order_id = c.order_ref
WHERE c.tenant_id = $1
GROUP BY 1,2;
```

## 3. The M3↔M4 reconciliation (the line to get right)
A produced quantity is recorded **once** as a `canon.event` ProductionCount. **M3 contextualises** it (attainment, OTIF, sequence compliance — *did we run the plan?*); **M4 aggregates** it (OEE Performance/Quality — *how efficiently did the machine run?*). Two different metrics, one production truth. The same applies to `StateEvent` (M3 dispatch feasibility vs M4 Availability) and the Planned-Production-Time denominator (defined once by `canon.shift`). **Acceptance:** M3's throughput numbers must tie to M4's count inputs to the unit.

## 4. Financial impact (D7, effective-dated)
Price each gap via `canon.cost_rate` effective at the event date:
- **Late-order / expedite cost** = late hours × expedite rate (or penalty per order).
- **Idle-capacity cost** = unused available minutes × idle rate.
- **Changeover cost** = `setup_matrix.setup_cost` × changeover count.
- **WIP holding** = avg WIP value × holding rate.
Written to `kpi_plan_daily.late_order_cost` / `idle_capacity_cost` and surfaced on exec reports — "attainment +8% = £X avoided expedite + idle."

## 5. Acceptance criteria
- **MUST** reuse ISO 22400 definitions where they overlap M4 (no parallel truth).
- **MUST** resolve cost via the rate **effective at event date** (never today's).
- **MUST** reconcile throughput to M4 count inputs in a cross-module test.
- **SHOULD** publish every KPI to the shared registry with lineage to source rows.
