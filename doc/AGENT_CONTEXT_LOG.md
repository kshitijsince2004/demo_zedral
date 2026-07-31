# Agent Context Log

Living register of integration/branch context and agent changes. **Update this file at the end of every agent prompt** (append a dated entry). Do not rewrite history ? append only.

---

## Repo snapshot (baseline)

| Item | Value |
| --- | --- |
| Repo | `hsl_zedral` (local clone in workspace) |
| Integration branch | `integration-main-feature` (from latest `main` + `hsl_zedral_CTL/RW/Q`) |
| Backup of feature | `backup-hsl_zedral_CTL_RW_Q` |
| Do not touch | `main` until verified |
| Stack | monorepo npm workspaces ? `@m1/client`, `@m1/server`, `@m1/shared-validation` |

### Already present before CRS slice

- Process stations: HRS / PKL / ANN / RWD / **CRS** / CTL via `processConfig` + `ProcessStationService`
- CRS stub UI: `CrsQualityForm` (quality-first, A?D slots width-only)
- Persist: `ProductionService.saveCrs` ? `txn.prod_crs` + `txn.prod_crs_slit`
- Journey: `JourneyAdvanceConsumer` already advances CRS / spawns children
- QSS: `SpecFetchService` / `SpecResolverService` / `validateCrsQuality`
- Plan doc: `doc/ZEDRAL_CRS_OPERATOR_IMPLEMENTATION_PLAN.md`

---

## Entries

### 2026-07-30 ? branch integration (prior session)

- Created `backup-hsl_zedral_CTL_RW_Q`, branch `integration-main-feature`, merged feature into main.
- Conflicts resolved (auth, audit, migrations, parsers, dist artifacts). Build green.
- DB-backed tests needed Docker + migrations; `_qss_seed_params.json` breaks `node-pg-migrate` if left in migrations dir as a ?migration?.

### 2026-07-30 ? CRS first vertical slice (this prompt)

**Plan:** `doc/ZEDRAL_CRS_OPERATOR_IMPLEMENTATION_PLAN.md` · ponytail **full** · first slice only: capture fan-out + persist + per-line journey.

**Shipped**

1. Migration `1943000000000_crs_slit_line_fields.js` ? per-line quality/weight/hold/for-CTL/route on `prod_crs_slit`; pass `input_wt_mt` / `scrap_mt` / `setting_count` on `prod_crs`.
2. Shared types/schemas ? `CRSSlitSlot` + `crsSlitSlotSchema` + `crsMassBalanceWarn`.
3. `CrsQualityForm` ? HRS-style per-line grid (width/thk/wt/reject/hold/for-CTL); pass totals derived.
4. `ProductionService.saveCrs` ? writes new columns.
5. `JourneyAdvanceConsumer` ? skip `hold_flag` lines; per-line `for_ctl_flag` / `route_code` ? LE vs PKG; pass-level HOLD only when no slits.
6. `db-types` updated for new columns.
7. Test: `packages/shared-validation/tests/crsMassBalance.test.ts`.

**Skipped (add when needed)**

- `master.machine_spec` CRUD + eligibility (§3/§7)
- Process-agnostic assignment board
- Pass queue grouping by mother coil
- Crew capture, stoppage seed polish, shift dashboard metrics
- Spec snapshot on pass / full QSS wiring on load
- Retire `GenericCapturePage` for CRS (already routed via process body)

**Open plant decisions:** Slit No semantics; mass-balance/trim tolerances; setting-count derivation.

### 2026-07-30 ? CRS plan §11 complete (this prompt)

- **Goal:** Finish remaining CRS operator backlog (machine_spec, assignment, metrics, retire GenericCapture, tests).
- **Touched:**
  - `packages/server/migrations/1944000000000_crs_machine_spec_and_seeds.js` (applied)
  - `MachineSpecService.ts`, `machineEligibility.ts`, `crsSlitRoute.ts`, `machineRoutes.ts`, `processStationRoutes.ts`
  - `ProcessStationService.ts` (queue orderLines, shift metrics, assignment)
  - `CrsQualityForm.tsx`, `ProcessHub.tsx`, `GenericCapturePage.tsx` (CRS ? `/`)
  - `MachineSpecAdmin.tsx`, `CrsAssignmentPage.tsx`, `App.tsx`, `MachineHeadNav.tsx`, `MasterDataAdmin.tsx`
  - Tests: `machineEligibility.unit.test.ts`, `crsSlitRoute.unit.test.ts`, `crsWidthCombination.test.ts`
