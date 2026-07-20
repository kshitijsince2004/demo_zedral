# Zedral (hsl_zedral-main) — Iteration & Optimization Spec

**Scope:** 6 tasks. All paths are relative to `hsl_zedral-main/`.
Monorepo layout: client = `packages/client`, server = `packages/server`, shared types = `packages/shared-validation`.

**How to use this doc:** each task lists *what* to change, *where* (exact file + function/line anchor), and acceptance criteria. Hand each task section to the coding agent as a self-contained prompt. Do Tasks 1–4 as code changes; Task 5 is an audit-first task (analyse, then iterate).

---

## Task 1 — "Move order back to Preparing/Production" from Order Hold

### Context (verified in code)
- The **Order Hold** tab in the Machine Head dashboard is the `rejected` tab (labelled `Order Hold`) in `packages/client/src/pages/live/MachineHeadDashboard.tsx` (see `tabLabel('Order Hold', …)` ~line 293).
- "On hold" is modelled as **`crm_order.status = 'REJECTED'`** plus a row in **`txn.order_rejection`**. It is created by `SixHiService.rejectOrder()` (`packages/server/src/services/SixHiService.ts` ~line 1827), which sets status `REJECTED`, stamps `prod_end_at`, ends any open stoppage, and records `ORDER_REJECTED` machine-state events.
- The side panel `packages/client/src/components/machinehead/MachineHeadOrderSidePanel.tsx` already renders the **Delete Order** button in its footer (`<div className="shrink-0 p-4 border-t …">`). Delete calls `DELETE /6hi/orders/:batchNo` → `SixHiService.deleteOrder()`.

### Changes

**1a. Backend — new reinstate endpoint**
- `packages/server/src/routes/sixHiRoutes.ts`: add, next to the existing reject route (`router.post('/orders/:batchNo/reject', …)` ~line 715):
  ```
  router.post('/orders/:batchNo/reinstate', requireSixHi('WRITE'), async (req, res) => { … })
  ```
  Body: optional `{ target?: 'PREPARING' | 'PENDING' }` (default `PREPARING`). Calls `SixHiExecutionService.reinstateOrder(req.params.batchNo, req.user.id, target)`. Mirror error handling of the reject route.

**1b. Backend — new service method (inverse of `rejectOrder`)**
- `packages/server/src/services/SixHiService.ts`: add `static async reinstateOrder(batchNumber, userId, target = 'PREPARING')`:
  1. Resolve `order_id` via `planning.ppc_batch` → `txn.crm_order` (reuse the lookup pattern from `deleteOrder`, ~line 1772).
  2. Guard: only proceed if `crm_order.status === 'REJECTED'` (throw `Order is not on hold` otherwise).
  3. Delete the latest `txn.order_rejection` row for `order_id` (or soft-resolve if an audit trail is required — confirm preference; default = hard delete to match `deleteOrder` semantics).
  4. `updateTable('txn.crm_order').set({ status: target, prod_end_at: null, updated_at: new Date() })`.
  5. Reset coil back to planned if needed: `coil.coil.status = 'PLANNED'` (mirror the coil reset in `deleteOrder`).
  6. Record machine-state events on the batch's `machine_code`: `ORDER_REINSTATED` (new event type) then `IDLE_STARTED`, mirroring the `rejectOrder` event chain. If adding a new event type is undesirable, reuse `IDLE_STARTED` only and log a remark.
  7. Return `this.getOrder(batchNumber, userId)`.
- Keep it transactional / same style as `rejectOrder` (no partial writes).

**1c. Frontend — button in the side panel**
- `packages/client/src/components/machinehead/MachineHeadOrderSidePanel.tsx`:
  - Extend props: add `onReinstate?: () => void; reinstateBusy?: boolean;`.
  - Add helper `isReinstatable(detail, row)` → `true` only when status is `REJECTED` (on hold).
  - In the footer, **below** the existing Delete Order `ZButton`, render a new `ZButton variant="outline"` labelled **"Move back to Preparing"** (icon `RotateCcw` from `lucide-react`), guarded by `isReinstatable(...) && onReinstate`, `disabled={reinstateBusy}`.

