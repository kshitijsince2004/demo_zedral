# Final Production Audit

**Date:** 2026-06-10  
**Scope:** All visible production KPIs — UI → data hook → API → service → calculation → database → displayed value  
**Branch audited:** `main` (through commit `0617591`)

---

## Executive Summary

The production KPI stack is **substantially API-backed** for plant command center, live operations, and machine-head views. Prior phases removed legacy capture flows, fabricated command-center metrics, and hardcoded OEE availability assumptions. Reporting OEE/APQ uses real shift-log aggregates with `master.shift` durations. Live KPIs use machine state events and CRM6 order data.

**Deployment readiness:** **Conditional GO** — safe for production monitoring with documented gaps. No fake trend strings or silent placeholder numbers in primary KPI tiles. Remaining issues are secondary metrics (MTTR/MTBF), incomplete nav pages, minor auth scope gaps, and residual N+1 paths on machine-head weight resolution.

| Area | Status |
|------|--------|
| Hardcoded KPI values in primary tiles | ✅ Clear |
| Fake / fabricated trends | ✅ Clear |
| Primary OEE / APQ calculation | ✅ Real (with documented simplifications) |
| Data integrity validation on write path | ✅ Enforced (with master-data bypass caveats) |
| Export / DPR read scalability | ✅ Batched (Phase 5) |
| Dead code artifacts | ✅ Removed (Phase 6) |
| Secondary placeholders & stub routes | ⚠️ Documented |
| Auth scope on all live endpoints | ⚠️ One gap |
| Residual N+1 hotspots | ⚠️ Low–medium impact |

---

## Fixed Items (Phases 1–6)

| Phase | Item | Outcome |
|-------|------|---------|
| 1.1 | Machine handover authorization | Machine access enforced on handover routes; 403 when unauthorized |
| 1.2 | DPR stub route hardening | Legacy `/dpr/*` stubs removed or hardened |
| 2.x | Legacy line capture removal | CRM6-only flows; offline/sync stack removed |
| 3.1 | OEE availability correction | `calcShiftDurationMinutes` + `buildShiftDurationMap` from `master.shift`; no fixed 480-min assumption when master data present |
| 3.2 | Utilization KPI disambiguation | `machinesRunningPct` (live count) vs `runtimeUtilization` (24h event-based %) labeled separately |
| 3.3 | Machine Head actual production | `actualMt` from completed orders via `resolveOrderWeight`, not queued PPC weight |
| 4.x | Manufacturing data integrity | Stoppage overlap/boundary, runtime accounting, defect/scrap ≤ production validation |
| 5.1 | LiveService N+1 | `getJourneysByCoils`, `resolveMachinePlanContexts` — constant query count vs order volume |
| 5.2 | ExportReadRepository | Per-process batch `shift_log_id IN (...)`; ANN/6HI inner loops eliminated |
| 5.3 | Audit / shift_log indexes | Migration `1804000000000_audit_shift_log_indexes.js` — `audit.audit_log(ts)`, `txn.shift_log(prod_date)` |
| 6.1 | Dead code removal | `DashboardService`, review queue stubs, `ExecutiveShell` deleted |

---

## KPI Trace Matrix

> **Note:** Client uses custom polling hooks (`useLiveSnapshot`, `useEffect` + `setInterval`), not React Query. Intervals: live 8s, plant dashboard 30s.

### A. Plant Command Center — KPI Strip

