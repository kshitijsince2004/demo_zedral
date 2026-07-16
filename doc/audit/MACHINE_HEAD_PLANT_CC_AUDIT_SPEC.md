# Machine Head & Plant Command Center — Audit & Implementation Spec

**Target tree:** mounted **`hsl_zedral-main`** (monorepo — `packages/client`, `packages/server`).
**Nature:** diagnosis + *where-to-edit* sheet. **No code changed.** Line numbers are from the current
working tree (not git-pinned) — **re-confirm before editing.**

**Prime directive (unchanged from the original brief):** *Do not assume anything.* For every item below,
first open the named file(s) and verify the endpoint / query / integration already exists. **Reuse and
reconnect before creating anything new.** Most of the "missing" pieces in the brief already exist on the
backend and are either disconnected, filtered too narrowly, or reading the wrong field — those are
reconnection jobs, not new-build jobs. New endpoints are called out explicitly and are the exception.

### No patchwork — fix at the root, delete what's redundant

This work must **not** add band-aid layers on top of the existing code. Every fix below is a root-cause
change, and where a fix makes existing code, components, endpoints, or whole files **redundant, duplicate,
or dead, delete them** — do not leave them orphaned "just in case." Concretely:

- **No parallel/duplicate implementations.** If a metric or list is fixed at the service layer, remove any
  client-side re-computation, fallback (`?? actualMt`-style), or shadow copy that existed to paper over the
  bug. One source of truth per value.
- **Delete duplicate cards/components, not just hide them.** For the Command Center de-duplication (Task 5.2),
  if removing the duplicate section leaves a component (or a sub-block of `PlantOperationsArea` /
  `Plant*Area`) with no remaining consumer, delete the component and its imports — don't comment it out or
  gate it behind a flag.
- **No dead endpoints.** If a query is replaced (e.g. the active-only stoppage path), and the old shape is no
  longer referenced, remove it rather than leaving both.
- **Remove stale scoping hacks.** The active-shift-vs-date pinning is fixed once, centrally; delete the
  per-screen workarounds it replaces.

The implementation report (bottom of this spec) must list **every file/endpoint/component deleted** and why,
so removals are auditable. When unsure whether something is truly unused, grep for references before deleting
and note it as an assumption — but default to removing dead code, not accumulating it.

---

## 0. Orientation — where each surface actually lives

| Surface (as named in the brief) | Route | Primary file |
|---|---|---|
| **Machine Head dashboard** (all tabs) | `/machine-head-dashboard` | `packages/client/src/pages/live/MachineHeadDashboard.tsx` (~970 lines) |
| **Shift Review** panel | `/machine-head/shift-review` | `packages/client/src/pages/plant/PlantShiftReviewPage.tsx` |
| **Plant Command Center** | `/plant` (index) | `packages/client/src/pages/reports/PlantHeadDashboard.tsx` — shell title set in `components/layout/UnifiedShell.tsx:92` |
| **Live Operations** (Command-Center subtab) | `/plant/live` | `packages/client/src/pages/live/LiveDashboard.tsx` |
| Machine-head crew register | `/machine-head/crew` | `packages/client/src/pages/machinehead/MachineHeadCrewPage.tsx` |

**Backend spine for all of the above**

| Concern | File |
|---|---|
| Machine-head dashboard payload | `packages/server/src/services/LiveService.ts` → `getMachineHeadDashboard` (line 1006) |
| Shift summary / production math | `packages/server/src/services/SixHiService.ts` → `getShiftSummary` (~2250) and `packages/server/src/services/sixHi/SixHiShiftService.ts` |
| Shift attribution (utilization, stoppage minutes, orders-in-progress) | `packages/server/src/services/ShiftAttributionService.ts` |
| Completed-orders endpoint | `GET /6hi/orders/completed` — `packages/server/src/routes/sixHiRoutes.ts:387` |
| Rejected/held + queue endpoints | `packages/server/src/routes/sixHiRoutes.ts` (`/queue` at 316) |
| Plant Command Center payload | `ReportingService.getPlantHeadDashboard` (line 640) via `GET /reports/plant-head` (`routes/reportRoutes.ts:86`) |
| Live snapshot (KPIs, machine cards, live queue) | `LiveService` + `routes/liveRoutes.ts`, client `lib/liveService.ts` |
| Shift-handover state machine | `packages/server/src/services/MachineHandoverService.ts` |
| Shift/session detection | `packages/server/src/services/ShiftDetectionService.ts` |
| Shift-boundary "cron" | `packages/server/src/jobs/ShiftBoundaryScheduler.ts` (currently a **no-op** — see Task 1) |
| Operator identity | `security.app_user.full_name` via `crm_order.logged_in_user_id`; crew fallback `MachineCrewService` (`master`/`txn` machine_crew) |