**1d. Frontend — wire the handler**
- `packages/client/src/pages/live/MachineHeadDashboard.tsx`:
  - Add `const [reinstateBusy, setReinstateBusy] = useState(false)` next to `deleteBusy` (~line 137).
  - Add `handleReinstate` mirroring `handleDelete` (~line 317): confirm dialog → `apiClient.post('/6hi/orders/${encodeURIComponent(selectedOrder.batchNumber)}/reinstate', {})` → on success refresh dashboard + clear selection.
  - Pass `onReinstate` + `reinstateBusy` to **both** `MachineHeadOrderSidePanel` render sites (~lines 929 and 941).

### Acceptance
- A held (REJECTED) order shows both "Delete Order" and "Move back to Preparing"; clicking the latter returns it to the Running & Preparing queue, clears the hold reason, and the order disappears from the Order Hold tab. Non-held orders never show the button.

---

## Task 2 — Shift Summary export + rename "DPR Export" menu → "Export"

### Context (verified in code)
- Export is a pluggable **report-definition registry**: `packages/server/src/export/definitions/index.ts` maps `ExportType → ReportDefinition`. Types live in `packages/server/src/export/types/index.ts` (`export type ExportType = 'DPR' | 'LINE_LOG' | 'COIL_TRACE' | 'RAW' | 'REJECTED_ORDERS'`).
- `RejectedOrdersReport.ts` is the cleanest template for a new date/shift/machine-scoped report.
- Jobs run through `ExportJobService.createAndRun` (`server/src/routes/exportRoutes.ts`), rendered by `XlsxRenderer` / `PdfRenderer` / `CsvRenderer`.
- Client export UI: `packages/client/src/components/export/DprExportPanel.tsx`, used by `pages/reports/PlantDprExport.tsx` and `pages/reports/MachineDprExport.tsx`.
- Shift production data already exists: `MachineHandoverService.buildOutgoingPreview` builds a `shiftProductionSummary`; `ReportingService.getMachineHandoverSummary(shiftLogId)` (via `GET /reports/handover`) and `SixHiShiftService` aggregate per-shift production. Reuse these — do **not** rebuild aggregation.

### Changes

**2a. Backend — new `SHIFT_SUMMARY` export type**
- `packages/server/src/export/types/index.ts`: add `'SHIFT_SUMMARY'` to `ExportType`.
- New file `packages/server/src/export/definitions/ShiftSummaryReport.ts` modelled on `RejectedOrdersReport.ts`:
  - Scope: `{ date | dateFrom/dateTo, shiftCode?, machineCodes? }` (parse both camel + snake like the template).
  - `execute()` assembles the shift summary: production report figures (produced MT, orders completed/held, yield, downtime/stoppage minutes, defect tallies, crew/handover notes). Source the numbers from the existing shift aggregators (`SixHiShiftService`, `ReportingService.getMachineHandoverSummary`, `ProductionMetricsService`) rather than new SQL.
  - `supportedFormats(): ['XLSX', 'PDF', 'CSV']`.
- Register in `packages/server/src/export/definitions/index.ts` `REGISTRY`.
- Confirm authz: `exportRoutes.ts` already restricts to `PLANT_HEAD, MACHINE_HEAD, ADMIN`; keep machine-scoping consistent with `RejectedOrdersReport`.

**2b. Frontend — Shift Summary export UI**
- Add a `ShiftSummaryExportPanel.tsx` under `packages/client/src/components/export/` mirroring `DprExportPanel.tsx`, but with **date + shift + machine** selectors (reuse the date/shift `<select>` pattern already in `MachineHeadDashboard.tsx` export controls). It calls `reportingService.createExportJob({ type: 'SHIFT_SUMMARY', format, scope })`.
- Surface it in **both** DPR export pages (`PlantDprExport.tsx`, `MachineDprExport.tsx`): convert each page into a small **tabbed Export view** — tab 1 "DPR" (existing `DprExportPanel`), tab 2 "Shift Summary" (new panel). This preserves the "all exports in one menu" future scope.