| KPI | UI | Hook | API | Service | Calculation | DB Tables | Display |
|-----|----|----|-----|---------|-------------|-----------|---------|
| Production Today | `PlantKpiStrip` | `reportingService.getExtendedPlantHeadDashboard` | `GET /reports/plant-head?window=` | `ReportingService.getPlantHeadDashboard` | `sumShiftProduction(todayShifts)` | `txn.shift_log.total_prod_mt`, `master.process` | `{MT} MT` |
| Production Today trend | same | same | same | `pctChange(today, yesterday)` | prior window shift sum | same | `±N%` from API |
| OEE | same | same | same | `plantWideOee(lineOee)` | unweighted avg of line OEE | shift logs + stoppage + loss | `{N}%` |
| OEE trend | same | same | same | `pctChange(current, previous window)` | `lineOeeFromTotals` | same | `±N%` |
| Availability | same | same | same | `plantWideApq` → availability | `calcAvailability` per line, averaged | `txn.stoppage_entry`, `master.shift` durations | `{N}%` |
| Availability trend | same | same | same | `pctChange` on APQ | same | same | `±N%` |
| Performance | same | same | same | `plantWideApq` → performance | `calcPerformance` | `txn.shift_log.target_mt`, `total_prod_mt` | `{N}%` |
| Performance trend | same | same | same | `pctChange` | same | same | `±N%` |
| Quality | same | same | same | `plantWideApq` → quality | `calcQuality` from loss tables | `txn.prod_*` scrap/reject fields | `{N}%` |
| Quality trend | same | same | same | `pctChange` | same | same | `±N%` |
| Machines Running | same | `useLiveSnapshot` | `GET /live/snapshot` | `LiveService.getSnapshot` | `(runningMachines / totalMachines) × 100` | `master.machine`, `txn.machine_state_event`, `txn.crm6_order` | `{N}%` or `—` |

**Auth:** `GET /reports/plant-head` → `PLANT_HEAD | ADMIN`. `GET /live/snapshot` → live roles + machine scope.

---

### B. Plant Command Center — Charts & Panels

| Metric | UI | Hook | API | Service | Calculation | DB Tables | Display |
|--------|----|----|-----|---------|-------------|-----------|---------|
| Daily Target vs Actual | `PlantMainOpsArea` | extended dashboard | `/reports/plant-head` | `dailyProduction` from `oeeByDate` | target/prod per day | `txn.shift_log` | chart or `DataUnavailable` |
| Executive insights (4 rows) | `PlantMainOpsArea` | client `buildExecutiveInsights()` | `/reports/plant-head` | derived from API fields only | plan attainment, lowest line, top defect, lines &lt;90% | same payload | text rows or hidden if null |
| Top Defects | `PlantQualityDowntimeArea` | extended dashboard | `/reports/plant-head` | `fetchTopDefects` | count by defect code | `txn.defect_entry`, `master.defect_code` | bar chart |
| Rejection Rate Trend | same | same | same | `qualityTrend.rejectionRatePct` | `loss / prod × 100` per day | prod loss tables | line chart |
| Downtime Reasons | same | same | same | `downtimeDrivers` | `SUM(duration_min)` by stoppage code | `txn.stoppage_entry`, `master.stoppage_code` | bar chart |
| MTTR | same | — | — | — | **Not implemented** | — | “Not available — repair interval telemetry not configured” |
| MTBF | same | — | — | — | **Not implemented** | — | “Not available — failure interval telemetry not configured” |
| Top Downtime Driver | same | same | same | `downtimeDrivers[0]` | highest minutes | same | text or “Not available” |
| Line plan attainment | `PlantOperationsArea` | extended dashboard | `/reports/plant-head` | `productionVsPlan` | `actual/planned × 100` per line | `txn.shift_log` | table |
| Machine shift progress | same | `useLiveSnapshot` | `/live/snapshot` | `getMachineCards` | `shiftProgressPct` (currently always undefined) | PPC + CRM6 | falls back to line attainment |
| Live order queue | same | `liveService.getOrders()` | `GET /live/orders` | `getActiveOrders` | order list + journey progress | `planning.ppc_batch`, `txn.crm6_order`, journey tables | table |
| Machine card: Produced MT | `MachineStatusBoard` | `useLiveSnapshot` | `/live/snapshot` | `getMachineCards` | reject/production weight from orders | CRM6 + events | value or `—` |
| Ops feed | `PlantOpsFeed` | extended dashboard | — | client hardcodes `opsFeed: []` | n/a | — | “Operations event feed is not configured” |

---

### C. Live Dashboard