---

## Task 1 — Shift Handover: "shifts hand over automatically"

### 1.1 Root cause is already diagnosed — do not re-investigate from scratch

Two prior investigation docs in the repo root cover this end-to-end. **Read them first; this task is to
confirm and act on them, not to re-derive them.**

- `ZEDRAL_BUG_STALE_SHIFT_SESSION_SPEC.md` — the "auto handover / bounces back to yesterday's shift" bug.
- `HANDOVER_AND_DATEFILTER_INVESTIGATION.md` — handover freeze/403 + date-filter scoping.

### 1.2 The finding, in one paragraph

There is **no scheduled/cron auto-handover.** `packages/server/src/jobs/ShiftBoundaryScheduler.ts` is a
deliberate **no-op** (policy: no automatic shift advance). So the reported "shift handed over without a
manual action" is **not** a background job promoting the shift. It is the **stale `machine_shift_session`**
effect: a session left `ACTIVE` overnight is treated as *live* for a full plant-day, the resolver pins the
operator to **yesterday's** shift, and the operator must hand over once per crossed shift-boundary to "catch
up" — which *looks* like the system handing over on its own.

### 1.3 Where to confirm (read-only), in order

1. `packages/server/src/jobs/ShiftBoundaryScheduler.ts` — confirm it performs no state transition (rules out
   a cron cause).
2. `packages/server/src/services/ShiftDetectionService.ts`:
   - `isSessionDateLive` (~line 20) — flat "yesterday still counts as live" window (the defect).
   - `findActiveSession` (~line 155) — same flat window in SQL; returns yesterday's ACTIVE session.
   - `getCurrentShift` (~line 232) — "ACTIVE session wins even when the clock rolled" → pins to yesterday.
3. `packages/server/src/services/MachineHandoverService.ts`:
   - `ensureActiveSession` (~line 942) — reuse + **circular** stale-close (derives "current shift" from the
     same stale session it is trying to close).
   - `acceptHandover` (~line 721) — does not guarantee a single ACTIVE session survives the cutover.

### 1.4 What to edit (once confirmed) — follow `ZEDRAL_BUG_STALE_SHIFT_SESSION_SPEC.md` §"The fix"

Bound "live" by the shift's real end datetime + a grace window (new env `SHIFT_OVERTIME_GRACE_HOURS`,
default 2) instead of a calendar day; make `findActiveSession` drop expired rows; make
`closeStaleOperatorSessions` decide staleness from liveness (not a passed-in shift, removing the circular
call); and have `acceptHandover` close all other ACTIVE sessions for the machine before opening exactly one.
**Do not touch the scheduler** — keeping it a no-op is correct once staleness is bounded.