**2c. Rename the side-panel menu label → "Export"**
- `packages/client/src/components/layout/UnifiedShell.tsx` (~line 53): change `label: 'DPR Export'` → `label: 'Export'`. Keep `id`, `path` (`/plant/dpr-export`) and `match` unchanged to avoid route churn (or optionally add `/plant/exports` — see below).
- `packages/client/src/components/layout/machinehead/MachineHeadNav.tsx` (~line 36): change `label: 'DPR Export'` → `label: 'Export'`.
- Routes in `packages/client/src/App.tsx` (lines 138, 152) can stay as-is; DPR becomes a tab inside the page, so the URL still lands users on the Export view. (Optional cleanup: rename route paths to `/plant/exports` and `/machine-head/exports` with redirects from the old `dpr-export` paths, matching the existing redirect pattern at App.tsx lines 142–144.)

### Acceptance
- Side menu reads **Export** for both Plant Head and Machine Head. The Export page has DPR and Shift Summary tabs. Shift Summary produces a downloadable file (XLSX/PDF) containing the shift's production report + order lists (completed / held / etc.) for the chosen date+shift+machine.

---

## Task 3 — Operator-only login in the APK / Android app

### Context (verified in code)
- `packages/client/src/pages/Login.tsx` has a mode toggle: **Operator (badge + PIN)** and **Staff (email/password via SuperTokens `EmailPassword`)**.
- The operator APK is a **separate build** (`build:operator`, `vite.operator.config.ts`, `npm run android:sync`) whose entry is `packages/client/src/operator/OperatorApp.tsx`, which renders the **same** `Login` component at `<Route path="/login" element={<Login />} />` (line 48).
- Native detection helper already exists: `isNative()` in `packages/client/src/operator/native/init.ts` (Capacitor).
- The desktop web build must **keep** staff email login (Machine Head / Plant Head sign in that way).

### Changes
- `packages/client/src/pages/Login.tsx`:
  - Add prop `operatorOnly?: boolean`.
  - When `operatorOnly` is true: force `mode = 'operator'`, **do not render** the mode-toggle buttons ("Operator · Staff" row) and **do not render** the staff `<form>` / email+password fields. Also hide the staff dev-credential hints from the `import.meta.env.DEV` block.
- `packages/client/src/operator/OperatorApp.tsx` (line 48): pass the flag → `<Login operatorOnly />`.
- Optional hardening: also default `operatorOnly` to `isNative()` so any native shell can never reach staff login even if reused elsewhere.
- Do **not** change the web `App.tsx` login route — desktop staff login stays intact.

### Acceptance
- APK/tablet build shows **only** Badge + PIN entry; no email/password field, no Staff toggle. Desktop web still offers both operator and staff login.

---

## Task 4 — Shift Review System: drop approval workflow, show completed shifts with filters

### Context (verified in code)
- Current page `packages/client/src/pages/plant/PlantShiftReviewPage.tsx` is an **approval queue**: loads `GET /shift-logs?state=SUBMITTED` and offers **Approve / Reject / Reopen**. It's shared by **both** the Plant route and the Machine Head route (`App.tsx` line 150 uses `PlantShiftReviewPage` for `/machine-head/shift-review`).
- Backend state machine: `ShiftLogService` (`packages/server/src/services/shiftLogService.ts`) with states `DRAFT → SUBMITTED → APPROVED`, plus `REOPENED`, `reject → DRAFT`. Endpoints `PUT /shift-logs/:id/{approve,reject,reopen}` in `packages/server/src/routes/shiftLogRoutes.ts` (~lines 328–356), guarded by `requireRole([MACHINE_HEAD, PLANT_HEAD])`.
- Read endpoints already exist: `GET /shift-logs` (filter by `state`), `GET /shift-logs/:id`, `GET /shift-logs/:id/handover/summary`, `GET /reports/handover?shiftLogId=…`.

