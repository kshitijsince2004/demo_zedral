# Zedral M1 — Fix Spec: Handover, Data Correctness, PH/Admin (Tasks 1–3)

**Target tree:** the mounted **`hsl_zedral-main`** folder (your real, current code).
**Fingerprint (verify before editing):** `crm_order` + SuperTokens present · SUPERVISOR removed ·
Model A (`ShiftHandoverService`) removed · **66 migrations**, newest `1927_validation_rules_v2`.
This is a **spec only** — describes what to change; no code was modified by this document.

**Guardrails:** one PR per task-part; every migration reversible; don't touch the override-PIN
mechanism; regenerate `db-types.ts` after schema changes; green gate per part
(`npm run build && npm test && npm run arch:check`). Folder is **not** git-tracked — back it up first.

---

# TASK 1 — Shift handover

## 1.1 File map (reference)
- **Backend:** `packages/server/src/routes/machineHandoverRoutes.ts` (overview, pending,
  `:machine/preview|pending|draft|session|outgoing`, `accept/:id`, `clarification/:id`);
  `services/MachineHandoverService.ts` (buildOutgoingPreview → saveDraftHandover →
  createOutgoingHandover → acceptHandover/requestClarification; `ensureActiveSession`,
  `assertProductionAllowed`).
- **DB:** `txn.machine_shift_session`, `txn.machine_handover`, `txn.shift_event_audit`.
- **Frontend:** `pages/sixHi/CrmOutgoingHandoverPage.tsx`, `HandoverAcceptPage.tsx`,
  `components/HandoverAcceptGate.tsx`, `components/live/HandoverOverviewPanel.tsx`,
  `lib/handoverQueue.ts`, `services/machineHandoverService.ts`, `components/sixHi/ShiftEndModal.tsx`,
  `components/sixHi/SixHiLayout.tsx`, `hooks/useShiftEndWatcher.ts`, `lib/shiftDetection.ts`.

## 1.2 How it works (verified)
Login opens an **ACTIVE** `machine_shift_session` (one per machine, DB-enforced). At shift end
`createOutgoingHandover`: **(a)** runs the validation gate (`ShiftLogValidationService.assertValid`),
**(b)** snapshots production/queue/stoppages/crew into a `machine_handover` row = **PENDING**,
**(c)** closes the session, **(d)** fires `shift.closed` (`publishShiftClosed`), **(e)** carries open
work forward, **(f)** writes the shift summary via `saveShiftSummary`. While PENDING,
`assertProductionAllowed` blocks production. The next operator **Accepts** (`acceptHandover`, opens a
fresh session) or **Clarification** bounces it back. Model A is fully removed — no dual path. The
engine is healthy.

## 1.3 THE anomaly — duplicate shift-summary surface *(already applied; revert available)*
`pages/sixHi/SixHiShiftSummaryPage.tsx` posts the same scrap/coolant fields to
`POST /6hi/shift-summary/:id` → `SixHiShiftService.saveShiftSummary` → `txn.crm_shift_summary` — the
**exact same** write the handover page does, but it can capture summary data **without** closing the
session or creating the handover (orphaned summary).

| File | Change |
| --- | --- |
| `client/src/pages/sixHi/SixHiShiftSummaryPage.tsx` | delete (or make a redirect) |
| `client/src/App.tsx` (route `shift-summary`, was ~L169) | `<Navigate to="../handover" replace />`; remove the import |
| `client/src/operator/OperatorApp.tsx` (route `shift-summary`, was ~L60) | same redirect; remove the import |
| `client/src/components/sixHi/SixHiLayout.tsx:79` | regex `\/(handover\|shift-summary)\/?$` → `\/handover\/?$` |
| server `GET/POST /6hi/shift-summary/:id` | **keep** (handover + `sixHiStore` use it) |

**Verify:** grep `SixHiShiftSummaryPage` → 0; one shift-summary entry path (handover). **Status:**
already applied — restore the page from the extracted zip copy to revert.

---

# TASK 2 — Data/log correctness (consolidate shift attribution + tests)

## 2.1 The root problem (verified in this tree)
"Right order in right shift" depends on **6 independent resolvers** agreeing, and
`txn.order_shift_attribution` has **3 writers**.
| Resolver | Location |
| --- | --- |
| `resolveBoundaryShifts` | `services/ShiftBoundaryService.ts:28` |
| `getCurrentShift` | `services/ShiftDetectionService.ts:232` |
| `reattributeOrderToActiveShift` | `services/SixHiService.ts:102` |
| `resolveShiftLogIdForPlan` | `services/SixHiService.ts:2295` **and** `services/sixHi/SixHiShiftService.ts:46` |
| `resolveShiftLogIdForOrder` | `services/SixHiService.ts:2307` |
Writers of `txn.order_shift_attribution`: `services/SixHiService.ts`, `services/ShiftAttributionService.ts`,
`validation/crm6ProductionValidation.ts`. The clock→shift math is already centralized in
`@m1/shared-validation`; only the DB-lookup layer is duplicated.