- **Decisions / skipped:** Setting-count stays operator/pass field (not auto knife-diff). Soft dim HOLD remains operator checkbox (spec fetch warns via width combo only). Crew via existing CaptureWorkspace `/crew` panel; `crew_ref` optional on pass.
- **Routes:** `/admin/machine-specs`, `/crs/order-assignment`; `/stations/crs/*` registered before `/:process/*`.
- **Verify:** migrate 194400 OK; unit tests green; `@m1/shared-validation` + server + client builds green.
- **Follow-ups:** Plant-confirm Slit No; optional CRM crew retrofit; backbone integration test for mixed-route 3-line fan-out if desired.

### 2026-07-30 ? HRS plan §11 (ponytail full)

- **Goal:** Implement `doc/ZEDRAL_HRS_OPERATOR_IMPLEMENTATION_PLAN.md` backlog (dynamic slit fan-out, ID/Centre/OD, birth+journey, retire GenericCapture).
- **Touched:**
  - `1945000000000_hrs_slit_fanout_fields.js` (applied) ? pass + slit columns; HRS-01..13 stoppage; HRS-01..16 defects
  - `hrsSchema` / `HRSSlitSlotSchema` / `processes.ts` ? dynamic `slot`, planned?actual, thk ID/Centre/OD
  - `ProductionService.saveHrs`, `JourneyAdvanceConsumer` (HOLD mints, no journey; HRS uses line `route_raw`)
  - `ProcessStationService` HRS orderLines + combination + `getHrsShiftMetrics`
  - `HrsSlitBuilder.tsx` rewrite; `GenericCapturePage` redirects HRS; ProcessHub metrics
  - Tests: `hrsFanOut.test.ts`, `hrsRouteFlags.unit.test.ts`; property tests updated for dynamic slots
- **Decisions / skipped:** Auto setting-count (operator field only); ad-hoc substitution paths deferred; UI slot cap 12; `weight_mt` = ? produced; `thk_mm` no longer written.
- **Verify:** migrate 194500 OK; shared/server/client build green; targeted tests green.

### 2026-07-30 ? PKL plan §12 (ponytail full)

- **Goal:** Implement `doc/ZEDRAL_PKL_OPERATOR_IMPLEMENTATION_PLAN.md`.
- **Touched:**
  - `1946000000000_pkl_coil_chart_masters.js` (applied) ? coil cols, `pkl_spec_limit`, `pkl_chart_config`, PKL stoppage/defect seeds
  - `pklSchema` / `PKLEntry` / `savePkl` ? repeats, wp, endFilling, ht, mother/slit, denorm
  - Chart: independent `POST /stations/pkl/chart` with line singletons on tank 1; full grid + advisory highlights
  - Masters CRUD: `/admin/pkl-specs`; metrics on ProcessHub; GenericCapture retires PKL
  - Tests: `pklCoilFields.test.ts`, `pklSpecAdvisory.unit.test.ts`
- **Decisions / skipped:** Chart singletons on `tank_no=1` (no split tables); HT free-text; weight/PPC soft 2% warn; defect tally by code deferred.
- **Verify:** migrate 194600 OK; builds green; tests green.

### 2026-07-30 ? ANN operator (stages / readings / fan-out)