### Decisions to confirm before coding
1. **Terminal state definition:** after removing approval, is a "completed shift" a shift log in `SUBMITTED` state, or should `SUBMITTED` be renamed/repurposed to `COMPLETED`? Recommend: treat **`SUBMITTED` (and legacy `APPROVED`)** as "completed" for the new list, and stop using approve/reject/reopen. (Avoids a data migration.)
2. **Keep endpoints for audit or delete?** Recommend leaving `approve/reject/reopen` service+routes in place but **unreferenced** by the UI in this pass, then removing in a later cleanup once no client calls them.

### Changes

**4a. Frontend — rewrite the review page as a read-only completed-shifts browser**
- Rewrite `packages/client/src/pages/plant/PlantShiftReviewPage.tsx` (or split into a new `CompletedShiftsPage.tsx` referenced by both routes):
  - Remove `approve`, `reject`, `reopen`, `reopen`/`rejectNote` state and all action buttons.
  - Load completed shifts (e.g. `GET /shift-logs?state=SUBMITTED`, plus `APPROVED` for legacy rows — or a new `state=COMPLETED` if 4a-decision picks that).
  - Add **filters**: date (or date range), shift (A/B/C), machine (from `useAuthStore().machineAccess`; MH scoped to assigned machines, Plant sees all). Keep the existing MH machine-scoping filter logic.
  - Render a list/table; **on row click** open a detail drawer/modal showing the full shift detail (reuse `GET /shift-logs/:id` + `/reports/handover?shiftLogId=…` for production report, orders, overrides, crew/handover notes).
- Update the page header text (currently references "supervisor approval workflows") to describe a read-only completed-shift archive.

**4b. Backend — support filtered list + detail (mostly reuse)**
- Confirm `GET /shift-logs` accepts `state`, and add optional `shiftDate`/`shiftCode`/`machine` query filters if not present (extend the query at `shiftLogRoutes.ts` ~line 51). If adding filters server-side is heavy, filter client-side initially (dataset is small).
- Detail: reuse `GET /shift-logs/:id` and `GET /reports/handover`. No new aggregation needed.

**4c. Disconnect the old system**
- Remove UI calls to `/shift-logs/:id/{approve,reject,reopen}`. Leave server routes/service intact but unused for now (flag for later removal). Update `MachineHeadNav.tsx` / any labels if "Shift Review" wording should change (optional).

### Acceptance
- Both Plant Head and Machine Head "Shift Review" show **all completed shifts** with working date/shift/machine filters and a click-through detail view. No Approve/Reject/Reopen actions remain in the UI.

---

## Task 5 — Handover & shift-logic audit (analyse first, then iterate)

**This is an investigation task — produce findings before changing code.** There is existing history to build on: `HANDOVER_AND_DATEFILTER_INVESTIGATION.md`, `ZEDRAL_BUG_STALE_SHIFT_SESSION_SPEC.md`, `fix_shift_attribution.sql` / `_v2.sql`, and `MH_SHIFT_REVIEW_AND_COMBINED_ORDER_SPEC.md` (repo root).

### What to audit (files verified present)
- **Shift detection core:** `packages/server/src/services/ShiftDetectionService.ts` — `getCurrentShift()`, session pinning to `txn.machine_shift_session` (ACTIVE session), `isSessionLive`, `closeStaleOperatorSessions()`, `shiftEndDateTime()`, window start/end, `DetectedShift`.
- **Handover flow:** `packages/server/src/services/MachineHandoverService.ts` — `resolveOutgoingShift()`, `buildOutgoingPreview()`, `createOutgoingHandover()`, draft/pending/accept lifecycle; routes in `packages/server/src/routes/machineHandoverRoutes.ts`.
- **Shift aggregation / attribution:** `packages/server/src/services/sixHi/SixHiShiftService.ts`, and the shift-attribution rule (`reattributeOrderToActiveShift`, `crm6_order.shift_log_id`) used in `SixHiService.rejectOrder`/production start.
- **Next-shift math:** `ShiftLogService.getNextShift()`.
- **Client display:** `packages/client/src/components/live/HandoverOverviewPanel.tsx`, `HandoverAcceptPage.tsx`, and every place shift is shown (`getPlantClockParts`, `formatPlantDateTime`, `resolveShiftFromClock` in `shared-validation`).