## 2.2 Consolidation (the fix)
| # | Task | Where |
| --- | --- | --- |
| 2.2.1 | New `ShiftDetectionService.resolveShift({ machineCode?, planDate?, shiftCode?, orderId?, clock? }) → { shiftLogId, shiftCode, prodDate, processId }` (uses `resolveBoundaryShifts` + idempotent `ShiftLogService.create`). Single source of truth. | `services/ShiftDetectionService.ts` |
| 2.2.2 | Make `SixHiService.resolveShiftLogIdForPlan` (:2295), `resolveShiftLogIdForOrder` (:2307), `SixHiShiftService.resolveShiftLogIdForPlan` (:46), `ShiftAttributionService.resolveShiftLogId` **thin delegates** to 2.2.1 (keep signatures — avoids touching every call-site at once). | those files |
| 2.2.3 | Single attribution writer — funnel `SixHiService` + `crm6ProductionValidation.ts` through `ShiftAttributionService.attributeOrder(orderId, shiftLogId)`. | `ShiftAttributionService.ts` + callers |
| 2.2.4 | Boundary correctness — attribute by the **active session's** shift (`resolveShift({machineCode})`), not wall-clock, so pre-midnight-C work stays in the right plant-date shift; `reattributeOrderToActiveShift` moves the order **and its stoppages** together. | `ShiftDetectionService`, `SixHiService.ts:102` |

## 2.3 Stoppage counting (verify + fix)
Both manual (`/manual-stoppage/*`) and in-order stoppages write the **unified `txn.stoppage`** (single
count source — reports read it). Fix: **(a)** every manual stoppage gets a `shift_log_id` via 2.2.1
(never null → else dropped from totals); **(b)** the `machine_state_event` mirror (`STOPPAGE_STARTED`)
is **not** double-counted in any report (live state only); **(c)** a stoppage across a shift boundary is
attributed/split correctly. Files: `SixHiService.ts` (`startOrderStoppage`, manual-stoppage methods),
`services/MachineStateEventService.ts`, `services/ReportingService.ts` stoppage queries,
`routes/sixHiRoutes.ts` manual-stoppage handlers.

## 2.4 Order / logs / history across profiles (consistency pass)
Make every surface read the same resolved attribution:
`components/machinehead/MachineHeadOrderDetailModal.tsx`, `MachineHeadOrderSidePanel.tsx`,
`components/sixHi/OrderProductionHistory.tsx`, `CombinedProductionHistory.tsx`,
`OrderDetailSlidePanel.tsx`, `components/live/OrderDetailModal.tsx`. Verify each shows the order's
attributed shift + status consistently with `order_shift_attribution`.

## 2.5 Machine-Head panels/filters (verify)
`pages/live/MachineHeadDashboard.tsx` filters (`processFilter` ROLLING/SKIN_PASS, `machineFilter`,
`shiftFilter`, debounced search) are wired into `dashFilters` → API. Confirm the **server honors all
four** on every MH endpoint (queue, orders, summary) and that `machineFilter` is scoped to the head's
`machineAccess`. Fix any endpoint that ignores a filter param.

## 2.6 Tests (required)
`packages/server/tests`: order started near a shift boundary lands in the correct plant-date shift; a
manual stoppage between orders attributes to the running shift and appears in its stoppage total;
re-attribution moves order + stoppages together; a combined order attributes both sub-processes to one
shift.

**Done when:** all resolvers delegate to `resolveShift`; one attribution writer; tests green.

---

# TASK 3 — Plant Head dashboard + Admin

## 3.1 PH dashboard — data & formulas (verified sources)
`services/ReportingService.getPlantHeadDashboard` (+ `utils/kpiCalculator`, `reporting/plantHeadDrilldown`,
`reporting/plantHeadWindow`). OEE per line = **Availability × Performance × Quality** (`kpiCalculator`,
target `PLANT_OEE_TARGET`); plant OEE = average of line OEEs. Sources: `txn.shift_log`, `txn.stoppage`,
`txn.crm_shift_summary`, `txn.prod_hrs/crs/ctl`, `txn.defect_entry`, `master.machine/process/shift`.
Charts: recharts in `components/plant-head/PlantMainOpsArea.tsx`, `PlantQualityDowntimeArea`,
`PlantOperationsArea`.