- **Goal:** Implement `doc/ZEDRAL_ANN_OPERATOR_IMPLEMENTATION_PLAN.md` · ponytail **full**.
- **Touched:**
  - `1947000000000_ann_stages_readings_masters.js` (applied) ? charge/coil cols; stage/reading/stoppage txns; WI masters (`ann_spec_limit`, base, stage, hood, stoppage, reading_config)
  - `ProcessStationService` ? seed 10 stages on create; advance/skip; readings; stoppages; DONE fan-out filters `disposition=ADVANCE`; totals ? active + idle gaps
  - Routes: `/stations/ann/{charges,bases,spec-limits}` actions
  - Client: `AnnChargeBoard` (base+batch), `AnnChargePage` (stages/readings/roster disposition), `/admin/ann-specs`; GenericCapture retires ANN
  - Tests: `annDoneFanOut.unit.test.ts`, `annStageInvariant.unit.test.ts`
- **Decisions / skipped:** Separate clubbing/cooling/purge/fuel master tables ? one `ann_spec_limit`; O? hard-gate deferred (advisory); reading soft-reminder UI deferred; full clubbing warnings on builder deferred.
- **Verify:** migrate 194700 OK; server/client tsc green; ANN unit tests green.

### 2026-07-30 ? Restore seed login details + seed profiles

- **Goal:** Show seed credentials on login (DEV) and make seed users work locally.
- **Touched:** `packages/client/src/pages/Login.tsx`, `packages/server/scripts/seed-pilot-users.mjs`, `.env`, `.env.example`
- **Decisions / skipped:** Restored operator badge/PIN hint; fixed missing comma in QUALITY role INSERT; removed duplicate `supervisor` emp 6000; aligned `SUPERTOKENS_API_KEY` with Docker (`local-development-key`).
- **Follow-ups:** none

### 2026-07-30 ? Seed ANN annealing batch

- **Goal:** Put a usable annealing charge/batch on the ANN board.
- **Touched:** `packages/server/scripts/seed-process-queues.mjs` (ran `seed:process-queues`)
- **Decisions / skipped:** Extended `seedAnnCharge` with `annealing_batch_no=SEED-ANN-BATCH-001`, `base_no=AB01`, soak defaults, WI stages; no new script.
- **Follow-ups:** none

### 2026-07-30 ? ANN operator base-card UI

- **Goal:** Base-grid board + charge detail matching operator layout structure (inspiration only).
- **Touched:**
  - `ProcessStationService.getAnnBoard` + `GET /stations/ann/board`
  - `AnnChargeBoard` / `AnnBaseCard` / `AnnProgressRing`
  - `AnnChargePage` (stage stepper, swipe advance, reading + last-reading panels)
  - `ProcessHub` Bases tab label + ANN default `?tab=charges`
- **Decisions / skipped:** Compact create-charge strip kept; MH charge-builder / reminders deferred; route stays `/charge/:chargeNo`.
- **Verify:** seed AB01 `SEED-ANN-CHG-001` IN_PROCESS; ANN unit tests green.

### 2026-07-30 ? ANN visual align to 6Hi operator DS

- **Goal:** Style-only parity with 6Hi/4Hi operator tokens; layout & behavior unchanged.
- **Touched:** `AnnBaseCard.tsx`, `AnnChargeBoard.tsx`, `AnnChargePage.tsx`, `AnnProgressRing.tsx`
- **Decisions / skipped:** No structure/API/state changes; swapped emerald/sky/amber ? `success`/`warning`/`info`/`primary`; reused `ZBadge`/`ZInput`/`ZButton` variants.
- **Follow-ups:** none

### 2026-07-31 ? ANN Operator Console design spec

- **Goal:** Apply `/operator` Base Cards + Reading Entry visual spec on ANN profiles.
- **Touched:** `index.css` (status-* aliases), `AnnBaseCard`, `AnnChargeBoard`, `AnnChargePage`
- **Decisions / skipped:** Shell unchanged (`OperatorShell`); mapped status-running/stopped/setup/reject/idle ? existing success/warning/info/destructive; no API/routing changes; Search refreshes board (filter stays live).
- **Follow-ups:** none

### 2026-07-31 ? ANN Base Card matches mock layout

- **Goal:** Rebuild base card chrome to match Base Cards screenshot (horizontal bar, not ring).
- **Touched:** `AnnBaseCard.tsx`; removed unused `AnnProgressRing.tsx`
- **Decisions / skipped:** Meta + progress bar + data rows + Base Details footer; Operator shows ? until API provides it; kebab visual-only (stopPropagation).
- **Follow-ups:** none