### Questions the audit must answer
1. Does the **displayed shift** everywhere match the **pinned session shift** (not just wall-clock)? Check dashboards, handover panels, exports, and the new completed-shifts list from Task 4.
2. Are **stale sessions** reliably closed at shift boundaries (`closeStaleOperatorSessions`)? Any window where an order can attribute to the wrong shift?
3. Does **handover close** the correct outgoing session and open the correct incoming one at A→B→C→A + date rollover (night shift crossing midnight)?
4. Is **shift attribution** on production/hold/complete consistent (`shift_log_id` vs PPC `plan_date`)? Cross-check against `fix_shift_attribution_v2.sql` intent.
5. Do **exports and reports** filter by the same shift definition the UI shows?

### Deliverable for Task 5
- A short findings doc: each issue = symptom, root-cause file/function, and proposed fix. **Do not change logic yet** — review findings together, then spec the iteration.

---

## Task 6 — PPC Import: stop orders silently "disappearing"

**Source:** IDE trace (Ayush Pal). I re-verified every claim against the current `hsl_zedral-main` code — all confirmed. Line numbers below are what's in the repo now.

### Two import paths (confirmed)
- **XLSX rolling plan** (Admin → PPC Import preview/commit): `PpcRollingImportPanel` → `PPCImportService.previewRollingXlsx` → `commitRollingSession`. Calls `ensureOrder()` on newly-inserted rows.
- **CSV import**: `PPCImportService.importFromCsvText` (direct upload, no preview). **Does not** call `ensureOrder()`.
Both write to `planning.ppc_batch`.

### Verified findings (symptom → root cause → file)

| # | Finding | Root cause (verified) | Location |
|---|---------|----------------------|----------|
| 1 | **Silent skip** — empty batch number in XLSX vanishes with no error (CSV records a row error instead) | `if (!batchNumber) continue;` — no error pushed | `server/src/utils/rollingPlanXlsxParser.ts:285` |
| 2 | **Width contradiction** — parser defaults `widthMm` to `0`, but schema requires `> 0`, so the row fails validation later with a confusing error | parser: `widthMm: num(raw.widthMm) ?? 0` vs schema `widthMm: z.number().positive()` | parser `:340`; `shared-validation/src/rules/fieldRules.ts` (`.positive()`) |
| 3 | **Blocked rows not auto-selected** → excluded from commit | `DANGEROUS_STATUSES = ['in-production','completed','duplicate-in-file','allocation-protected']`; `isRowImportable` also requires `errors.length === 0` | `client/src/components/admin/PpcRollingImportPanel.tsx:35-40` |
| 4 | **Pending identity merge** — two different batch numbers with the same coil/spec collapse into **one** DB batch (looks like fewer orders imported) | `findMatchingPendingBatch` matches on coil + sub_process + a full **identity key** (coil, slit, customer, grade, width, thickness, weight, sub-process, machine, destination, finish, reroll, SAP order) — **not** batch_number | `server/src/services/PPCImportService.ts:337-357` |
| 5 | **Duplicate detection is batch-number-only** — so the merge in #4 is never flagged | `seenInFile` keyed by `row.batchNumber` only | `PPCImportService.ts:817-832` |
| 6 | **Production-safety skips** on commit (allocated / in-progress / completed) | `throw new ProductionSafetyError(...)` → counted as `skippedAllocated/Production/Completed` | `PPCImportService.ts:522,527,1006,1011` |
| 7 | **Imported but not in the queue** — lands under **Backlog**, not the main pending pool, depending on plan_date vs operational date | pending pool excludes backlog plan dates | `server/src/services/SixHiService.ts` (`backlogPlanFilter`, ~line 388) |
| 8 | **CSV import creates no CRM order** — batch exists in `ppc_batch` but `txn.crm_order` doesn't until allocation/start | XLSX path calls `ensureOrder()` on insert (`:876`); CSV path only does `loaded++/updated++` (`:632`) | `PPCImportService.ts:632` vs `:876` |

### Fixes (ranked by value)