| KPI | UI | Hook | API | Service | Calculation | DB Tables | Display |
|-----|----|----|-----|---------|-------------|-----------|---------|
| Running | `LiveDashboard` | `useLiveSnapshot` | `/live/snapshot` | `getSnapshot` | count `status === RUNNING'` | machine state + orders | integer |
| Idle | same | same | same | same | count `IDLE` | same | integer |
| Stoppages | same | same | same | same | orders with `STOPPAGE` status | `txn.crm6_order`, `txn.order_stoppage` | integer |
| Active Orders | same | same | same | same | `orders.length` | PPC + CRM6 | integer |
| Order completion % | queue table | `getOrders()` | `/live/orders` | `journeyProgress` | completed steps / total | `planning.order_journey*` | progress bar |
| Runtime utilization (modal) | `MachineDetailModal` | `getMachineState()` | `/live/machines/:code/state` | `MachineStateEventService.getUtilizationSummary` | event minutes / window | `txn.machine_state_event` | breakdown % |

**Auth:** Machine-scoped routes return 403 outside `machine_access`. SUPERVISOR gets empty machine filter → empty snapshot.

---

### D. Machine Head Dashboard

| KPI | UI | Hook | API | Service | Calculation | DB Tables | Display |
|-----|----|----|-----|---------|-------------|-----------|---------|
| Running / Idle / Stoppages / Active Orders | `MachineHeadDashboard` | `useLiveSnapshot` | `/live/snapshot` | `getSnapshot` | same as Live | same | `CommandMetric` tiles |
| Target MT | shift summary | `getMachineHeadDashboard()` | `/live/machine-head-dashboard` | `getMachineHeadDashboard` | `txn.shift_log.target_mt` | `txn.shift_log` (process_id hardcoded 31) | numeric |
| Completed MT | same | same | same | `getShiftCompletedProductionMt` | sum `resolveOrderWeight` for COMPLETED | `txn.crm6_order`, rolling/skinpass | numeric |
| Queued MT | same | same | same | sum active order weights | PPC weight on queue | `planning.ppc_batch` | numeric |
| Queue Orders | same | same | same | `orders.length` | count | same | integer |
| Runtime Utilization % (24h) | same | same | same | `getUtilizationSummary` per machine | running min / 1440 | `txn.machine_state_event` | % per machine |
| Production History | same | same | same | last 10 completed | `resolveOrderWeight` per order | CRM6 | list |

**Auth:** `MACHINE_HEAD | SUPERVISOR | PLANT_HEAD | ADMIN` + `getMachineScope`.

---

### E. Operator — 6HI Shift Summary

| KPI | UI | Hook | API | Service | Calculation | DB Tables | Display |
|-----|----|----|-----|---------|-------------|-----------|---------|
| Stoppage / Breakdown min | `SixHiShiftSummaryPage` | `apiClient.get` | `GET /6hi/shift-summary/:id` | `SixHiService.getShiftSummary` | sum order stoppages + shift attribution | `txn.order_stoppage`, `txn.crm6_order` | minutes |
| Runtime utilization % | same | same | same | runtime vs shift duration | validated when shift times present | `master.shift`, order runtime | % |
| Total / Rolling / Re-Rolling / Skin Pass MT | same | same | same | `getProducedMt` | per-order weight resolution | CRM6 production tables | MT |

**Auth:** `requireSixHi('READ')` — machine-scoped 6HI access.

---

### F. Shared OEE Formula Chain (Reporting)

```
txn.shift_log (target_mt, total_prod_mt, prod_date, shift_code, process_id)
  + txn.stoppage_entry (duration_min)     → downtime
  + txn.prod_* loss columns               → quality loss
  + master.shift (start_time, end_time)   → shift minutes
        ↓
aggregateLineOee → lineOeeFromTotals → calcAvailability / calcPerformance / calcQuality / calcOee
        ↓
plantWideOee / plantWideApq / kpiStrip trends (pctChange vs prior window)
```

**Constants (display / fallback only):**

| Constant | Value | Location | Used for |
|----------|-------|----------|----------|
| `PLANT_OEE_TARGET` | 80% | `kpiCalculator.ts` | OEE target reference in API payload |
| `REJECTION_COST_PER_MT` | ₹3500 | `kpiCalculator.ts` | Management dashboard cost estimate (no UI consumer) |
| `DEFAULT_SHIFT_MINUTES` | 480 | `kpiCalculator.ts` | Fallback when `master.shift` times missing |

---

## Verification Checklist

### No hardcoded values (primary tiles)