**Do not modify anything under Task 1 until the two docs' root cause is re-confirmed on this tree.**
Diagnostic to run on the factory DB before editing: are the stuck handovers `PENDING` (submitted, never
accepted) or `ACCEPTED`? That decides which of the five changes is load-bearing (see the doc's "Still to
confirm" section).

---

## Task 2 — Machine Head Dashboard: per-tab audit

All seven tabs are rendered by the single component `pages/live/MachineHeadDashboard.tsx`. The tab union is
declared at **line 24** (`DashboardTab`) and the tab bar is built at **~line 291–299**. Note the **label vs.
id mapping is not 1:1** and is a frequent source of confusion:

| Brief tab | Internal tab id | Label source | Data source |
|---|---|---|---|
| Overview | `overview` | `Overview` | live snapshot + `dashboard.shiftSummary` / `runtimeUtilization` |
| Orders | `orders` | `Orders (n)` | `dashboard.orderQueue` filtered to PREPARING/IN_PROGRESS/RUNNING (render ~line 424) |
| Production | `production` | `Production (n)` | `dashboard.productionHistory` + `operatorActivity` (render ~line 477) |
| Stoppages | `stoppages` | `Stoppages (n)` | `dashboard.stoppages` (render ~line 546) |
| Completed Orders | `completed` | `Completed (n)` | `GET /6hi/orders/completed` (fetch effect ~line 217) |
| **Order Hold** | **`rejected`** | `Order Hold (n)` | `liveService.getRejectedOrders` (fetch effect ~line 197) |
| Handover | `handover` | `Handover (n)` | `dashboard.handoverOverview.pending + recent` |

Backend payload for the whole page: `LiveService.getMachineHeadDashboard` (line 1006). Verify each list end
to end (payload field → client `filtered*` memo → JSX) before adding anything.

### 2.1 Orders tab — running / preparing / completed queues

- **Running & Preparing:** already correct. `filteredQueue` (~line 268) keeps `status ∈ {PREPARING,
  IN_PROGRESS, RUNNING}` from `dashboard.orderQueue`; server builds it in `LiveService.getActiveOrders`.
  Verify the three statuses actually flow through and are not collapsed upstream.
- **Completed queue** lives in its own tab (2.2), not here — the brief lists all three "queues" together but
  the UI splits them. No change needed beyond confirming live data.

### 2.2 Completed Orders tab — "appears incomplete"

**The endpoint is NOT missing.** `GET /6hi/orders/completed` exists (`sixHiRoutes.ts:387`), joins
`crm_order → ppc_batch → machine → app_user`, filters `status = 'COMPLETED'`, honours `machine/date/shiftCode`,
returns `operator_name`, `weightMt (ppc_weight_mt)`, coil/slit identity, timestamps, limit 200. The client
fetch effect (~line 217) already calls it and renders rows.

**What is actually incomplete (fix these):**

1. **No shift totals / metric roll-up.** The tab renders a row list only. Add a header summary: **count of
   completed orders this shift** and **total completed MT** — both are already computable from
   `dashboard.shiftSummary.completedOrderCount` and `completedProdMt` (payload fields, see Task 3) or by
   summing the fetched rows. Prefer the shift-summary fields so the number matches Overview.
2. **"Current shift" scoping is date-based, not shift-log based.** The endpoint filters by `prod_end_at`
   within a calendar day (`sixHiRoutes.ts` ~line 393) and `pb.shift_code`, whereas the rest of the dashboard
   scopes by resolved `shift_log_id`. Align it: accept/prefer `shiftLogId` (resolve via
   `SixHiShiftService.resolveShiftLogIdForPlan`) so "completed orders of the current shift" matches the
   Overview and Completed count exactly. This is the same active-shift-vs-date mismatch documented in
   `HANDOVER_AND_DATEFILTER_INVESTIGATION.md` Issue 3.
3. **History/log presentation:** rows are present but verify ordering (`prod_end_at desc`) and that the
   operator name renders (it's in the payload as `operator_name`; see Task 5.5 for the null-operator fix).

### 2.3 Production tab — full production history for the shift

- Left panel "Production History · This Shift" binds to `dashboard.productionHistory`; right panel
  "Operator Activity" binds to `dashboard.operatorActivity` (render ~line 477–545).
- **Backend gap to verify:** `productionHistory` is built from the **`completed` list inside
  `getMachineHeadDashboard`**, and that query is **`.limit(10)`** (`LiveService.ts` ~line 1060). So the
  Production tab silently shows at most 10 rows even if the shift completed more. **Where to edit:** raise or
  remove the limit for the production-history projection (or source it from the same query as the Completed
  tab), so "complete production history for the current shift" is truly complete.
- Metrics for this tab (activity, history, MT) all resolve server-side; confirm they key off the resolved
  `shiftLogId`, not the 24h window.

### 2.4 Order Hold tab (`rejected`)

- Fetch effect ~line 197 calls `liveService.getRejectedOrders({ date, shiftCode, machine, limit:100 })`;
  server builds the held/rejected list in `getMachineHeadDashboard` (rejected query ~line 1085, with
  `rejectedOrderCount` for the tab badge). This path is wired.
- **Verify:** (a) held orders display with reason + who held it + timestamp (payload has `reason`,
  `rejectedBy`, `rejectionTime`); (b) the date/shift filter in this tab honours the selected date — same
  active-shift-pin caveat as 2.2. Fix scoping the same way if a past date shows today's holds.

### 2.5 Stoppages tab — replace "active only" with filtered history

**Confirmed defect.** The panel header literally reads **"Active Machine Stoppages"** (render ~line 546) and
the backend query hard-filters **open** stoppages: in `LiveService.getMachineHeadDashboard` the stoppage
query ends with **`.where('os.end_at', 'is', null)`** (~line 1170s) and `.limit(15)`. So only in-progress
stoppages ever appear.

**Where / what to edit:**

1. **Backend — new/expanded query.** There is **no existing stoppage-history endpoint** to reuse:
   `routes/stoppageRoutes.ts` exposes only `POST /` and `StoppageService` only has `create`. So this is a
   genuine **new read path**. Add a stoppage-history query (either a new `GET /6hi/stoppages` /
   `GET /stoppages` route + `StoppageService.list(...)`, or extend the machine-head payload) that:
   - does **not** filter `end_at IS NULL` (include closed stoppages),
   - accepts filters: machine(s), date/shift (resolved `shiftLogId`), sub-process, reason/category,
   - returns machine-wise rows with `duration_min` (computed for closed, live-elapsed for open), reason
     (`stoppage_category.label`), and start/end timestamps.
   Model it on the CRM6 stoppage join already used in `ReportingService.getPlantHeadDashboard`
   (`txn.stoppage os → crm_order → stoppage_category`, ~line 760) — reuse that join shape rather than
   inventing a new one.
2. **Frontend — `MachineHeadDashboard.tsx` stoppages tab (~line 546):** rename to "Stoppage History", drive
   the table from the new history source, add the filter controls (machine / shift / reason), and show a
   Status column that distinguishes Active vs Ended instead of hard-coding the "Active" badge (~line 610).

### 2.6 Handover tab

- Binds to `dashboard.handoverOverview` (`pending + recent`, de-duped by `handoverId`, ~line 279).
  Server: `MachineHandoverService.getHandoverOverview`. This is display-only here; the real handover fixes
  are Task 1. Verify the list renders and links correctly; no data change expected.

### 2.7 Overview tab

- Renders "Your Machines" (`MachineStatusBoard`), "Shift Summary" (see Task 3), and "Runtime Utilization
  (24h)". All three are in `dashboard`. The Shift Summary metrics are the subject of Task 3.

---

## Task 3 — Shift Summary metrics (Machine Head → Overview → Shift Summary)

Rendered as `StatCell`s at **~line 372–392** of `MachineHeadDashboard.tsx`, from `dashboard.shiftSummary`.
The summary object is assembled in `LiveService.getMachineHeadDashboard` at **~line 1230–1241**, which pulls
production figures from `LiveService.getShiftCompletedProductionMt` (line 958) → `SixHiShiftService.getShiftSummary`
→ `SixHiService.getShiftSummary` (~line 2250). Fix the math at the service layer; the UI mostly just needs
to bind the corrected fields.

| Metric (UI label) | Current source | Current behaviour | Required behaviour | Where to edit |
|---|---|---|---|---|
| **Target MT** ("Target Metric Done") | `shiftSummary.targetMt = Number(shiftLog.target_mt)` (`LiveService.ts:1233`) | Reads the shift-level **planned target** stored on `txn.shift_log.target_mt` — a single plan figure, not tied to what completed | Sum of **PPC/planned weight (`ppc_batch.ppc_weight_mt`) of the orders COMPLETED in that shift** | Compute in `SixHiService.getShiftSummary` (the `completedOrders` loop already iterates completed orders ~line 2265 — accumulate their `ppc_weight_mt` into a new `targetCompletedMt`), surface it through `SixHiShiftService.getShiftSummary` → `LiveService.getShiftCompletedProductionMt` → `shiftSummary.targetMt`. **Do not** keep reading `shift_log.target_mt` for this cell. |
| **Completed MT** | `shiftSummary.completedProdMt` (`SixHiService` line 2292 = `completedRolling + completedSkinpass`) | Actual produced weight of completed orders | Keep — this is "Actual completed production weight". Verify the UI binds `completedProdMt`, not `actualMt` (render ~line 382 currently falls back to `actualMt`). | Bind cleanly to `completedProdMt`; drop the `?? actualMt` fallback once populated. |
| **Total Metric Tonne** | `shiftSummary.totalProdMt` (`SixHiService:2306` = completed + in-progress) | Currently effectively equals Completed (the brief's complaint) because in-progress is often 0 | **Total completed production metric** = completed + in-progress produced weight (`totalProdMt`). Keep, but ensure `inProgressProdMt` actually contributes (see next row) so it differs from Completed. | Verify `inProgressProdMt` populates; bind to `totalProdMt`. |
| **In Progress MT** | `shiftSummary.inProgressMt` ← `summary.inProgressProdMt` (`SixHiService:2294`) | Sum of in-progress + stoppage order weights (`wt > 0` guard, ~line 2280) | **Total production currently in progress** — correct definition. Verify weights resolve for IN_PROGRESS/STOPPAGE orders (uses `getOrderProductionWeight`) and aren't dropped by the `wt <= 0` continue. | Confirm `getOrderProductionWeight` returns partial weight for in-flight orders; if it returns 0 for not-yet-completed orders, this cell stays 0 and Total==Completed — fix at the weight resolver. |
| **Runtime Utilization** | `dashboard.runtimeUtilization[]` ← `MachineStateEventService.getUtilizationSummary(machineCode, 24)` | Per-machine running % over 24h; wrapped in try/catch → 0 on error | Verify calculation is correct and non-zero when machine-state events exist. Cross-check against `ShiftAttributionService.getShiftMetrics().machineUtilizationPct` (shift-scoped) — decide which window the Overview should show (24h vs shift). | `LiveService.ts` ~line 1242 (24h call) and `ShiftAttributionService.getShiftMetrics`. |

**Net:** the only *incorrect* metric is **Target MT** (wrong source). The others are correct by definition
but appear wrong because **in-progress produced weight resolves to 0**, collapsing Total into Completed —
that is the real thing to verify/fix (`SixHiService.getOrderProductionWeight` for non-completed statuses).

### 3.6 Every metric must be present for **all machines — 6HI, 4HI, 2HI** (not just 6HI)

The whole summary path is named `SixHiService` / "6HI process", but the three mills actually share **one CRM
rolling process**: `getProcessId()` resolves `master.process` code **`ROLLING`** (constant
`SIX_HI_PROCESS_CODE = 'ROLLING'`, `SixHiService.ts:42/55`), and mills are distinguished by `machine_code` +
`sub_process` (`ProcessRouteService.ts:52–76`: `6HI`→ROLLING+SKIN_PASS, `4HI`→ROLLING+SKIN_PASS,
**`2HI`→SKIN_PASS only**). So the summary is *designed* to cover all three — but three things must be
verified/fixed so the data is genuinely present for a 4HI or 2HI machine head, not silently 6HI-biased:

1. **Kill the hardcoded process id.** `LiveService.ts:1060` uses `.where('process_id', '=', 31)` (magic
   number) for the `shift_log.target_mt` lookup. Replace with `SixHiService.getProcessId()` so it always
   binds to the real ROLLING process and can never point at the wrong/stale process for a given mill. Confirm
   `31` == the `ROLLING` process id on the factory DB before/while changing.
2. **Remove the `'6HI'` default fallbacks from any summary-feeding call.** `SixHiService` defaults
   `machineCode = '6HI'` in several signatures (`~:350`, `~:1010`, `~:1179`, `~:1236`, `~:1943`). If a summary
   query ever runs without an explicit machine, it silently computes **6HI** numbers. Ensure the
   machine-head's `machineFilter` (from `LiveService.getMachineScope`) flows into **every** summary/completed/
   in-progress/stoppage query, and drop the `'6HI'` default (or make it throw) so a missing machine can't
   masquerade as 6HI. This is the core of the reviewer's requirement.
3. **2HI has no ROLLING — treat "0 rolling" as valid, not broken.** For 2HI every rolling figure
   (`totalRollingMt`, rolling completed/in-progress) is legitimately 0; its production is entirely SKIN_PASS.
   The summary aggregation already sums both sub-processes (`SixHiService.getShiftSummary` add-weight loop
   ~:2250), so verify Completed/Total/In-Progress/Target for 2HI come purely from skin-pass and that the UI
   doesn't render a mill as empty just because one sub-process is absent.

**Acceptance:** log in as a machine head scoped to **each** of 6HI, 4HI, and 2HI in turn and confirm every
Shift-Summary cell (Target MT, Completed MT, Total MT, In-Progress MT, Runtime Utilization) populates with
that mill's own numbers — no zeros caused by process/machine mis-scoping, no 6HI values leaking into a 4HI/2HI
view. Add a regression test per mill.

---

## Task 4 — Shift Review panel (decision: **extend the existing page**)

### 4.1 What it is today (do not assume it's a summary)

`pages/plant/PlantShiftReviewPage.tsx` is an **approval queue**, not a shift summary. It loads
`GET /shift-logs?state=SUBMITTED` (`shiftLogRoutes.ts`), filters to the machine-head's machines, and offers
**Approve / Reject / Reopen** (`PUT /shift-logs/:id/approve|reject|reopen`). It shows only log metadata
(date, shift, submitter, entry/override counts). This is the former supervisor-approval workflow.

### 4.2 Intended purpose (from the brief) + chosen approach

The brief wants a **complete summary of a finished shift** so a Machine Head can click any completed shift
and immediately understand everything that happened. **Approach chosen: extend this page** — keep the
approve/reject/reopen actions, and add the full shift summary inline so a reviewer sees the whole picture
and acts in one place (rather than a separate read-only view).

### 4.3 What to build — reuse existing services, add one aggregation endpoint

Almost every required datum already exists in a service; the gap is that **no single endpoint returns a
per-shift review bundle.** Reuse first, then add a thin aggregator.

| Review section (brief) | Existing source to reuse |
|---|---|
| Shift overview (date, shift, machines, times) | `shift_log` row + `MachineHandoverService` shift start/end/duration (already surfaced as `shiftStartAt/shiftEndAt/shiftDurationMinutes` in the handover overview) |
| Orders completed | `SixHiService.getShiftSummary().completedOrders` |
| Orders in progress | `ShiftAttributionService.getShiftMetrics().ordersInProgress` |
| Orders moved to backlog | backlog bucketing in `SixHiService` (plan_date vs operational date, ~line 355) / `reports/plant-head/backlog` |
| Production summary / total / planned vs actual | `SixHiService.getShiftSummary` (`totalProdMt`, `completedProdMt`, plus new `targetCompletedMt` from Task 3); planned-vs-actual pattern in `ReportingService.getPlantHeadDashboard` (`productionVsPlan`) |
| Machine stoppages | the Task 2.5 stoppage-history query (shift-scoped) + `ShiftAttributionService` stoppage/breakdown minutes |
| Shift logs / important events | `shiftLogService` entries + `AuditTrailService` |
| Operator activity | `dashboard.operatorActivity` builder + crew register (Task 5.5) |
| Insights for planners/supervisors | derive from the above (attainment %, utilization %, downtime split) |

**Where / what to edit:**

1. **Backend — add `GET /shift-logs/:id/review` (or `/reports/shift-review/:shiftLogId`).** New route that
   composes the services above into one payload. Put the composition in a service method (e.g.
   `ReportingService.getShiftReview(shiftLogId)`) so it's testable and reusable. Do **not** duplicate the
   production math — call `SixHiService.getShiftSummary` and `ShiftAttributionService.getShiftMetrics`.
2. **Frontend — `PlantShiftReviewPage.tsx`.** Under each `SUBMITTED` log card (and ideally for any completed
   shift, not just submitted ones), add an expandable "Shift summary" panel that fetches the new endpoint and
   renders the sections above. Keep the existing Approve/Reject/Reopen actions. Consider allowing the page to
   list completed shifts (not only `state=SUBMITTED`) so a reviewer can open historical shifts — confirm this
   scope with the plant before widening the query.

---

## Task 5 — Plant Command Center (`/plant` → `PlantHeadDashboard.tsx`)

### 5.1 Current layout (render order in `PlantHeadDashboard.tsx`)

1. Filter/toolbar row (grade/customer/coil, window, Ops feed).
2. `PlantKpiStrip` — Production Today, OEE, Availability, Performance, Quality, Machines Running, Backlog.
3. **"Live Shopfloor Status"** → `MachineStatusBoard` (~line 328).
4. `PlantMainOpsArea` (**Production Performance** `:52`, **Executive Insights** `:166`) + `PlantQualityDowntimeArea`
   (**Quality Intelligence** `:57`, **Downtime Intelligence** `:150`) (~line 340).
5. **Shift Handover Logs** card (~line 346).
6. `PlantOperationsArea` (**Machine Status** `:43`, **In Progress Orders** `:116`) (~line 425).
7. `PlantOpsFeed` drawer.

Backend: `ReportingService.getPlantHeadDashboard` (line 640) merged with the live snapshot via
`lib/plantHeadLiveMerge.ts`. It already returns `oeeTrend`, `productionVsPlan`, `qualityTrend`,
`downtimeDrivers`, `topDefects` — so most "Executive Insights / Downtime Analytics" data **already exists**.

### 5.2 Remove duplicate cards (present in Live Operations)

`LiveDashboard.tsx` (Live Operations, `/plant/live`) already shows: the KPI row (Running/Idle/Stoppages/
Active Orders), the **Machine Status Board**, and the **Live Queue**. The Command Center duplicates these:

- **"Live Shopfloor Status" `MachineStatusBoard`** (`PlantHeadDashboard.tsx` ~line 328) — duplicate of Live
  Operations' board. **Remove from the Command Center** (keep one board; the machine cards in
  `PlantOperationsArea` "Machine Status" `:43` also overlap — pick a single canonical placement).
- Any KPI/queue tile in the Command Center that repeats Live Operations' KPI row / Live Queue — remove.

**Where to edit:** delete the duplicated `<section>` blocks in `PlantHeadDashboard.tsx` and, if the
duplication is inside `PlantOperationsArea.tsx`, remove the overlapping subsection there. Confirm against
`LiveDashboard.tsx` before deleting so nothing unique is lost. **Then follow the "No patchwork" rule:** if a
board/component or its sub-block has no remaining consumer after removal, grep for references and delete the
component file + imports outright — do not hide it behind a flag or leave it dangling.

### 5.3 Improve layout — target order

Reorder the sections in `PlantHeadDashboard.tsx` to:

1. Machine Status (single canonical board)
2. In Progress Orders
3. Production Performance (`PlantMainOpsArea`)
4. Executive Insights (`PlantMainOpsArea` `:166`)
5. Downtime Analytics (`PlantQualityDowntimeArea` downtime block `:150`)
6. Additional Production Insights

Keep the KPI strip sticky at top. This is a JSX reordering task in one file plus possibly splitting
`PlantMainOpsArea`/`PlantQualityDowntimeArea` so the pieces can be placed independently.

### 5.4 Section-level requirements

- **Production Performance** (`PlantMainOpsArea.tsx:52`): every chart must bind to real payload data
  (`oeeTrend`, `productionVsPlan`, throughput) — verify no placeholder/static series remain.
- **Executive Insights** (`PlantMainOpsArea.tsx:166`): surface meaningful KPIs. Data already available or
  cheaply derivable from `getPlantHeadDashboard`: production efficiency/attainment (`productionVsPlan.attainmentPct`),
  planned vs actual (`productionVsPlan`), machine utilization (`ShiftAttributionService` / live cards),
  OEE trend, order-completion trend. Add shift comparison, operator productivity, top/lowest performing
  machines — these need small new aggregations (reuse `fetchShiftRows`/line-OEE helpers in `ReportingService`
  rather than new queries where possible).
- **Downtime Analytics** (`PlantQualityDowntimeArea.tsx:150`): `downtimeDrivers` (reasons + minutes +
  planned/unplanned) already exists in the payload. Add machine-wise and shift-wise breakdowns and duration
  analysis using the same `txn.stoppage` joins already in `getPlantHeadDashboard` (~line 745). Use charts
  where they improve readability.

### 5.5 Live Operations & orders display — cross-cutting fixes

- **No hardcoded values.** Audit `LiveDashboard.tsx`, `PlantKpiStrip.tsx`, and the `PlantOperationsArea`/
  `Plant*Area` components — every metric must come from the live snapshot or `getPlantHeadDashboard`.
  `mergePlantHeadWithLive` (`lib/plantHeadLiveMerge.ts`) is where live values overwrite reporting values;
  verify nothing is left as a literal.
- **Orders display — Mother Coil / Slit ID as primary.** `LiveDashboard.tsx` Live Queue renders **only
  `o.batchNumber`** (~line 141). The `LiveOrderRow` already carries `motherCoil`/`coilNo`/`slitId`, and the
  Machine-Head dashboard already uses the shared `OrderIdentityDisplay` component and `displayMotherCoilId`
  helper (`lib/sixHiOrderIdentity.ts`) for exactly this. **Where to edit:** replace the raw batch-number cell
  in `LiveDashboard.tsx` (and anywhere "recent/last order" shows a batch number) with `OrderIdentityDisplay`
  so Mother Coil + Slit ID are primary and batch is secondary. Confirm the live payload populates
  `motherCoil`/`slitId` (they flow from `ppc_batch.coil_no/slit_id` and `crm_order.coil_no/slit_id` in
  `LiveService`).
- **Operator information — real name, no blanks.** Live orders resolve the operator via
  `crm_order.logged_in_user_id → security.app_user.full_name` (`LiveService.ts:219/241`, and the completed
  route join). When `logged_in_user_id` is null the name is blank. **Where to edit:** in the operator-name
  resolution (`LiveService` order builders around lines 219–320 and 861–890, and the `/6hi/orders/completed`
  route), fall back to the **crew register** (`MachineCrewService.list(machineCode)` → `member_name` for the
  operator role, or whichever source currently stores the shift's operator assignment) when the
  logged-in-user link is absent. Never render a placeholder/blank operator.

---

## General requirements (apply to every task)

- **Audit before build.** Each item above names the file to open first. Confirm the endpoint/query exists
  before writing a new one. The genuinely-new backend pieces in this spec are exactly two: the **stoppage
  history** read path (Task 2.5) and the **shift-review aggregation** endpoint (Task 4.3). Everything else is
  reconnection, re-scoping, or a math fix.
- **Reuse APIs / joins.** Prefer extending `getMachineHeadDashboard` / `getPlantHeadDashboard` /
  `SixHiService.getShiftSummary` / `ShiftAttributionService` over new services. Reuse `OrderIdentityDisplay`,
  `displayMotherCoilId`, and the existing stoppage join shapes.
- **Kill hardcoded values.** Especially in `LiveDashboard.tsx`, `PlantKpiStrip.tsx`, and the `Plant*Area`
  components.
- **Consistent shift scoping.** Multiple bugs (Completed 2.2, Order-Hold 2.4, date filter) share one root:
  lists pinned to *today's active `shift_log_id`* instead of the *selected date's* shift log. Fix per
  `HANDOVER_AND_DATEFILTER_INVESTIGATION.md` Issue 3 — either send `shiftLogId` only when the selected date
  is today, or resolve `shiftLogId` from the selected date server-side.
- **All three mills, everywhere.** Every list and metric in this spec — Completed (2.2), Production (2.3),
  Stoppages (2.5), Shift Summary (Task 3), Shift Review (Task 4), and the Plant Command Center per-machine
  breakdowns — must resolve correctly for **6HI, 4HI, and 2HI**. The system uses one shared `ROLLING` CRM
  process for all three (machines split by `machine_code` + `sub_process`; 2HI is skin-pass only). Never rely
  on a hardcoded process id or a `'6HI'` machine default; always drive queries from the machine head's
  `machineFilter`. Verify each surface once per mill.
- **UI changes only where they add clarity** — do not reduce information density of working panels.

## Required implementation report (produce at the end)

Deliver a short report with these sections:

1. **Existing working features** — confirmed live and correct (e.g. Orders queue, Completed endpoint,
   Handover overview, downtime drivers payload).
2. **Broken / mis-scoped features** — with root cause (e.g. Stoppages active-only filter; Target MT wrong
   source; In-Progress MT resolving to 0; date-pinning).
3. **Missing endpoints** — the two new read paths (stoppage history; shift-review bundle) and any others
   found during audit.
4. **Newly implemented functionality** — per file, what/where.
5. **Deleted / consolidated artifacts** — every file, component, endpoint, query, or client-side re-computation
   removed, with the reference-grep that proved it dead. (Enforces the "No patchwork" rule.)
6. **Assumptions made** — e.g. crew-register field used for operator fallback; which utilization window the
   Overview should display; whether Shift Review should list all completed shifts or only submitted ones.

---

## Appendix — quick file/endpoint index

**Client**
- `pages/live/MachineHeadDashboard.tsx` — Machine Head dashboard (all tabs); tab union `:24`, tab bar
  `~:291`, shift summary cells `~:372`, orders `~:424`, production `~:477`, stoppages `~:546`, order-hold
  `~:197`, completed `~:217`.
- `pages/live/LiveDashboard.tsx` — Live Operations (KPI row, machine board, live queue `~:141`).
- `pages/reports/PlantHeadDashboard.tsx` — Plant Command Center (sections `~:328`–`:425`).
- `pages/plant/PlantShiftReviewPage.tsx` — Shift Review (approval queue → extend).
- `components/plant-head/PlantMainOpsArea.tsx` (Production Performance `:52`, Executive Insights `:166`),
  `PlantQualityDowntimeArea.tsx` (Quality `:57`, Downtime `:150`), `PlantOperationsArea.tsx` (Machine Status
  `:43`, In Progress Orders `:116`), `PlantKpiStrip.tsx`, `PlantOpsFeed.tsx`.
- `components/orders/OrderIdentityDisplay.tsx`, `lib/sixHiOrderIdentity.ts` — mother-coil/slit identity.
- `lib/liveService.ts`, `lib/reportingService.ts` (`:159` command center), `lib/plantHeadLiveMerge.ts`.

**Server**
- `services/LiveService.ts` — `getMachineHeadDashboard` `:1006`, `getShiftCompletedProductionMt` `:958`,
  shiftSummary build `:1230`, stoppage `end_at IS NULL` filter `~:1170`, completed `.limit(10)` `~:1060`.
- `services/SixHiService.ts` — `getShiftSummary` `~:2250`, `completedProdMt`/`totalProdMt` `:2292`/`:2306`,
  decoupling comments `:330`/`:466`.
- `services/sixHi/SixHiShiftService.ts`, `services/ShiftAttributionService.ts`.
- `services/ReportingService.ts` — `getPlantHeadDashboard` `:640` (oeeTrend, productionVsPlan, qualityTrend,
  downtimeDrivers, topDefects).
- `services/MachineHandoverService.ts` (`ensureActiveSession` `:942`, `acceptHandover` `:721`,
  `getHandoverOverview`), `services/ShiftDetectionService.ts` (`isSessionDateLive` `:20`,
  `findActiveSession` `:155`, `getCurrentShift` `:232`), `jobs/ShiftBoundaryScheduler.ts` (no-op).
- `services/MachineCrewService.ts` — crew register (operator fallback).
- `services/StoppageService.ts` (only `create`), `routes/stoppageRoutes.ts` (only `POST /`) — no history path yet.
- `routes/sixHiRoutes.ts` — `/orders/completed` `:387`, `/queue` `:316`.
- `routes/reportRoutes.ts` — `/plant-head` `:86`, `/plant-head/backlog` `:77`, `/plant-head/drilldown` `:38`.
- `routes/shiftLogRoutes.ts` — shift-log list/approve/reject/reopen (Shift Review actions).

**Prior investigation docs (repo root) — read for Task 1**
- `ZEDRAL_BUG_STALE_SHIFT_SESSION_SPEC.md`, `HANDOVER_AND_DATEFILTER_INVESTIGATION.md`.