**6a. Kill the silent skip (Finding 1) — high value, low risk**
- `server/src/utils/rollingPlanXlsxParser.ts:285`: instead of `continue` on empty batch number, **push a row error** and keep the row in the preview (mirror CSV's `ppcCsvParser` behaviour). The row then shows in the preview table with an "Empty batch number" error, so it can't be silently lost. Only skip truly-blank lines (all cells empty).

**6b. Fix width handling (Finding 2) — high value, low risk**
- Make the two layers agree. Preferred: at parse time treat missing/zero width as a **row error** ("Width required / must be > 0") rather than defaulting to `0` (`rollingPlanXlsxParser.ts:340`). This surfaces the real problem in the preview Errors column instead of a downstream `positive()` schema failure. (Do **not** loosen the schema — width must stay positive.)

**6c. Surface identity merges in the preview (Findings 4 + 5) — highest value for "missing orders"**
- In `previewRollingXlsx` (server), for each row compute `pendingMergeIdentityKey(row)` and check `findMatchingPendingBatch`; when a row's batch number is **new** but it will merge into an existing pending batch with a **different** batch number, tag it with a new preview status e.g. `will-merge` (or add a `mergeTargetBatchNumber` field on the preview row).
- Client `PpcRollingImportPanel.tsx`: render that status with a visible warning ("Will update existing batch `<X>` — different batch number, same coil/spec") so the user consciously decides. Keep it importable but **not** silently auto-merged without notice.
- Also extend in-file duplicate detection (`:817`) to optionally warn (not hard-fail) when two rows share an **identity key** but different batch numbers.

**6d. Create CRM orders on CSV import + safe updates (Finding 8) — medium value**
- In `importFromCsvText`, after a successful `inserted` result (`:632`), call `SixHiConfigService.ensureOrder(row.batch_number, userId)` exactly as the XLSX path does at `:876`.
- Optionally, on `updated` where no `txn.crm_order` exists yet, also call `ensureOrder` so both paths converge.

**6e. Make skips/merges legible in the commit result (Findings 6 + 7) — low risk**
- The commit already returns `loaded / updated / skippedAllocated / skippedProduction / skippedCompleted`. Add `merged` (count from 6c) and an explicit per-row reason list, and show these in the commit-result UI so "N rows in Excel → M orders" is fully accounted for.
- For Finding 7 (backlog visibility), no logic change needed — document it and confirm **Order Assignment** (`/6hi/order-assignment`) lists all unallocated batches regardless of plan_date so users can always find an imported-but-backlogged batch.

### Diagnosis playbook (add to admin docs)
1. Preview XLSX → compare Excel row count vs preview table count. Gap ⇒ empty batch numbers (Finding 1) or wrong sheet tab (`ROLLING` vs `SKIN_PASS`).
2. Read the summary line: `X importable · Y blocked · Z selected`.
3. After commit read `loaded / updated / merged / skipped*` + the error list.
4. Search missing batch numbers in **Order Assignment** — if present there but not in the machine queue ⇒ backlog/plan-date visibility, not a failed import (Finding 7).
5. If two batch numbers map to one coil/spec ⇒ pending merge (Finding 4): query `planning.ppc_batch` by `coil_no`.

### Acceptance
- No XLSX row disappears without appearing in the preview (as importable or errored). Width/zero problems show as clear preview errors. Rows that will merge into an existing pending batch are flagged before commit. CSV import produces CRM orders. Commit result fully reconciles input rows to `loaded + updated + merged + skipped + errored`.

---

## Cross-cutting: verification checklist (run per task)
- Type-check + build both targets: `npm run build` and `npm run build:operator` (+ `npm run check:operator-bundle` for Task 3).
- Server tests: `packages/server/tests` (export, integration, auth) — add cases for `reinstateOrder` (Task 1) and `ShiftSummaryReport` (Task 2).
- E2E smoke where relevant: `e2e/tests`.
- Manual: Task 1 hold→reinstate round-trip; Task 2 shift-summary file opens with correct figures; Task 3 APK shows operator-only; Task 4 filters + detail drawer.