| Check | Result |
|-------|--------|
| Plant KPI strip values | ✅ From `/reports/plant-head` + live snapshot |
| Plant KPI strip trends | ✅ `pctChange` vs prior window — not static strings |
| Live count KPIs | ✅ Computed from machine cards / orders |
| Machine head shift MT | ✅ Target from shift_log; completed from actual weights |
| Executive insights | ✅ Derived from API payload only (`plantHeadInsights.ts`) |

**Residual hardcoding (not shown as primary tiles):** `getExtendedPlantHeadDashboard` sets `breakdownMachines: 0`, `mttrHours: 0`, `mtbfHours: 0`, `activeAlerts: 0`, `opsFeed: []`, `criticalAlerts: []`. UI either shows honest “not available” or empty-state messages.

### No placeholder metrics / fake trends

| Check | Result |
|-------|--------|
| Fabricated OEE/MTTR/MTBF in command center | ✅ Removed; MTTR/MTBF show explicit unavailable copy |
| Fake trend strings (e.g. `+1.2%`) | ✅ None in KPI strip |
| “Coming Soon” standalone pages | ⚠️ `/plant/production`, `/plant/alerts`, `/plant/defects`, `/plant/stoppages`, intelligence nav routes — **no KPIs**, placeholder pages only |
| Dashboard vs nav mismatch | ⚠️ Defect/downtime charts live on command center; nav intelligence routes still “Coming Soon” |

### No unauthorized access paths

| Endpoint | Auth | Finding |
|----------|------|---------|
| `/reports/plant-head` | `PLANT_HEAD \| ADMIN` | ✅ |
| `/reports/supervisor` | `SUPERVISOR \| ADMIN` + line scope | ✅ |
| `/live/machines/:code/state` | machine scope 403 | ✅ |
| `/live/machines/:code/next-order` | auth only, **no machine scope** | ⚠️ **Gap** — any live-role user can query any machine’s next order |
| `/live/stream` | machine scope on cards | ✅ |
| `/6hi/shift-summary/:id` | `requireSixHi` | ✅ |
| Machine handover | machine access 403 | ✅ (Phase 1.1) |
| `/reports/drilldown` | `SUPERVISOR \| PLANT_HEAD \| ADMIN` — no line filter | ⚠️ Supervisor sees plant-wide drilldown |

### No N+1 hotspots (critical paths)

| Path | Status |
|------|--------|
| `getActiveOrders` + journey lookup | ✅ Fixed — 2-query batch |
| `resolveMachinePlanContexts` | ✅ Fixed — ≤3 queries total |
| `ExportReadRepository.fetchRuns/fetchStoppages` | ✅ Fixed — batched by process |
| `getSupervisorDashboard` active shift check | ⚠️ Per-shift stoppage query remains |
| `getShiftCompletedProductionMt` / machine-head history | ⚠️ `resolveOrderWeight` per completed order |
| `getMachineHeadDashboard` utilization | ⚠️ `getUtilizationSummary` per machine |

### No duplicate KPI definitions

| Concept | Definitions | Risk |
|---------|-------------|------|
| “Utilization” | `machinesRunningPct` (running count %), `runtimeUtilizationPct` (24h events), `shiftPerformancePct` (orders IN_PROGRESS ratio — **misnamed**) | ⚠️ Medium — labels disambiguated in UI except `shiftPerformancePct` unused in display |
| “Production today” | KPI strip vs extended `productionTodayMt` vs line attainment sums | ✅ Same source (`kpiStrip`) |
| OEE | Reporting `lineOeeFromTotals` vs Live (no OEE) | ✅ Clear separation |
| `/reports/drilldown?metric=oee` | Uses `calcPerformance` only, not full OEE | ⚠️ Incorrect if drilldown UI wired later |

### No validation bypasses

| Path | Bypass condition | Risk |
|------|------------------|------|
| Order stoppage window check | Skipped when `master.shift` times missing | Medium — bad downtime data possible |
| Shift-log stoppage overlap/runtime | Skipped when shift bounds null | Medium |
| CRM6 output weight | Skipped when `actualWeightMt == null` | Low — falls back to PPC weight in reads |
| CRM6 scrap validation | Skipped when scrap null/≤0 | Low |
| Order runtime accounting | Skipped when no `prod_start_at` or missing shift times | Medium |
| Shift summary runtime accounting | Only on save; skipped if shift times missing | Medium |