### 2026-07-31 ? ANN base cards landscape compact

- **Goal:** Shrink cards; landscape row layout (status rail + meta/progress/metrics).
- **Touched:** `AnnBaseCard.tsx`, `AnnChargeBoard.tsx` (1?2 col grid)
- **Decisions / skipped:** Same data/click behavior; vertical status rail; tighter type/spacing.
- **Follow-ups:** none

### 2026-07-31 ? Base card badge icon off + metrics 2×3

- **Goal:** Drop status pill icon; metrics in two lines (3 cols).
- **Touched:** `AnnBaseCard.tsx` (local `StatusPill`, `grid-cols-3` metrics)
- **Decisions / skipped:** Did not change shared `ZBadge` (keeps icons elsewhere).
- **Follow-ups:** none

### 2026-07-31 ? Remove status pill from ANN base cards

- **Goal:** Remove COMPLETE/status pill from base cards entirely.
- **Touched:** `AnnBaseCard.tsx`
- **Decisions / skipped:** Status remains on vertical rail + progress colors only.
- **Follow-ups:** none

### 2026-07-31 ? ANN Reading Entry matches mock

- **Goal:** Rebuild charge detail UI to Reading Entry screenshot (icons, layout, CTAs).
- **Touched:** `AnnChargePage.tsx`
- **Decisions / skipped:** Same APIs; Low Pressure + Remarks local UI only (not persisted); roster behind ANN batch details.
- **Follow-ups:** Persist remarks/low-pressure if API adds fields.

### 2026-07-31 ? Distinct icons for all 10 ANN stages

- **Goal:** Unique Lucide icon + label per stage; keep icon visible when done (check badge overlay).
- **Touched:** `AnnChargePage.tsx` (`STAGE_ICON`, `STAGE_LABEL`)
- **Decisions / skipped:** Loading? Purging wind Heating flame Soaking hourglass Furnace fan Natural cloud Rapid zap Water droplets Post refresh Unloading?
- **Follow-ups:** none

### 2026-07-31 ? Reading Entry fit tablet + detail popups

- **Goal:** No page scroll on tablet Reading Entry; ANN batch details + reading history as modals.
- **Touched:** `AnnChargePage.tsx` (`AnnPopup`, compact flex layout), `ProcessLayout.tsx` (`h-full` outlet)
- **Decisions / skipped:** Form panel may scroll internally if needed; roster/history no longer expand inline.
- **Follow-ups:** none

### 2026-07-31 ? ANN MH Phase 1 desk

- **Goal:** ANN-focused MH nav (7 items); Live Dashboard + Trends + Batching; ANN-scope reused Import/Export/Shift Review/Trace/Specs.
- **Touched:** `annMhDesk.ts`, `MachineHeadNav.tsx`, `MachineHeadShell.tsx`, `pages/machinehead/ann/*`, `App.tsx`, `AnnChargeBoard.tsx` (create strip removed), `PlantShiftReviewPage.tsx`, `MachineDprExport.tsx`, `AnnSpecAdmin.tsx`, `PpcRollingImportPanel.tsx` (`lockedSheetType`), `traceabilityFormat.ts`, `tests/annMhDesk.test.ts`
- **Decisions / skipped:** No ProcessHub/processConfig edits; clubbing advisories / crew register deferred; trends aggregate open-charge readings only (no new API).
- **Follow-ups:** Phase 2 crew registration; capacity warnings; richer ANN shift review payload if needed.

### 2026-07-31 ? ANN MH seed data

- **Goal:** Demo-ready ANN MH desk + operator profiles and rich board/batching/trends seed.
- **Touched:** `seed-pilot-users.mjs` (`machinehead.ann`, `operator.ann`, MH+ANN), `seed-process-queues.mjs` (2 charges, readings, ANN-Q pending coils), `seed-login-profiles.mjs`, `Login.tsx` DEV staff chip
- **Decisions / skipped:** No new seed script file; extended existing queues seed.
- **Follow-ups:** none