### 3.1a Fix: de-hardcode the mills (HIGH)
`services/ReportingService.ts:177` — `enrichCrm6ShiftProduction` filters CRM shifts to the literal `'6HI'`:
```ts
const crm6Rows = rows.filter((r) => r.lineId === '6HI');   // ← 4HI/2HI excluded
```
Change to filter by the CRM mill **set** resolved from `master.machine`/`machineAllocation`
(mills whose process is ROLLING), e.g. `rows.filter(r => CRM_MILL_CODES.includes(r.lineId))`.
`SixHiShiftService.getProducedMt` is per-`shiftLogId` so it already works for 4HI/2HI. Also review the
CRM scrap/loss aggregation at `:248` (`txn.crm_shift_summary`) and `:685` — confirm they cover all CRM
mills, not just 6HI.

### 3.1b Fix: implement the stubbed filters (HIGH)
`services/ReportingService.ts:158-160` is a literal stub — **grade/customer/coil filters do nothing**:
```ts
// Note: grade, customer, and coil filtering requires joining specific
// production tables (txn.prod_*) or the crm6_order table.  ← stub
```
Implement by joining `txn.crm_order` (`grade_code`, `customer_name`, `coil_no`) for CRM mills and the
relevant `txn.prod_*` for classic lines, constraining the shift set. Wire the client filter controls in
`pages/reports/PlantHeadDashboard.tsx` to pass `grade/customer/coil` params.

### 3.1c Density pass (less scroll, industrial-grade)
`pages/reports/PlantHeadDashboard.tsx:235` stacks areas vertically (`flex flex-col gap-5`) inside
`max-w-screen-2xl` (L199): `PlantKpiStrip → PlantMainOpsArea → PlantQualityDowntimeArea →
PlantOperationsArea → PlantOpsFeed`. Change (reuse components, no rewrite): compact **sticky**
`PlantKpiStrip`; put `PlantMainOpsArea` + `PlantQualityDowntimeArea` in a **2-col grid**
(`lg:grid lg:grid-cols-2 gap-4`); move `PlantOpsFeed`/backlog into a right rail/drawer. Target: KPIs +
two primary charts above the fold on 1080p without scrolling.

**Done when:** 4HI/2HI appear in all PH panels; grade/customer/coil filters change the data; above-the-fold shows KPIs + two charts.

## 3.2 Admin — full pass (state in THIS tree)
| Page | Wiring | Status / action |
| --- | --- | --- |
| `UsersAdmin` ↔ SuperTokens | `adminService` → `/users`; `UserService.create` → `EmailPassword.signUp` | ✅ **already done** (`services/UserService.ts:208`) — just verify create/reset/disable round-trips + `revokeAllSessionsForUser` on disable |
| `ValidationRulesAdmin` / engine | `validationConfigService` → `validationRulesRoutes`; migration `1927` v2 | ✅ **engine v2 already in** (`rule_id`, `process_code`, `MIN_PCT_OF_FIELD`, 97%-PPC seeded) — verify the **admin UI** exposes the new rule types + per-process scope |
| `MachineMasterAdmin` | `/machines/master` CRUD + `/status` | ✅ works — it's the source 3.1a should consume |
| `MachineAssignmentPage` | `/machine-access` GET/PUT | ✅ works |
| `MasterDataAdmin` | `adminService` → `masterDataRoutes` `/:entityType` (ADMIN) | ✅ works — verify every entity maps to an allow-listed table (`validateTable`) so no 500s |
| `PlanningAdmin` | `adminService` → `/import/:batchId` | ✅ works — verify import status polling |
| `SystemAdmin` | near-static (1 data ref) | ⚠️ wire to real health (`/health`, DB/ST/ES status) or label as informational |

**Remaining admin work:** (1) confirm `ValidationRulesAdmin.tsx` UI can create cross-field/%-of-field/
per-process rules (engine already supports them). (2) finish `SystemAdmin` health wiring.

---

# Suggested PR order
1. **T1** shift-summary dedupe *(already applied)*.
2. **T3.1a** de-hardcode mills — unblocks 4HI/2HI reporting.
3. **T3.1b** implement PH filters.
4. **T2** attribution consolidation + tests (own branch — delegates keep the ~30 call-sites stable).
5. **T3.1c** PH density pass (UI only).
6. **T3.2** verify admin round-trips + `SystemAdmin` health.

## Cross-references
- UsersAdmin↔SuperTokens and the validation-engine v2 are **already implemented** in this tree (unlike
  the older zips) — the earlier `ZEDRAL_ENHANCEMENTS_SPEC.md` Items 1 & 6 are effectively done here.
- `ThicknessSpecs` shared-component dedupe (sixHi forms) is in `ZEDRAL_DUPLICACY_CLEANUP_PLAN.md` §F.