---

## Remaining Findings

### High — none blocking primary monitoring

No critical fake KPIs in production-facing tiles.

### Medium

1. **`GET /live/machines/:code/next-order`** — missing machine scope check (information disclosure for queue position).
2. **`shiftPerformancePct`** — misleading name; counts IN_PROGRESS orders, not performance vs target (currently not displayed).
3. **`process_id = 31`** hardcoded in `getMachineHeadDashboard` for shift target lookup — fragile if process IDs change.
4. **Plant filter stub** — grade/customer/coil filters accepted by API but not applied (`ReportingService.fetchShiftRows` comment stub).
5. **`/reports/drilldown` OEE metric** — performance-only, not true OEE.
6. **Validation skips** when `master.shift` start/end times incomplete — undermines downtime/runtime KPI accuracy.
7. **Supervisor empty live snapshot** — by design (no machine access), but may confuse if supervisor opens live views.

### Low

1. **MTTR / MTBF** — honest unavailable state; no telemetry source.
2. **Ops feed / critical alerts** — empty by design; panels show configuration message.
3. **Standalone nav pages** — Coming Soon while dashboard embeds real charts.
4. **Unused UI:** `KpiCard`, `DrilldownPanel`, `KpiDrilldownModal`; `getManagementDashboard` / `getSupervisorDashboard` have no client consumers.
5. **Residual N+1** on machine-head weight resolution and supervisor active-shift loop — acceptable at current scale, not month-end critical.
6. **`plantWideOee`** — simple average of line OEEs, not production-weighted.
7. **`fix-types.js` / `fix-types2.js`** — reference deleted `DashboardService.ts` (maintenance scripts only).

---

## Risk Level Summary

| Category | Level | Notes |
|----------|-------|-------|
| Primary KPI accuracy | **Low** | Real DB-backed; known formula simplifications documented |
| Data integrity (write path) | **Low–Medium** | Validators in place; master.shift gaps weaken enforcement |
| Security (KPI endpoints) | **Low–Medium** | One live next-order scope gap; drilldown plant-wide for supervisor |
| Scalability (read path) | **Low** | Phase 5 batching on hot paths; minor N+1 remains |
| UX completeness | **Medium** | Coming Soon routes vs embedded charts; MTTR/MTBF unavailable |
| Operational deploy risk | **Low** | No silent fake metrics in command center |

---

## Deployment Readiness Assessment

### Ready for production

- Plant Command Center KPI strip (Production, OEE, A/P/Q, Machines Running)
- Plant production vs target, defect, and downtime charts
- Live machine status board and machine-head shift summary
- DPR export read path (batched queries + date indexes after migration)
- Manufacturing validation on stoppage, runtime, and defect/scrap writes
- Dead code cleanup complete for audited artifacts

### Pre-deploy actions

1. **Run migration:** `1804000000000_audit_shift_log_indexes.js` on all environments.
2. **Verify `master.shift`** has `start_time` / `end_time` for all shift codes — required for accurate availability and validation.
3. **Confirm `process_id` for 6HI** matches production DB or replace hardcoded `31` with `SixHiService.getProcessId()`.

### Post-deploy recommended (non-blocking)

1. Add machine scope check to `/live/machines/:code/next-order`.
2. Batch `resolveOrderWeight` for machine-head completed production.
3. Wire or remove unused drilldown components; fix `/reports/drilldown` OEE metric mapping.
4. Implement or permanently remove MTTR/MTBF panels and ops feed.
5. Align nav “Coming Soon” routes with embedded dashboard capabilities or redirect.

---

## Conclusion

**Verdict: Conditional GO for production monitoring.**

Primary visible KPIs trace cleanly from UI to database with no hardcoded tile values and no fabricated trends. Placeholders that remain are explicitly labeled (MTTR/MTBF, ops feed) or isolated to unrouted Coming Soon pages. Phase 1–6 fixes address the highest-risk issues (fake command-center data, OEE availability, data integrity, export N+1, dead code). Remaining findings are documented above with medium-or-lower risk and clear remediation paths.