### 2026-07-31 ? ANN MH Phase 2

- **Goal:** Stoppages (op start/end + MH live list), batching soft advisories, Crew on ANN nav, ANN Shift Review bases panel.
- **Touched:** `processStationRoutes.ts` (`/ann/stoppage-categories`), `ProcessStationService.listAnnStoppageCategories`, `AnnChargePage.tsx`, `AnnMhLiveDashboard.tsx`, `annBatchingAdvisories.ts`, `AnnMhBatchingPage.tsx`, `MachineHeadNav.tsx`, `PlantShiftReviewPage.tsx`, `tests/annBatchingAdvisories.test.ts`
- **Decisions / skipped:** Soft advisories only; review panel client-composed from board (no CRM review rewrite).
- **Follow-ups:** Auto-handover redesign; hard clubbing gates if needed.

### 2026-07-31 ? ANN Operator + MH UX polish

- **Goal:** ANN-only Operator/MH polish: nav Batches+History, STOPPAGE, stage times, reading renames, MH full-screen charge, multi-metric trends, batching search, richer trace, add-base, structured shift review.
- **Touched:** `OperatorNavRail.tsx`, `ProcessHub.tsx`, `AnnBatchesPanel.tsx`, `AnnBaseCard.tsx`, `AnnChargePage.tsx`, `StatusRail.tsx`, `AnnOperatorHistoryPage.tsx`, `AnnMhLiveDashboard.tsx`, `AnnMhChargeDetailPage.tsx`, `AnnMhTrendsPage.tsx`, `AnnMhBatchingPage.tsx`, `traceabilityFormat.ts`, `AnnSpecAdmin.tsx`, `PlantShiftReviewPage.tsx`, `ProcessStationService.ts` (`createAnnBase`, `getAnnShiftReview`), `processStationRoutes.ts` (`POST /ann/bases`, `GET /ann/shift-review`), `annShiftReviewBuckets.ts`, `App.tsx`, `tests/annUxPolish.test.ts`
- **Decisions / skipped:** Live opens full route (no modal); Shift Review ANN tables from dedicated endpoint (crew cols `?`); no CRM `getShiftReview` rewrite; Low Pressure toggle removed.
- **Follow-ups:** optional `GET /stations/ann/readings` if History N+1 hurts; wire crew when data exists.




### 2026-07-31 ? PKL operator + MH plan (pre-impl)

- **Goal:** Map vague PKL operator/MH ask onto Rolling-shaped IA without touching CRM/HRS/CRS/ANN paths.
- **Touched:** (plan only) doc/ZEDRAL_PKL_OPERATOR_IMPLEMENTATION_PLAN.md, existing PklCoilForm / PklChart* / ProcessHub / MachineHeadNav
- **Decisions / skipped:** Prefer PKL-only files; nav = Orders / Capture / Manual / Readings; sibling auto-pick = mother+slit+grade with S weight (not CRM combine); MH mirror ANN-desk pattern lightly. Awaiting lock on multi-coil submit vs N independent saves.
- **Follow-ups:** Confirm run-together semantics; then implement PKL-scoped nav + queue group + console polish + MH desk.

### 2026-07-31 ? PKL operator + MH (Option A)

- **Goal:** Rolling-shaped PKL nav (Orders/Capture/Manual/Readings); sibling select mother+slit+grade + S weight; sequential per-coil save; light PKL MH desk.
- **Touched:** `OperatorNavRail.tsx`, `ProcessHub.tsx`, `processStore.ts`, `pklSiblingSelect.ts`, `CaptureWorkspace.tsx`, `PklCoilForm.tsx`, `pklMhDesk.ts`, `MachineHeadNav.tsx`, `MachineHeadShell.tsx`, `AutoSourceService.ts`, `ProcessStationService.ts`, `tests/pklMhDesk.test.ts`
- **Decisions / skipped:** Option A only (no CRM combine); ANN desk priority over PKL when both; no new PKL live page.
- **Follow-ups:** none
