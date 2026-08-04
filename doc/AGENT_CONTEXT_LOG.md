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

**Plan:** `doc/ZEDRAL_CRS_OPERATOR_IMPLEMENTATION_PLAN.md` ? ponytail **full** ? first slice only: capture fan-out + persist + per-line journey.

**Shipped**

1. Migration `1943000000000_crs_slit_line_fields.js` ? per-line quality/weight/hold/for-CTL/route on `prod_crs_slit`; pass `input_wt_mt` / `scrap_mt` / `setting_count` on `prod_crs`.
2. Shared types/schemas ? `CRSSlitSlot` + `crsSlitSlotSchema` + `crsMassBalanceWarn`.
3. `CrsQualityForm` ? HRS-style per-line grid (width/thk/wt/reject/hold/for-CTL); pass totals derived.
4. `ProductionService.saveCrs` ? writes new columns.
5. `JourneyAdvanceConsumer` ? skip `hold_flag` lines; per-line `for_ctl_flag` / `route_code` ? LE vs PKG; pass-level HOLD only when no slits.
6. `db-types` updated for new columns.
7. Test: `packages/shared-validation/tests/crsMassBalance.test.ts`.

**Skipped (add when needed)**

- `master.machine_spec` CRUD + eligibility (?3/?7)
- Process-agnostic assignment board
- Pass queue grouping by mother coil
- Crew capture, stoppage seed polish, shift dashboard metrics
- Spec snapshot on pass / full QSS wiring on load
- Retire `GenericCapturePage` for CRS (already routed via process body)

**Open plant decisions:** Slit No semantics; mass-balance/trim tolerances; setting-count derivation.

### 2026-07-30 ? CRS plan ?11 complete (this prompt)

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

### 2026-07-30 ? HRS plan ?11 (ponytail full)

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

### 2026-07-30 ? PKL plan ?12 (ponytail full)

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

- **Goal:** Implement `doc/ZEDRAL_ANN_OPERATOR_IMPLEMENTATION_PLAN.md` ? ponytail **full**.
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

### 2026-07-31 ? Base card badge icon off + metrics 2?3

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

### 2026-07-31 ? Share code to zedral_test

- **Goal:** Commit full working tree and push to `zedral_test` branch `share-the-code`.
- **Touched:** branch `share-the-code` @ `a24d054` ? `https://github.com/kshitijsince2004/zedral_test.git`
- **Decisions / skipped:** Kept `origin` as `hsl_zedral`; added remote `zedral_test`. `.env` not committed.
- **Follow-ups:** none

### 2026-08-01 ? ANN shift review on handover

- **Goal:** Show Process/Stoppage/Production ANN tables on operator shift handover (not only MH Shift Review).
- **Touched:** `AnnShiftReviewPanel.tsx`, `CrmOutgoingHandoverPage.tsx`, `PlantShiftReviewPage.tsx`
- **Decisions / skipped:** Shared panel; ANN-gated via `activeMachine`/`processLine`; duration display rounded.
- **Follow-ups:** optional accept-side panel if incoming needs same snapshot.

### 2026-08-01 ? Fix ANN handover scroll

- **Goal:** Process handover body could not scroll (ANN) ? flex height not constrained.
- **Touched:** `ProcessLayout.tsx` (outlet flex flex-col min-h-0), `CrmOutgoingHandoverPage.tsx` (h-full min-h-0 + scroll min-h-0)
- **Decisions / skipped:** Match SixHiLayout outlet flex pattern.
- **Follow-ups:** none

### 2026-08-01 ? ANN handover + MH review redesign

- **Goal:** ANN-only outgoing handover (Summary + AnnShiftReview + Crew/Notes); MH annDesk Shift Review = panel + picker only (no CRM cards).
- **Touched:** `AnnOutgoingHandoverPage.tsx`, `ScopeHandoverRoute.tsx`, `CrmOutgoingHandoverPage.tsx` (ANN strip), `PlantShiftReviewPage.tsx`
- **Decisions / skipped:** Dedicated ANN page vs CRM guards; CRM scrap/coolant/condition/queue/order omitted for ANN; non-ANN paths unchanged.
- **Follow-ups:** none

### 2026-08-01 ? ANN shift review section cards

- **Goal:** Split ANN shift review into clear cards (Process / Stoppage / Delay / Totals); shared by handover + MH.
- **Touched:** `components/process/annShiftReview/*`, `AnnShiftReviewPanel.tsx` (re-export), `AnnOutgoingHandoverPage.tsx`
- **Decisions / skipped:** No mega-wrapper card; same stack on op handover and MH annDesk; no API change.
- **Follow-ups:** none

### 2026-08-01 ? Drop ANN review OPN/Helper/Signature

- **Goal:** Remove empty Crew/sign-off (OPN/Helper/Signature ?) from Remarks & delay.
- **Touched:** `AnnDelayRemarksSection.tsx`, `AnnShiftReviewStack.tsx`
- **Decisions / skipped:** Keep remarks only; crew block still on handover Crew Details.
- **Follow-ups:** none

### 2026-08-01 ? ANN review Remarks as input

- **Goal:** Remarks field is editable textarea; handover wires to `shiftRemarks` payload.
- **Touched:** `AnnDelayRemarksSection.tsx`, `AnnShiftReviewStack.tsx`, `AnnOutgoingHandoverPage.tsx`
- **Decisions / skipped:** MH uses local editable state seeded from API.
- **Follow-ups:** none

### 2026-08-01 ? 100% completion plan M0?M4 (ponytail)

- **Goal:** Close PKL+ANN gaps per `ZEDRAL_100PC_COMPLETION_PLAN.md`.
- **Touched:** `doc/m1/M1_schema.sql` (B1); `194800?delay_bucket`, `annShiftReviewAgg.ts`, `getAnnShiftReview`, `AnnDelayRemarksSection` (A3); `PklMhLiveDashboard`, `PklMhCoilDetailPage`, `MhLiveEntry`, routes/nav (A2); PKL `Production Console` + StatusRail processCode (A1/A4); deleted ExecutiveNav/GloveModeToggle/annShiftReviewBuckets; `194900?` drop lineage_ref; moved `_qss_seed_params.json` ? `migrations/seeds/`.
- **Decisions / skipped:** PKL trends page YAGNI; kept `ann_cooling_hood` (FK); left server orphans with tests (configService/lineage/DprMappingAudit/plantHeadValidators/auditedTables) ? delete when CI tests updated.
- **Follow-ups:** run migrate 1948/1949 on envs; optional server orphan purge.

### 2026-08-01 ? Brand + UI/UX guidelines

- **Goal:** Lock system-wide visual language from CRM operator (6HI/4HI/2HI); docs + HTML demo; leave `design.md` as architecture.
- **Touched:** `doc/BRAND_GUIDELINES.md`, `doc/UI_UX_GUIDELINES.md`, `doc/brand-demo.html`
- **Decisions / skipped:** Product = Zedral ? Production Console; gold only END SHIFT/HOLD/PENDING; white top bar; dark mode forever out; CRM frozen; no UI code changes.
- **Follow-ups:** open `doc/brand-demo.html` in browser; apply checklist on non-CRM screens when touching UI.

### 2026-08-01 ? HRS/PKL console re-skin + MH merge (ponytail)

- **Goal:** Implement `doc/ZEDRAL_HRS_CONSOLE_RESKIN_AND_HRS_PKL_MH_PLAN.md` WS-A/B/C against brand/UI guidelines.
- **Touched:** `ProcessPPCCards.tsx`, `ProcessStatusBanner.tsx`, `ProcessShiftSummaryPanel.tsx`, `ProcessPairedField.tsx`, `CaptureWorkspace.tsx`, `ProductionActionRail.tsx`, `ProcessLayout.tsx`, `ProcessHub.tsx`, `HrsSlitBuilder.tsx`, `PklCoilForm.tsx`, `PklChartGrid.tsx`, `processStore.ts`, `MachineHeadNav.tsx`, `DeskSideNav.tsx`, `pklMhDesk.ts`, `MhLiveEntry.tsx`, `PklMhLiveDashboard.tsx`, `MachineHeadShell.tsx`, `MachineHeadCrewPage.tsx`, `tests/hrsPklConsole.test.ts`
- **Decisions / skipped:** Reused `OrderStoppageModal`/`OrderRemarkModal` (remarks ? `/defects`); kept crew overlay; surface-finish/finish-thk plan-only; no edge-trim fields; no server HRS HOLD gate; tol defaults when NOT_EVALUATED; combined MH desk only for HRS+PKL pair (or focus HRS|PKL); HRS live has no coil-detail page.
- **Follow-ups:** Server HRS dimensional HOLD; optional HRS MH coil detail; manual stoppage with no coil.

### 2026-08-01 ? PKL operator + MH revamp (ponytail)

- **Goal:** Implement `doc/ZEDRAL_PKL_OPERATOR_MH_REVAMP_PLAN.md` against brand/UI guidelines.
- **Touched:** `processConfig.ts`, `OperatorNavRail.tsx`, `ProcessHub.tsx`, `PklCoilForm.tsx`, `CaptureWorkspace.tsx`, `ProductionActionRail.tsx`, `ProcessLayout.tsx`, `processStore.ts`, `PklChartGrid.tsx`, `PklOutgoingHandoverPage.tsx`, `ScopeHandoverRoute.tsx`, `PklMhLiveDashboard.tsx`, `PklSpecAdmin.tsx`, `PklShiftReviewPanel.tsx`, `PlantShiftReviewPage.tsx`, `ProcessStationService.ts`, `processStationRoutes.ts`, `m1Forms.ts`, `db-types.ts`, `19500000000000_pkl_chart_burner_incharge.js`, `tests/pklRevamp.test.ts`
- **Decisions / skipped:** Label-only Leader End / Line Speed M/min; soft-delete specs via `is_active=false`; Defect/Crew off rail (Remark + handover); capture shift-summary strip reuse Hub panel only; steam_outlet_burner seed has null limits (confirm WI); HRS handover still CRM-shaped.
- **Follow-ups:** Run migration 1950 on envs; confirm WI limit for steam outlet burner; optional capture-page shift strip + inline stoppage list.

### 2026-08-01 ? Fix PklSpecAdmin ZInput import

- **Goal:** Unblock Vite resolve error for `ZInput` on admin PKL specs page.
- **Touched:** `packages/client/src/pages/admin/PklSpecAdmin.tsx`
- **Decisions / skipped:** Path was `../../primitives/ZInput`; corrected to `../../components/primitives/ZInput` (same as `ZButton`).
- **Follow-ups:** none


### 2026-08-01 ? PKL nav CRM misclassify fix (debug H-F)

- **Goal:** Fix PKL operator nav on user-scope URLs (`/pkl.operator` treated as CRM).
- **Touched:** `OperatorNavRail.tsx`, `StatusRail.tsx`, `OperatorShell.tsx`
- **Decisions / skipped:** Classify CRM vs process via `isProcessStationCode(processCode)`, not `isCrmMillPath` alone. Instrumentation kept for post-fix.
- **Follow-ups:** Verify post-fix logs show `isPkl:true,isCrm:false`; then continue E2E audit gaps (capture strip, chart migrate, hold, MH).

### 2026-08-01 ? PKL audit continue (H-F verified + H-A/H-E gaps)

- **Goal:** Close capture framing + PKL shift-review approve after H-F nav fix.
- **Touched:** `CaptureWorkspace.tsx` (shift summary + stoppage strip), `PlantShiftReviewPage.tsx` (`ShiftCompleteForm` on PKL desk), `classifyOperatorNav.ts` + test
- **Decisions / skipped:** H-F proven by vitest against pre-fix path; browser ingest still empty when client down. Chart/hold/manual still need live verify.
- **Follow-ups:** Browser post-fix with client running; remove debug instrumentation after confirm.

### 2026-08-01 ? Remove debug ingest instrumentation

- **Goal:** Strip all `// #region agent log` blocks and `127.0.0.1:7817` fetches from listed client files after audit.
- **Touched:** `CaptureWorkspace.tsx`, `OperatorNavRail.tsx`, `OperatorShell.tsx`, `MachineHeadShell.tsx`, `PklOutgoingHandoverPage.tsx`, `PklShiftReviewPanel.tsx`, `PklMhLiveDashboard.tsx`, `PklChartGrid.tsx`, `processStore.ts`, `ProcessHub.tsx`
- **Decisions / skipped:** Kept process-aware `navOffset` via `isProcessStationCode`; restored simple try/finally in store and `.then(setData)` in shift review; unused `useEffect` import removed from `OperatorNavRail` only.
- **Follow-ups:** none

### 2026-08-01 ? PKL revamp audit closed (debug)

- **Goal:** End E2E audit; strip ingest instrumentation after H-F proof + gap fills.
- **Touched:** cleaned debug from Hub/Capture/Nav/Shell/Chart/Store/Handover/MH/ShiftReview; kept `classifyOperatorNav` + capture summary/stoppage + PKL `ShiftCompleteForm`.
- **Decisions / skipped:** Browser ingest rarely reached (client often down); H-F verified by pre-fix log + vitest. Chart migrate 1950 / Hold / Manual still need plant smoke.
- **Follow-ups:** Run migration 1950; smoke Hold + chart save with burner/incharge columns.

### 2026-08-01 ? HRS + ANN line audit + process nav fix

- **Goal:** Audit HRS/ANN vs plans; close process-nav CRM fallthrough sibling of H-F.
- **Touched:** `OperatorNavRail.tsx` (HRS/CRS/RWD/CTL ? process hub items + Manual), `CaptureWorkspace.tsx` (HRS capture shift-summary), `classifyOperatorNav.test.ts`, `doc/AGENT_CONTEXT_LOG.md`
- **Decisions / skipped:** HRS handover + server dimensional HOLD + HrsShiftReviewPanel + ANN WI CRUD beyond limits/bases + retire `saveAnn` left as plan gaps (not implemented this turn). Kept H-NAV ingest on `OperatorNavRail` for browser verify.
- **Follow-ups:** Browser verify HRS/ANN navKind logs; then P0 HRS `HrsOutgoingHandoverPage`; P0/P1 ANN retire `saveAnn` / expand `AnnSpecAdmin`.

### 2026-08-01 ? HRS handover P0 + nav post-fix evidence

- **Goal:** Close HRS CRM-shaped handover; confirm nav classify via ingest.
- **Touched:** `HrsOutgoingHandoverPage.tsx`, `ScopeHandoverRoute.tsx`, `classifyOperatorNav.test.ts` (ingest), `OperatorNavRail.tsx` (H-NAV ingest kept)
- **Decisions / skipped:** HRS handover reuses PKL draft/submit pattern with `/stations/hrs/shift-metrics`; no chart; stoppage list deferred (`ponytail:`). Vitest post-fix: HRS=`process-hub`, ANN=`ann`, 6HI=`crm-mill`. Browser run only logged PKL.
- **Follow-ups:** Verify HRS `/handover` mounts `HrsOutgoingHandoverPage` (H-HANDOVER); then dimensional HOLD / ANN `saveAnn`.

### 2026-08-01 ? HRS handover CRM-stale fix (H-STALE)

- **Goal:** HRS handover must not use CRM page when `activeMachine` is CRM-stale but ProcessLayout `processCode` is HRS.
- **Touched:** `classifyHandoverBranch.ts`, `ScopeHandoverRoute.tsx` (outlet `processCode`), `classifyHandoverBranch.test.ts`, `ProcessHandoverPage.tsx` comment
- **Decisions / skipped:** Prefer process station from outlet over CRM `activeMachine`. Vitest ingest: HRS?`hrs`, 6HI+HRS?`hrs`, 6HI alone?`crm`. Browser still no HRS handover mount logs (only PKL nav).
- **Follow-ups:** Browser open HRS handover; confirm ingest `branch:"hrs"` + page title HRS Slitting.

### 2026-08-01 ? Stale Vite blocked HRS verify (H-BUNDLE)

- **Goal:** Explain empty browser logs; get fresh client serving Aug-1 handover/nav fixes.
- **Touched:** restarted `@m1/client` Vite (old pid 3568 started 2026-07-31); restarting `@m1/server` after :3005 refused.
- **Decisions / skipped:** H-BUNDLE confirmed ? process StartTime before `ScopeHandoverRoute`/`classifyHandoverBranch` writes. Instrumentation kept.
- **Follow-ups:** Hard-refresh browser; open HRS handover; expect ingest `branch:"hrs"`.

### 2026-08-01 ? HRS/ANN audit closed (unit post-fix)

- **Goal:** Close debug loop; strip ingest; keep nav/handover fixes.
- **Touched:** removed agent logs from `OperatorNavRail.tsx`, `ScopeHandoverRoute.tsx`, `HrsOutgoingHandoverPage.tsx`, classify tests; kept `classifyHandoverBranch`, `HrsOutgoingHandoverPage`, process hub nav, HRS capture shift-summary.
- **Decisions / skipped:** Browser never hit restarted Vite after 14:30 (vite log idle); post-fix NDJSON from vitest proves HRS?`process-hub`/`hrs`, ANN?`ann`, 6HI+HRS?`hrs`. Deferred: server HRS dimensional HOLD, HrsShiftReviewPanel, ANN `saveAnn` retire, WI CRUD expand.
- **Follow-ups:** Optional UI smoke on http://localhost:3000 HRS handover; then HOLD / ANN debt.

### 2026-08-01 ? PKL/HRS action rail ? rolling + mock parity

- **Goal:** Process `ProductionActionRail` match rolling ergonomics + attached rail image for PKL/HRS.
- **Touched:** `ProductionActionRail.tsx` (6.5rem panel, Start|Resume/End pair, outlined Stoppage, soft End, footer timer/status, End Shift), `ProcessLayout.tsx` (padding + End/Stoppage wiring), `CaptureWorkspace.tsx` (`#process-capture-form`)
- **Decisions / skipped:** Kept process End = capture form (no SixHi OrderEndModal); Hold uses Pause per mock not Ban; Defect/Crew stay off-rail. H-RAIL ingest kept for verify.
- **Follow-ups:** Browser verify PKL/HRS rail vs mock; then server dimensional HOLD if still needed.

### 2026-08-01 ? Rail always-6 buttons (mock parity)

- **Goal:** Match attached mock ? all six actions always visible (not SixHi conditional hide).
- **Touched:** `ProductionActionRail.tsx` (Start|Resume + End + Stoppage + Remark + Hold + End Shift always; disable by status)
- **Decisions / skipped:** Runtime log proved rail mounted `PKL-COIL-001` idle with 6 buttons after HMR. H1 (conditional stack ? mock) fixed; keep footer chrome.
- **Follow-ups:** Post-fix: Start ? Running, Stoppage ? Manage Stop/Resume, visual vs mock.

### 2026-08-01 ? Rail match mock (drop footer)

- **Goal:** Attached mock is coil + 6 buttons only; remove timer/status footer that diverged from image.
- **Touched:** `ProductionActionRail.tsx` (muted coil label, pale Stoppage, primary Remark/End Shift text, click ingest)
- **Decisions / skipped:** Timer stays on ProcessStatusBanner. Stoppage label always Stoppage (modal handles manage).
- **Follow-ups:** Verify ingest layout mock-6-no-footer + click events on Start/Stoppage.

### 2026-08-01 ? Process rail 6HI Start/End swap

- **Goal:** PKL/HRS rail match 6HI: Start XOR End (Start becomes End + timer on Start).
- **Touched:** `ProductionActionRail.tsx` (canStart/canResume/canEnd, footer timer, drop End Shift from rail, AlertTriangle stoppage, Ban hold)
- **Decisions / skipped:** End Shift stays on StatusRail only (same as 6HI). Process End still opens/scrolls capture form (no OrderEndModal yet).
- **Follow-ups:** Verify logs primary Start then End after click; timer Running.

### 2026-08-01 ? Fix process rail timer crash (useLiveTimer)

- **Goal:** Start then End/timer failed because rail rendered useLiveTimer object.
- **Touched:** `ProductionActionRail.tsx` ? destructure `{ formatted }`, pass `isActive` like ProcessStatusBanner/6HI.
- **Decisions / skipped:** Pre-fix logs only showed idle Start (no click); object render would throw once status=running.
- **Follow-ups:** Click Start; expect status running, primary End, timer HH:MM:SS string in logs.

### 2026-08-01 ? Rail Start XOR End (stoppage = Resume only)

- **Goal:** Match 6HI primary slot: idle Start, running End, stoppage Resume (never End+Resume).
- **Touched:** `ProductionActionRail.tsx` (`processRailFlags`), `processStore.ts` (set running before stoppage POST), `tests/processRailFlags.test.ts` (3/3)
- **Decisions / skipped:** Browser still idle-only in logs; timer object render already fixed.
- **Follow-ups:** Click Start ? expect primary End + timer string in ingest.

### 2026-08-01 ? HMR invalidate + soft prefill

- **Goal:** Fix broken Fast Refresh (new export) and HRS Forbidden unhandled rejection.
- **Touched:** `processRailFlags.ts` (moved out), `ProductionActionRail.tsx`, `CaptureWorkspace.tsx` (soft loadPrefill), tests
- **Decisions / skipped:** Vite log: Could not Fast Refresh (new export); ApiError Forbidden HRS on loadPrefill.
- **Follow-ups:** Hard refresh required; click Start for primary End log.

### 2026-08-01 ? Rail Start?End closed (RTL proof)

- **Goal:** Prove Start becomes End; strip debug ingest.
- **Touched:** cleaned `ProductionActionRail`, `ProcessLayout`, `processStore`; kept `processRailFlags` + RTL/unit tests
- **Decisions / skipped:** Browser never emitted Start click (only idle mounts); RTL log proved click?running?End. HMR invalidate + HRS Forbidden were plant blockers.
- **Follow-ups:** Hard-refresh plant UI; use PKL account with line access.

### 2026-08-01 ? Plan: HRS hub = CRM Skin Pass queue UX

- **Goal:** Plan matching 6HI/4HI/2HI Skin Pass Queue (list+detail+Move to Production) for HRS operator.
- **Touched:** plan only (no code); refs `SixHiHub`, `SixHiBatchDetailPanel`, `ProcessHub`
- **Decisions / skipped:** Reuse CRM chrome patterns under `process/`; keep route capture (no SixHiWorkspaceModal fork); skip mill allocation / Rolling|Skin tabs (N/A for HRS).
- **Follow-ups:** Implement WS-Q1..Q3 when user says go.

### 2026-08-01 ? HRS hub Skin Pass queue UX (WS-Q1..Q3)

- **Goal:** HRS operator hub match CRM list+detail+Move to Production.
- **Touched:** `ProcessQueueRow.tsx`, `ProcessQueueDetailPanel.tsx`, `ProcessHub.tsx` (HRS split; PKL/others keep cards)
- **Decisions / skipped:** No mill allocation / Preparing / workspace modal; capture still route-based; mother/slit/combination in HRS prefill.
- **Follow-ups:** Plant smoke HRS select ? Move to Production ? capture rail.

### 2026-08-01 ? HRS hub: soft queue Forbidden + access banner

- **Goal:** Vite showed Forbidden PKL on loadQueue; Soft Pass UI only on HRS ? surface error instead of unhandled rejection.
- **Touched:** `ProcessHub.tsx` (queueError banner, catch refresh, H-ACCESS/H-DESK ingest)
- **Decisions / skipped:** Skin Pass desk remains HRS-only; user must switch to HRS with line access.
- **Follow-ups:** Verify ingest processCode HRS + isHrsDesk true; then Move to Production.

### 2026-08-01 ? HRS hub post-fix: desk live (H-QUEUE)

- **Goal:** Read ingest after HRS reproduce; confirm Skin Pass list+detail mounts.
- **Touched:** ProcessHub.tsx (H-QUEUE after `filtered`; toolbar search-first; HRS title; H-MOVE ingest)
- **Decisions / skipped:** H-QUEUE CONFIRMED `processCode:HRS`, `queueLen:2`, `selectedCoilNo:HRS-COIL-001`, `queueError:null`. H-MOVE still unverified.
- **Follow-ups:** One Move to Production click ? then strip ProcessHub debug ingest.

### 2026-08-01 ? HRS hub TDZ crash (filtered before init)

- **Goal:** Explain Vite `ReferenceError: Cannot access 'filtered' before initialization` on ProcessHub.
- **Touched:** `ProcessHub.tsx` (H-QUEUE effect already after `filtered`; openCapture H-MOVE ingest)
- **Decisions / skipped:** Root cause was debug useEffect deps evaluating `filtered` before `const filtered`; HMR recovered; post-fix H-QUEUE still shows HRS desk OK.
- **Follow-ups:** Hard-refresh to clear error boundary; Move/double-click for H-MOVE; then strip ingest.

### 2026-08-01 ? HRS hub TDZ verified; strip ingest

- **Goal:** Post-fix proved desk live; remove ProcessHub debug fetch.
- **Touched:** `ProcessHub.tsx` (stripped H-ACCESS/H-QUEUE/H-MOVE ingest)
- **Decisions / skipped:** post-fix H-QUEUE: HRS, queueLen 2, selected IN_PROGRESS, queueError null; no new filtered TDZ after fix. H-MOVE never clicked in plant.
- **Follow-ups:** Optional smoke Move to Production if needed.

### 2026-08-01 ? Sticky error boundary + re-instrument HRS hub

- **Goal:** User still Proceeds after TDZ fix; HMR leaves class boundary stuck ? show error + Reload; re-add safe ingest.
- **Touched:** `AnalyticErrorBoundary.tsx`, `ProcessHub.tsx` (H-HUB/H-MOVE after filtered)
- **Decisions / skipped:** No new Vite filtered errors since fix; prior post-fix H-QUEUE already proved desk.
- **Follow-ups:** Expect H-HUB list-detail; if blank UI use Reload page; H-STICKY only if boundary catches again.

### 2026-08-01 ? HRS hub confirmed; strip debug ingest

- **Goal:** post-fix H-HUB proves list-detail desk; close debug loop.
- **Touched:** `ProcessHub.tsx` (ingest removed), `AnalyticErrorBoundary.tsx` (keep Reload+message, drop ingest)
- **Decisions / skipped:** H-HUB CONFIRMED (HRS, deskMode list-detail, queueLen 2); H-STICKY REJECTED this run; H-MOVE unused. Reload kept from earlier TDZ sticky-boundary proof.
- **Follow-ups:** none for crash; optional plant Move to Production smoke.

### 2026-08-01 ? HRS queue chrome closer to SixHi Skin Pass

- **Goal:** Match 6HI white-card list + 400px detail; keep H-HUB/H-MOVE ingest for Proceed loop.
- **Touched:** `ProcessHub.tsx` (rounded-2xl queue shell, search min-h-14, aside order like SixHi)
- **Decisions / skipped:** Functional desk already proven; polish only. No mill sections / Preparing.
- **Follow-ups:** Expect H-HUB `shell:white-card`; Move click for H-MOVE; then Mark as fixed / strip ingest.

### 2026-08-01 ? Line switcher setActiveMachine for HRS/PKL

- **Goal:** Empty ingest this run (H-HUB HRS-only) ? switcher never set activeMachine for process lines.
- **Touched:** `ProcessLineSwitcher.tsx` (always setActiveMachine), `UserScopeIndex.tsx` (H-ROUTE), `ProcessHub.tsx` (H-HUB all codes)
- **Decisions / skipped:** Root cause: process go() navigated same userScope URL without updating activeMachine ? stuck on PKL cards.
- **Follow-ups:** Expect H-SWITCH to:HRS + H-HUB deskMode list-detail; then strip ingest.

### 2026-08-01 ? HMR remount for app error boundary

- **Goal:** Empty browser ingest across Proceed loops ? app AnalyticErrorBoundary likely stuck after filtered TDZ; HMR does not clear class hasError.
- **Touched:** `main.tsx` (HmrErrorBoundary remount on vite:afterUpdate), `AnalyticErrorBoundary.tsx` (H-STICKY ingest)
- **Decisions / skipped:** Kept ProcessLineSwitcher setActiveMachine fix. Must hard-reload once so main.tsx wrapper loads.
- **Follow-ups:** Expect H-ROUTE/H-HUB after reload; if H-STICKY fires, Reload page.

### 2026-08-01 ? Revert HmrErrorBoundary (Vite removeChild)

- **Goal:** Vite proved HmrErrorBoundary broke app (removeChild + double createRoot + Fast Refresh invalidate).
- **Touched:** `main.tsx` restored; `AnalyticErrorBoundary.tsx` keep Reload + H-STICKY catch only
- **Decisions / skipped:** H-STICKY remount REJECTED as fix; keep setActiveMachine line-switcher + HRS desk.
- **Follow-ups:** Hard reload required; expect H-ROUTE/H-HUB without removeChild.

### 2026-08-01 ? Restart Vite; clear HmrErrorBoundary client state

- **Goal:** Browser still stacked HmrErrorBoundary + removeChild after revert; restart Vite on :3000.
- **Touched:** restarted `npm run dev -w @m1/client`; `main.tsx` already clean
- **Decisions / skipped:** HmrErrorBoundary gone from source; plant must full-reload tab.
- **Follow-ups:** Expect H-ROUTE/H-HUB; no removeChild in Vite.

### 2026-08-01 ? 2HI Rewinding mode

- **Goal:** 2HI Skin Pass + Rewinding via existing RWD pipeline (no SixHiSubProcess extension).
- **Touched:** `ProcessRouteService.ts`, `rewindingPlanXlsxParser.ts`, `SixHiService.getRewindingQueue`, `sixHiRoutes.ts`, `19510000000000_2hi_rewinding_sub_process.js`, `millConfig.ts`, `SixHiHub.tsx`, `TwoHiRewindingHub.tsx`, `TwoHiRewindingCapturePage.tsx`, `rewindingQueue.ts`, App/OperatorApp routes, tests
- **Decisions / skipped:** Did not extend `SixHiSubProcess`; separate lightweight queue + `RwdTensionForm`/`POST /production/rwd`. Seeded both `REWINDING` (ppc FK) and `2HI_REWINDING` (registry). Ops still must grant RWD WRITE line-scope (plan ?9).
- **Follow-ups:** Grant RWD line-scope to 2HI operators; smoke import with Machine=2HI column.

### 2026-08-02 ? PKL/HRS Capture + Orders match 6HI Skin Pass

- **Goal:** Capture = live status (img1); nav Capture not Production Console; no Shift Summary; PKL Orders = list+detail (img2).
- **Touched:** `ProcessLiveStatusPage.tsx`, `ProcessCapturePage.tsx`, `OperatorNavRail.tsx`, `ProcessHub.tsx`, `CaptureWorkspace.tsx`, `SixHiCapturePage.tsx`, stripped debug ingest
- **Decisions / skipped:** Preparing filter N/A (no PREPARING status); stoppage history empty until process API; form route stays `capture/:coilNo`.
- **Follow-ups:** Wire process shift stoppages into live page when endpoint exists.

### 2026-08-02 ? PKL desk crash was HMR mid-edit; verify isQueueDesk

- **Goal:** Logs showed PKL deskMode cards + ReferenceError isHrsDesk/pklMetrics during partial HMR.
- **Touched:** `ProcessHub.tsx` (H-PKL-DESK ingest; source already uses isQueueDesk for HRS|PKL)
- **Decisions / skipped:** Fix already in source; plant needs hard reload past sticky boundary.
- **Follow-ups:** Expect PKL `isQueueDesk:true`, `deskMode:list-detail`.

### 2026-08-02 ? PKL list-detail verified; strip H-PKL-DESK

- **Goal:** post-fix ingest proved PKL Skin Pass desk.
- **Touched:** `ProcessHub.tsx` (removed debug ingest)
- **Decisions / skipped:** Evidence: `processCode:PKL`, `isQueueDesk:true`, `deskMode:list-detail`, `queueLen:2`.
- **Follow-ups:** none for desk gate.

### 2026-08-02 ? H-NAV confirmed; Capture not opened

- **Goal:** Read post-fix ingest for nav + capture.
- **Touched:** `ProcessCapturePage.tsx` (H-CAPTURE route mode log)
- **Decisions / skipped:** H-NAV CONFIRMED PKL labels Orders/Capture/Process Chart, hasProductionConsole false. No H-CAPTURE ? Capture tab not visited.
- **Follow-ups:** User must open Capture once for live-status proof.

### 2026-08-02 ? Close PKL/HRS UI verify; strip remaining ingest

- **Goal:** Empty browser ingest this Proceed; prior runs already proved nav + PKL desk.
- **Touched:** stripped H-NAV/H-CAPTURE from `OperatorNavRail`, `ProcessCapturePage`, `ProcessLiveStatusPage`
- **Decisions / skipped:** Browser did not hit Capture; vitest RTL collect broken in env (even prior ProductionActionRail test). Rely on prior H-NAV + H-PKL-DESK logs.
- **Follow-ups:** Plant smoke Capture tab if needed.

### 2026-08-02 ? Guard Capture nav path (no bare /capture)

- **Goal:** Empty ingest on Proceed; hypothesis Capture click used `/capture` when processBase empty ? wrong route.
- **Touched:** `OperatorNavRail.tsx` (scopeRoot fallback + H-NAV-CLICK), `ProcessCapturePage.tsx` (H-CAPTURE + console)
- **Decisions / skipped:** Prior H-NAV/H-PKL-DESK still stand; need Capture click evidence.
- **Follow-ups:** Expect H-NAV-CLICK id capture + H-CAPTURE mode live-status.

### 2026-08-02 ? Sticky boundary + Capture branch instrumentation

- **Goal:** Empty ingest on Proceed; Vite showed prior `isHrsDesk` crash into AnalyticErrorBoundary ? sticky class boundary blocks Capture.
- **Touched:** `AnalyticErrorBoundary.tsx` (resetKey), `App.tsx` (boundary inside router), `main.tsx`, `ScopeCaptureRoute.tsx` (process-first), `ProcessLiveStatusPage.tsx`
- **Decisions / skipped:** Prefer process Capture when activeMachine/outlet is process; keep H-NAV-CLICK/H-CAPTURE logs.
- **Follow-ups:** Expect H-BOOT + H-BRANCH process + H-CAPTURE live status after hard reload + Capture click.

### 2026-08-02 ? Same-origin debug ingest (/__dbg)

- **Goal:** Browser never wrote ingest (likely blocked 127.0.0.1:7817); empty Proceeds.
- **Touched:** `vite.config.ts` (`/__dbg` middleware), `agentDebugLog.ts`, wired App/ScopeCapture/Capture/Live/Nav/Boundary; Vite restarted.
- **Decisions / skipped:** Proved `POST /__dbg` ? `.cursor/debug-7bef13.log` (204). Kept sticky `resetKey` + process-first Capture branch.
- **Follow-ups:** Need H-BOOT + Capture click logs from browser via `/__dbg`.

### 2026-08-02 ? Station sync (HRS 403) + Capture live gap

- **Goal:** Console HRS queue 403 + PKL shift 401; ingest proved Capture never hit live-status (only `capture/:coil` forms).
- **Touched:** `ProcessLayout.tsx` (`stationCode` prop + useLayoutEffect sync), `UserScopeShell.tsx`, `ProcessHubPage.tsx`, `ProcessCapturePage.tsx`
- **Decisions / skipped:** 401 = unauthenticated on shift init (logged H-AUTH); live Capture still needs bare `/capture` nav click.
- **Follow-ups:** Expect H-MACHINE machine=PKL/RWD (not stale HRS); H-CAPTURE mode=live-status when Capture tab clicked.

### 2026-08-02 ? Capture live-status verified (RWD)

- **Goal:** Post-fix after station sync + Capture tab click.
- **Touched:** (logs only) `debug-7bef13.log`
- **Decisions / skipped:** H-CAPTURE CONFIRMED `mode:live-status`, `coilNo:null`, `fromOutlet:RWD`, `queueLen:2`. Keep ingest until Mark as fixed / PKL smoke.
- **Follow-ups:** Strip `agentDebugLog` + `/__dbg` after user confirms UI.

### 2026-08-02 ? Strip debug ingest after Capture verify

- **Goal:** Empty Proceed after RWD live-status proof; remove instrumentation.
- **Touched:** removed `agentDebugLog.ts`, `/__dbg` vite plugin; cleaned App/Nav/Layout/Capture/ScopeCapture/Boundary/LiveStatus
- **Decisions / skipped:** Kept `stationCode` sync, `resetKey` boundary, process-first Capture, live Capture page, Orders desk.
- **Follow-ups:** none.

### 2026-08-02 ? RWD Orders Skin Pass desk (H-DESK)

- **Goal:** Repeated Proceed on RWD; Capture live proven, but `isQueueDesk` was HRS/PKL-only ? RWD Orders stayed card grid.
- **Touched:** `ProcessHub.tsx` (`isQueueDesk = archetype !== 'B'`), restored `/__dbg` + `agentDebugLog` for H-DESK
- **Decisions / skipped:** ANN (archetype B) unchanged.
- **Follow-ups:** Expect RWD `deskMode:list-detail`.

### 2026-08-02 ? H-DESK verified; strip ingest

- **Goal:** Post-fix desk mode on PKL.
- **Touched:** stripped `agentDebugLog` / `/__dbg`; kept `isQueueDesk = archetype !== 'B'`
- **Decisions / skipped:** Evidence `processCode:PKL`, `isQueueDesk:true`, `deskMode:list-detail`.
- **Follow-ups:** none.

### 2026-08-02 ? HRS login opened PKL (preferPrimaryMachine)

- **Goal:** Login as HRS was landing on Pickling (stale/unordered `machines[0]` / dual HRS+PKL access).
- **Touched:** `machineRouting.ts` (`preferPrimaryMachine`), `authStore.ts` login, `UserScopeShell.tsx` fallback; H-LOGIN-HOME ingest
- **Decisions / skipped:** Prefer lineAccess match, then HRS-before-PKL order; keep activeMachine if still assigned.
- **Follow-ups:** Post-fix: HRS login ? `machine:HRS` not PKL.

### 2026-08-02 ? HRS login opened PKL (stale mh.deskFocus)

- **Goal:** HRS login showed Pickling; DB `hrs`/`HRS_MH` are HRS-only ? bug was stale `mh.deskFocus=PKL`.
- **Touched:** `pklMhDesk.ts` (require assignment + `resolveHrsPklLiveLine`), `MhLiveEntry.tsx`, `annMhDesk.isAnnMhDesk`, `authStore` clears MH focus on login/logout
- **Decisions / skipped:** Kept `preferPrimaryMachine`; browser ingest empty this Proceed (probe-only).
- **Follow-ups:** Expect H-LOGIN-HOME `line:HRS` for HRS_MH / badge 5050?HRS hub.
### 2026-08-02 ? Action rail audit canvas + runtime probes

- **Goal:** Audit screenshot rail (START/STOPPAGE/REMARK/HOLD) for 6HI/4HI/2HI; gap-analyze HRS/PKL E2E vs CRM.
- **Touched:** `canvases/hrs-pkl-action-rail-gap.canvas.tsx`, `processStore.ts`, `ProcessLayout.tsx`, `SixHiLayout.tsx`, `ProcessLiveStatusPage.tsx`, `agentDebugLog.ts` (runId rail-gap)
- **Decisions / skipped:** HRS/PKL UI matches CRM chrome; Start/End/Stoppage mostly client-local; Hold + form Complete are real APIs. No product fix until runtime confirms.
- **Follow-ups:** User reproduce HRS Start?End?Stoppage (+ optional 6HI Start); close gaps in order listed on canvas.

### 2026-08-02 ? Rail-gap logs missing after Proceed

- **Goal:** Analyze rail-gap reproduction; no browser NDJSON (only shell probe).
- **Touched:** `vite.config.ts` (dual-write `.cursor/` + workspace `debug-7bef13.log`), static `agentDebugLog` in process/CRM rail paths, `ProductionActionRail` mount probe H-RAIL
- **Decisions / skipped:** No product fix yet ? runtime evidence absent; hypotheses still open.
- **Follow-ups:** Hard reload HRS ? Move to Production ? START/END/STOPPAGE; expect H-RAIL + H1/H2/H3.

### 2026-08-02 ? Rail-gap hypotheses confirmed via Playwright store exercise

- **Goal:** Obtain runtime evidence for HRS/PKL action-rail gaps after empty user Proceeds.
- **Touched:** `.cursor/rail-gap-pw.cjs` (harness); logs in `.cursor/debug-7bef13.log`; canvas note
- **Decisions / skipped:** CONFIRMED H1/H3/H-STOP/H5; no station Start API exists yet ? deferred product fix pending user priority. H2/H4/H-RAIL need HRS machine login.
- **Follow-ups:** Implement station Start + End?complete when user picks; or re-run with dedicated HRS badge.

### 2026-08-02 ? Station Start closes H1/H3 rail gaps

- **Goal:** HRS/PKL Start hits server + queue IN_PROGRESS (confirmed desync).
- **Touched:** `ProcessStationService.startCoil`, `processStationRoutes` POST `/:process/start`, `processStore.resumeCapture`
- **Decisions / skipped:** End/Stoppage/Remark/history still open. Kept debug ingest for post-fix.
- **Follow-ups:** User verify real HRS coil Start; then End?complete / stoppage if wanted.

### 2026-08-02 ? Rail End ? production form submit (H2)

- **Goal:** Close End gap ? rail End submits capture form (real /production complete), then finishCapture.
- **Touched:** `processStore` (`requestEndCapture`/`finishCapture`/`endCaptureToken`), `ProcessLayout`, `CaptureWorkspace`
- **Decisions / skipped:** No separate End API (form payload required). Stoppage/history still open. Debug logs kept.
- **Follow-ups:** User verify End on real HRS form; next Stoppage if requested.

### 2026-08-02 ? Process stoppage open/end + Capture history

- **Goal:** Close H-STOP / H-HIST ? open stoppage on rail Stoppage, end on Resume; wire Capture live history.
- **Touched:** `StoppageService.startOpen/endOpen`, `ProcessStationService.listShiftStoppages`, `processStationRoutes`, `processStore`, `ProcessLiveStatusPage`
- **Decisions / skipped:** Shift+machine scoped (not CRM order_id). Remark/defects gap unchanged. Debug ingest kept.
- **Follow-ups:** User verify STOPPAGE?Resume + Capture history on HRS; strip debug after confirm.

### 2026-08-02 ? Rail gaps closed; strip debug ingest

- **Goal:** Confirm stoppage post-fix; strip session debug; leave Remark as defects-by-design.
- **Touched:** removed `agentDebugLog.ts` + `/__dbg` vite plugin; cleaned App/UserScopeShell/MhLiveEntry/process/CRM instrumentation
- **Decisions / skipped:** No separate process remarks API (YAGNI ? defects panel covers Remark).
- **Follow-ups:** Smoke HRS Start/End/Stoppage/Capture history once after Vite restart.

### 2026-08-02 ? Rail parity closed (final smoke)

- **Goal:** Confirm after debug strip; no further product changes.
- **Touched:** none (smoke only)
- **Decisions / skipped:** Start optimistic IN_PROGRESS OK; stoppage/history need `shiftLogId` (null on 6HI-only session without process shift). Remark stays defects.
- **Follow-ups:** none unless user reports a specific HRS-line failure with active shift.

### 2026-08-02 ? HRS multi-reading capture (thickness/taper/width)

- **Goal:** Implement `ZEDRAL_HRS_MULTI_READING_CAPTURE_PLAN.md` ? mother-pick + timestamped readings; latest-wins.
- **Touched:** `migrations/19520000000000_hrs_multi_reading_capture.js`, `shared-validation` types/schemas, `ProductionService.saveHrs`, `JourneyAdvanceConsumer`, `db-types.ts`, `HrsSlitBuilder.tsx`
- **Decisions / skipped:** Independent thk/taper reading rows (both nullable); produced MT = ? plan weights; no HRS PPC importer; DPR still pass-level (actual_width_mm = latest); ID/Centre/OD columns kept nullable, not written; manual +Slit line removed.
- **Follow-ups:** Run migration; confirm plant on child weighing; HRS sheet importer (plan ?7).

### 2026-08-02 ? Applied HRS multi-reading migration

- **Goal:** Run `npm run migrate` so capture can persist reading tables.
- **Touched:** DB via `19520000000000_hrs_multi_reading_capture` (also pending `1948`?`1951`)
- **Decisions / skipped:** Confirmed defer HRS PPC importer, child weighing, reading-series DPR until plant asks.
- **Follow-ups:** Smoke HRS capture on a mother with `ppc_batch` slits.

### 2026-08-02 ? RWD form match 6HI capture chrome

- **Goal:** Rewinding capture looks like 6HI rolling: Current Order + Details to be Filled + big Save Production Data.
- **Touched:** `RwdTensionForm.tsx`, `TwoHiRewindingCapturePage.tsx`
- **Decisions / skipped:** Reused ProcessPPCCards; unit-suffix inputs inline. Same form upgrades standalone RWD station capture.
- **Follow-ups:** none

### 2026-08-02 ? RWD Current Order full plan row

- **Goal:** Current Order card shows Coil No + Plan Width/Thick/Grade like screenshot.
- **Touched:** `ProcessPPCCards.tsx`, `TwoHiRewindingCapturePage.tsx`, `CaptureWorkspace.tsx`
- **Decisions / skipped:** Plan row only when plan* fields passed (RWD / 2HI rewinding); other stations unchanged.
- **Follow-ups:** none

### 2026-08-02 ? RWD capture chrome polish

- **Goal:** Drop Route; Surface on Current Order; no Details heading/icons; Save pinned on screen.
- **Touched:** `ProcessPPCCards.tsx`, `RwdTensionForm.tsx`, `TwoHiRewindingCapturePage.tsx`, `CaptureWorkspace.tsx`
- **Decisions / skipped:** Surface from PPC only (no form picker); page-footer Save via form= id.
- **Follow-ups:** none

### 2026-08-02 ? RWD capture: no QC empty state, pin Save, drop Plan Grade

- **Goal:** Remove empty Quality checks for RWD; drop Plan Grade; pin Save below scroll (UI ?4.2).
- **Touched:** `CaptureWorkspace.tsx`, `ProcessPPCCards.tsx`, `TwoHiRewindingCapturePage.tsx`, `processConfig.ts`, `RwdTensionForm.tsx`
- **Decisions / skipped:** QC still on HRS/CRS/CTL/ANN; Save via form= footer (6HI capture pattern).
- **Follow-ups:** none

### 2026-08-02 ? Rewinding line order lifecycle (parity plan)

- **Goal:** Bring Rewinding to rolling-parity as its own line (	xn.rwd_order), not CRM sub_process.
- **Touched:** migrations/19530000000000_rwd_order.js, RewindingOrderService.ts, 
ewindingRoutes.ts, pp.ts, orderLifecycleHelpers.ts, 
ewindingMachines.ts, db-types.ts, SixHiService.ts (finishGroup import only), client 
wdMhDesk.ts, 
ewindingWrites.ts, TwoHiRewindingHub/Capture, Rewinding*Modal, MachineHeadShell/Nav, tests
- **Decisions / skipped:** Stoppage uses 
wd_order_id + order_kind (not shared CRM FK). Hold fields on 
wd_order (no order_rejection FK). Combined UI panel deferred (API start-combined ready). Standalone RWD ProcessLayout still one-shot/processStore until cutover. /production/rwd kept alive. crm_sub_process REWINDING seed left (ppc FK).
- **Follow-ups:** Run migration; wire ProcessHub RWD to /rewinding/queue; combined panel/history UI; dedicated RWD MH live page if needed.

### 2026-08-02 ? RWD full-flow audit (debug)

- **Goal:** Audit RWD (separate from 2HI skin-pass) import ? pending ? MTP ? in process ? completed.
- **Touched:** debug instrumentation in PPCImportService, ProcessStationService, RewindingOrderService, ProcessHub, processStore
- **Decisions / skipped:** No fix yet ? waiting runtime logs. Suspected: import skips rwd_order; ProcessHub uses journey queue not /rewinding/queue; MTP doesn't call start; completed filtered out.
- **Follow-ups:** Analyze debug-9b6463.log after user repro, then wire RWD hub to order lifecycle.

### 2026-08-02 ? RWD flow fix (debug evidence)

- **Goal:** Fix RWD import?pending?MTP?in process?completed; keep separate from 2HI skin-pass.
- **Touched:** migration applied 19530000000000_rwd_order; PPCImportService ensure RWD orders; RewindingOrderService.getQueue includes COMPLETED; processStore RWD?/rewinding/queue; ProcessHub MTP allocates+rewinding capture; TwoHiRewindingCapturePage RWD line basePath
- **Decisions / skipped:** DB backfill of existing rows blocked by auto-review ? MTP/allocate creates order on first use. Instrumentation kept for post-fix.
- **Follow-ups:** Verify logs post-fix; remove debug ingest after confirm.

### 2026-08-02 ? RWD queue stale processCode fix

- **Goal:** Post-fix showed 0 rwd_order rows / no ingest logs ? hub likely never called /rewinding/queue.
- **Touched:** processStore.loadQueueFor(code), ProcessHub passes prop code; queue auth READ; file NDJSON logs on rewinding routes
- **Decisions / skipped:** Hypothesis F: store default HRS raced ProcessLayout ? loadQueue ignored hub processCode prop.
- **Follow-ups:** Verify post-fix2 logs show queue count 9 + allocate creates rwd_order.

### 2026-08-02 ? RWD empty queue: API down + 2HI filter

- **Goal:** Post-repro: Vite showed ECONNREFUSED on /rewinding/queue?machine=2HI; SQL for 2HI+machine_code=2HI returned 0 while 7 unallocated from_work_center=R exist on RWD.
- **Touched:** RewindingOrderService.getQueue, 
ewindingRoutes.ts (pre-auth file logs), TwoHiRewindingHub.tsx, processStore.ts
- **Decisions / skipped:** 2HI desk now lists unallocated RWD-line plans; MH RWD?/live left deferred.
- **Follow-ups:** Verify post-fix3 logs show queue count 7 (2HI) / 9 (RWD); MTP?start creates rwd_order.

### 2026-08-02 ? RWD MH live + station queue bridge

- **Goal:** Post-fix3 left zero /rewinding hits ? MH Live was /live (CRM); station RWD used journey queue.
- **Touched:** ProcessStationService.getQueue RWD?RewindingOrderService; RwdMhLiveDashboard; App/MH nav to /machine-head/rwd/live; vite /__agent-dbg; ProcessHub refresh logs
- **Decisions / skipped:** Kept prior 2HI unallocated filter.
- **Follow-ups:** Verify logs show queue count =7 and allocate creates rwd_order.

### 2026-08-02 ? RWD live allow OPERATOR + mount logs

- **Goal:** post-fix4 still 0 app logs / 0 rwd_order ? MH route was MH-only (operators get Access Denied, never fetch).
- **Touched:** App.tsx allow OPERATOR/SUPERVISOR on /machine-head/rwd/live; RwdMhLiveDashboard mount+error dbg; killed duplicate Vite :3001
- **Follow-ups:** Verify mount + queueLen logs and MTP creates rwd_order.

### 2026-08-02 ? RWD order journey audit (PENDING?COMPLETED)

- **Goal:** Document fetch + internal lifecycle for rewinding line (own txn.rwd_order, not CRM).
- **Touched:** analysis only (RewindingOrderService, rewindingRoutes, ProcessHub, capture, import)
- **Decisions / skipped:** Save (/production/rwd) ? End (order COMPLETED); MTP allocates only.
- **Follow-ups:** Verify UI path /machine-head/rwd/live still; optional unify Save+complete.

### 2026-08-02 ? RWD journey verified partial; 2HI alloc default

- **Goal:** Logs prove queue 9/7 + SEED-RWD-001 allocate?start?IN_PROGRESS; 2HI user Forbidden on RWD.
- **Touched:** TwoHiRewindingHub suggest 2HI on 2HI desk; allocate fail file log
- **Decisions / skipped:** Pending queue bug fixed; End/Save not yet in logs ? ask complete End.
- **Follow-ups:** Verify End?COMPLETED; 2HI assign defaults to 2HI.

### 2026-08-02 ? Line order parity ask (RWD/HRS/PKL = 6HI)

- **Goal:** User wants RWD, HRS, Pickling exact like 6HI Rolling lifecycle.
- **Touched:** (decision only)
- **Decisions / skipped:** Own table per line (not fold into crm_order). RWD already has txn.rwd_order; HRS/PKL today journey-only. Build order: finish RWD UX ? hrs_order ? pkl_order.
- **Follow-ups:** Confirm start with RWD remaining gaps then HRS migration.

### 2026-08-02 ? RWD lifecycle verified; 2HI alloc default fix

- **Goal:** Analyze post-fix logs after user repro.
- **Evidence:** RWD queue count=9; allocate SEED-RWD-001?PREPARING; start?IN_PROGRESS (DB 1 row). 2HI allocate to RWD failed Forbidden (user 5).
- **Touched:** TwoHiRewindingHub suggested=desk machineCode; allocate fail logs
- **Follow-ups:** User End?Completed; then strip debug instrumentation.

### 2026-08-02 ? RWD end blocked by coil status COMPLETED

- **Goal:** End?Completed never landed; SEED-RWD-001 still IN_PROGRESS.
- **Touched:** RewindingOrderService.endProduction coil status DONE (not COMPLETED ? check constraint); end route + capture onEnd logs
- **Decisions / skipped:** coil_status_check allows DONE not COMPLETED (CRM uses DONE).
- **Follow-ups:** Verify end ok + COMPLETED in queue/DB.

### 2026-08-02 ? ProcessHub unique keys by batch

- **Goal:** Fix duplicate React keys when multiple RWD batches share coil_no.
- **Touched:** `packages/client/src/components/process/ProcessHub.tsx`
- **Decisions / skipped:** Select/key via `batchNumber || journeyId || coilNo`; keep debug instrumentation for post-fix8 uniqueness log (hypothesis M).
- **Follow-ups:** Verify uniqueBatchKeys === total and Vite duplicate-key warning gone; then strip agent logs.

### 2026-08-02 ? Duplicate-key root cause; verify post-fix

- **Goal:** Prove ProcessHub duplicate React keys; confirm batchNumber key fix.
- **Touched:** `ProcessHub.tsx`, `processStore.ts` (`/__agent-dbg` uniqueness log)
- **Evidence:** Vite warned keys `1100038398` / `1100038122` at ProcessHub (5:26); DB shows 3+2 batches on those coils; no key warnings after 5:44 HMR; prior Proceed had 0 hub refresh logs.
- **Follow-ups:** Hard-refresh RWD hub ? expect uniqueBatchKeys===total and no console key warning.

### 2026-08-02 ? Duplicate-key fix verified (DB + Vite)

- **Goal:** Confirm ProcessHub batch keys fix with runtime evidence.
- **Touched:** `ProcessHub.tsx` (mount dbg), `RewindingOrderService.ts` (file uniqueness log)
- **Evidence:** DB RWD 9 batches / 6 coils / 9 unique batches (`fixWouldBeUnique`); Vite dup-key warnings 57 pre-fix ? 0 after 5:44 HMR; dup coils `1100038398`, `1100038122`.
- **Follow-ups:** Need one client `ProcessHub.mount` / uniqueness NDJSON from hard-refresh; then strip agent logs.

### 2026-08-02 ? ProcessHub fix live in Vite; awaiting browser mount

- **Goal:** Verify batch-key fix without relying on empty user Proceed clicks.
- **Evidence:** Vite serves `queueCardKey` (no `selectedCoilNo`); DB 9/6/9 uniqueness; 0 dup-key warnings post-5:44; no `ProcessHub.mount` from browser yet.
- **Touched:** verification only (deleted temp playwright script)
- **Follow-ups:** User open `/rwd_op.operator` once ? then strip `#region agent log`.

### 2026-08-02 ? Strip session 9b6463 debug instrumentation

- **Goal:** Remove all `debug-9b6463` / `__agent-dbg` / `7817/ingest` instrumentation added during the ProcessHub duplicate-key investigation, keeping the functional `queueCardKey`/`selectedKey` fix.
- **Touched:** `packages/client/src/components/process/ProcessHub.tsx`, `packages/client/src/store/processStore.ts`, `packages/client/src/pages/machinehead/RwdMhLiveDashboard.tsx`, `packages/client/src/pages/sixHi/TwoHiRewindingCapturePage.tsx`, `packages/client/src/pages/sixHi/TwoHiRewindingHub.tsx`, `packages/client/vite.config.ts`, `packages/server/src/services/RewindingOrderService.ts`, `packages/server/src/routes/rewindingRoutes.ts`, `packages/server/src/services/PPCImportService.ts`, `packages/server/src/routes/processStationRoutes.ts`, `packages/server/src/services/ProcessStationService.ts`
- **Decisions / skipped:** Removed the `agent-dbg` Vite plugin, `agentFileLog`/`DEBUG_LOG_PATHS`/preAuth logging middleware in `rewindingRoutes.ts`, the unused `appendFileSync` import in `RewindingOrderService.ts`, and all `#region agent log` blocks; also dropped now-pointless `try/catch` wrappers left behind once their only content was debug logging (`processStore.loadQueueFor` RWD branch). Left a pre-existing `ProcessStationService.ts` TS2322 type mismatch in the RWD queue mapping untouched ? unrelated to debug code, predates this cleanup.
- **Follow-ups:** Repo-wide grep for `9b6463|__agent-dbg|7817/ingest|debug-9b6463|#region agent log` now returns zero ts/tsx matches (only this log file). Consider fixing the pre-existing `ProcessStationService.getQueue` RWD-branch type mismatch separately.

### 2026-08-02 ? RWD parity slice: auth + reinstate-on-MTP

- **Goal:** Close correctness gaps vs 6HI before hrs_order.
- **Touched:** `rewindingRoutes.ts` (authorizeOrderBatch on writes), `ProcessHub.tsx`, `RwdMhLiveDashboard.tsx` (HOLD filter + reinstate before allocate)
- **Decisions / skipped:** Combine UI, Preparing filter, stoppage row badge ? deferred; endpoints already exist.
- **Follow-ups:** Combine bar on TwoHiRewindingHub / RWD MH; then `txn.hrs_order`.

### 2026-08-02 - HRS order lifecycle service + routes (txn.hrs_order)

- **Goal:** Add HRS order lifecycle over the new `txn.hrs_order` table (migration `19540000000000_hrs_order.js` already present), mirroring `RewindingOrderService`/`rewindingRoutes.ts` but keyed by mother `coil_no` - no combine, no machine allocation (HRS is a single line).
- **Touched:** `packages/server/src/services/HrsOrderService.ts` (new), `packages/server/src/routes/hrsOrderRoutes.ts` (new), `packages/server/src/db-types.ts` (added `TxnHrsOrder` interface, `hrs_order_id` on `TxnStoppage`, `"txn.hrs_order": TxnHrsOrder` in `DB`).
- **Decisions / skipped:** `ensureOrder` throws if the coil is missing from `coil.coil` (table has a FK to it); customer/grade/dims are sourced from the first matching HRS `ppc_batch` row, falling back to `coil.coil` (+ `master.customer` join) when no batch exists yet. `getQueue(userId)` unions journey-driven HRS cards (ACTIVE/HOLD journey, step PENDING/ACTIVE/HOLD) with any `IN_PROGRESS`/`STOPPAGE`/`REJECTED` `hrs_order` rows not already covered by a journey card, so in-flight/rejected orders don't fall off the queue once their journey step advances or holds. `updateStoppage` was added (not explicitly listed in method 9 but required by the `PATCH stoppages/:id` route). Did not touch `ProcessStationService` or `app.ts` - left for wiring by the parent task.
- **Follow-ups:** Parent should wire `hrsOrderRoutes` into `app.ts` and swap `ProcessStationService.getQueue('HRS')` to delegate to `HrsOrderService.getQueue` the same way it currently delegates RWD to `RewindingOrderService.getQueue`. Note: a stale `packages/server/tsconfig.tsbuildinfo` was found causing spurious `tsc` CLI errors (`"txn.rwd_order"`/`"txn.hrs_order"` not assignable to `TableExpression<DB, never>`) that don't reproduce after deleting the cache or via the IDE's language server - safe to ignore/delete if seen again.

### 2026-08-02 ? HRS order line (txn.hrs_order) v1

- **Goal:** Own HRS lifecycle table like RWD/6HI (coil_no key, N slits).
- **Touched:** migration `19540000000000_hrs_order.js` (applied), `HrsOrderService.ts`, `hrsOrderRoutes.ts`, `app.ts`, `ProcessStationService` (HRS queue/start/hold), `processStore` `/hrs-order/queue`, `db-types.ts`
- **Decisions / skipped:** No allocate/combine; capture still `saveHrs`; endProduction not auto-hooked from save yet.
- **Follow-ups:** Hook saveHrs ? endProduction; then `pkl_order`.

### 2026-08-02 ? Fix prod_rwd surface_finish FK

- **Goal:** Unblock POST /production/rwd for coil 9100014760 (parked sync).
- **Evidence:** `master.surface_finish` had 0 rows; plan `roll_finish=BRIGHT` ? operator `B`.
- **Touched:** migration `19550000000000_seed_surface_finish_codes` (B/M seeded), `ProductionService.saveRwd` maps via `mapPlanSurfaceToCode`.
- **Follow-ups:** User retry parked RWD sync; then pkl_order.

### 2026-08-02 ? Parked outbox never retried

- **Goal:** Surface FK fixed but parked RWD sync never hit saveRwd.
- **Evidence:** 0 saveRwd logs; `groupReplayable` filtered `group[0].status === 'pending'` only ? parked skipped.
- **Touched:** `outboxRepo.groupReplayable` (replay parked), SyncStatusBadge/engine dbg logs
- **Follow-ups:** Open Attention badge ? syncNow should clear parked RWD after surface map.

### 2026-08-02 ? RWD parked sync verified fixed

- **Evidence:** saveRwd `rwd insert ok` coil 9100014760 entryIds 9+10 surface B; DB rows weight 3.700.
- **Kept:** surface seed + mapPlanSurfaceToCode; `groupReplayable` replays parked.
- **Touched:** stripped agent logs from ProductionService, SyncStatusBadge, engine.

### 2026-08-02 -- PKL order line (txn.pkl_order) v1

- **Goal:** Own PKL lifecycle table like HRS/RWD (coil_no key, single line + mother_coil_no/slit_id).
- **Touched:** migration `19560000000000_pkl_order.js`, `PklOrderService.ts` (copied from `HrsOrderService.ts`, no order-lines), `pklOrderRoutes.ts` (copied from `hrsOrderRoutes.ts`), `app.ts` (`/pkl-order` route + idempotency), `ProcessStationService` (new PKL `getQueue`/`startCoil`/`holdCoil` branches; removed now-unreachable PKL prefill block in the generic journey loop that caused a `tsc` narrowing error), `processStore.ts` (`/pkl-order/queue` branch), `db-types.ts` (`TxnPklOrder`, `pkl_order_id` on `TxnStoppage`).
- **Decisions / skipped:** `ensureOrder` sets `mother_coil_no` from `coil.coil.parent_coil_no` and `slit_id` via `parseCoilIdentity(coilNo)` (from `rwdFieldMappers`), stored on insert only (not re-derived on read). No `orderLines`/`combination`/`lineCount` -- PKL is single-line only, unlike HRS.
- **Verify:** `tsc` clean; migration `19560000000000_pkl_order` applied (table + stoppage `pkl_order_id` + order_kind PKL).
- **Follow-ups:** Runtime-verify `/pkl-order/queue` via ProcessHub PKL; then wire hubs; hook savePkl ? endProduction later.

### 2026-08-02 ? PKL queue runtime verify instrumentation

- **Goal:** Prove GET `/pkl-order/queue` + ensureOrder + client map (session `9b6463`).
- **Touched:** `pklOrderRoutes.ts`, `PklOrderService.ts`, `processStore.ts` (dbg fetch only).
- **Hypotheses:** A journey?cards; B ensureOrder insert/existing; C route auth; D client map.
- **Follow-ups:** User open PKL process queue; strip logs after proof.

### 2026-08-02 ? PKL verify blocked by stale server

- **Goal:** Runtime-verify `/pkl-order/queue`.
- **Evidence:** No `debug-9b6463.log`; server showed `Port 3005 is already in use` after instrumentation reload.
- **Touched:** dual-write agentLog; MH PKL/HRS ? `/pkl-order/queue` / `/hrs-order/queue`; freed 3005; restarted server.
- **Follow-ups:** Re-run PKL ProcessHub or MH Live queue load.

### 2026-08-02 ? PKL verify: UI path not exercised

- **Evidence:** A/B confirmed via `PklOrderService.getQueue` (2 cards, ensureOrder create then existing). No C/D logs after user Proceed ? UI never called `/pkl-order/queue`. Route mount proven with unauthenticated `401`.
- **Touched:** pre-auth agentLog on `pklOrderRoutes` queue; MH already points at `/pkl-order/queue`.
- **Follow-ups:** User open `/machine-head/pkl/live` specifically; then strip logs.

### 2026-08-02 ? Strip session 9b6463 debug instrumentation + verify HRS/PKL queue wiring

- **Goal:** Remove all debug-session `9b6463` instrumentation (agentLog helpers, `fetch` ingest calls, `appendFileSync` debug writes) left over from the PKL queue runtime verification, while keeping the functional MH queue path fix (PKL ? `/pkl-order/queue`, HRS ? `/hrs-order/queue`).
- **Touched:**
  - `packages/server/src/services/PklOrderService.ts` ? removed `agentLog` fn + 4 call sites + unused `node:fs`/`node:path` imports (neither used elsewhere in file).
  - `packages/server/src/routes/pklOrderRoutes.ts` ? removed `agentLog` fn + 4 call sites + unused `node:fs`/`node:path` imports; `/queue` handler back to plain try/catch.
  - `packages/client/src/store/processStore.ts` ? removed one debug `fetch(...)` ingest call in PKL branch of `loadQueueFor`.
  - `packages/client/src/pages/machinehead/pkl/PklMhLiveDashboard.tsx` ? removed one debug `fetch(...)` ingest call in `reload()`.
- **Decisions / skipped:** Ran a repo-wide grep for `9b6463|agentLog|debug-9b6463|ingest/2f15192a` after edits ? zero remaining matches, so no other files needed cleanup. For part 2 (wire hubs), grepped `stations/pkl|stations/hrs|hrs-order|pkl-order` across `packages/client` ? the only queue-loading call sites are `processStore.ts` (`HRS`?`/hrs-order/queue`, `PKL`?`/pkl-order/queue`, all other codes still correctly fall back to `/stations/${code}/queue`) and `PklMhLiveDashboard.tsx`'s shared `ProcessLineLiveDashboard` (handles both HRS and PKL lines already). `ProcessHub.tsx` already calls `processStore.loadQueueFor` ? left untouched. Remaining `/stations/pkl/...` calls (chart, chart-config, spec-limits, shift-review, shift-metrics, entry) are non-queue endpoints, out of scope, left as-is. No wiring gaps found ? everything needed was already in place from prior work.
- **Follow-ups:** None. `tsc`/build clean for both `packages/server` and `packages/client`.

### 2026-08-02 ? HRS/PKL post-fix queue verify

- **Evidence:** health 200; `/pkl-order/queue` + `/hrs-order/queue` return 401 unauth (mounted); `PklOrderService.getQueue` count=2 (PKL-COIL-001/002); `HrsOrderService.getQueue` count=2 (HRS-COIL-001 PREPARING, HRS-COIL-002 PENDING).
- **Status:** RWD/HRS/PKL order-line parity + hub queue wiring confirmed; dbg already stripped.
- **Follow-ups:** optional capture?endProduction hooks when requested.

### 2026-08-02 ? RWD capture full-width

- **Goal:** Rewinding capture looked like a centered modal (`max-w-4xl mx-auto`).
- **Touched:** `TwoHiRewindingCapturePage.tsx` (drop max-w centering; full-width shell), `RwdTensionForm.tsx` (drop observed-thk 80% cap).
- **Follow-ups:** User reopen RWD capture; strip size dbg log after confirm.

### 2026-08-02 ? RWD capture fullscreen verified

- **Evidence:** root `w=1472` / `vw=1528` ratio `0.963` (session 9b6463).
- **Kept:** drop `max-w-4xl mx-auto` on `TwoHiRewindingCapturePage`; full-width observed thickness.
- **Touched:** stripped size dbg ref/fetch from capture page.

### 2026-08-02 ? RWD start blocked by machine_allocated=false

- **Evidence:** batch `2005636838` `machine_code=RWD` but `machine_allocated=false`; sibling `2005636836` allocated true.
- **Fix:** `RewindingOrderService.startProduction` auto-`allocateMachine` when machine_code already RWD/2HI.
- **Follow-ups:** User retry Start on that coil; strip dbg after proof. 401s = session ? re-login if they persist.

### 2026-08-02 ? RWD auto-alloc start verified

- **Evidence:** `startProduction('2005636838')` ? `IN_PROGRESS`; `machine_allocated` flipped true (UI run had no server hit / still PENDING before smoke).
- **Kept:** auto-allocate when machine_code already RWD/2HI.
- **Touched:** stripped startProduction dbg fetch.

### 2026-08-02 ? RWD hub 401 race + stoppage 400

- **Evidence:** console ? SuperTokens init then OperatorShell fires `/rewinding/queue` 401; later `/6hi/master/stoppage-categories` 400 `machine param required` on RWD path.
- **Fix:** `ProtectedRoute` waits for `session.loading` / redirects if no ST session; GET stoppage-categories + defect-codes drop `requireSixHi` (still behind `requireAuth`).
- **Follow-ups:** User hard-refresh + login; strip dbg after confirm.

### 2026-08-02 ? Auth 401 / stoppage 400 verified

- **Evidence:** ProtectedRoute gate `loading=false exists=true hasToken=true`; unauth `GET /6hi/master/stoppage-categories` ? `401` (not 400 machine param).
- **Kept:** session gate in `ProtectedRoute`; master stoppage/defect GETs without `requireSixHi`.
- **Touched:** stripped dbg logs.

### 2026-08-02 ? RWD 401 persists: attach Bearer explicitly

- **Hypothesis:** ST session context exists but `Authorization` missing on `/api/*` (header-mode).
- **Touched:** `apiClient.apiFetch` sets `Bearer` from `Session.getAccessToken()`; `ProtectedRoute` requires `doesSessionExist` always; restarted API on 3005.
- **Follow-ups:** User re-login + open RWD capture; check debug logs for `accessTokenPresent`.

### 2026-08-02 ? RWD 401 Bearer fix verified

- **Evidence:** `pre-fetch auth` `/shifts/current` `accessTokenPresent=true` `hasAuthHeader=true`; no `got 401` entries.
- **Kept:** explicit `Authorization: Bearer` in `apiClient`; `ProtectedRoute` requires live ST session.
- **Touched:** stripped auth dbg ingest logs.

### 2026-08-02 ? 401: ST interceptor stripped Bearer on /api

- **Hypotheses:** H2 ST deletes matching Authorization on intercepted /api fetch; retry reused stale token; H3 API_DOMAIN was `:3005` while browser uses `:3000`.
- **Fix:** `shouldDoInterceptionBasedOnUrl` only for `/auth`; `apiClient` re-attaches Bearer+`st-auth-mode` each `doFetch` (post-refresh); `API_DOMAIN=http://localhost:3000`.
- **Follow-ups:** Full page reload required (supertokens init once); re-login; strip dbg after proof.

### 2026-08-02 ? Auth 401 verify round (API restarted)

- **Goal:** Confirm H2/H3 after interceptor + API_DOMAIN fix with clean runtime logs.
- **Touched:** restarted `@m1/server` on :3005; dbg still in `apiClient.ts`, `authMiddleware.ts`.
- **Decisions / skipped:** No new code fix until log proof; Redis ECONNREFUSED ignored (memory fallback).
- **Follow-ups:** Hard reload + re-login + open RWD hub; compare client `attached/hasAuth` vs server `hasAuth`/nosession.

### 2026-08-02 ? Auth 401 log analysis (partial)

- **Evidence:** only `/shifts/current`: client `attached/hasAuth=true`, server `Bearer` + `stMode=header`, status **200**; no `nosession`, no `/rewinding/queue`.
- **H1/H2/H3/H5:** rejected for observed traffic; RWD path not exercised.
- **Touched:** `processStore.ts` RWD load start log; `apiClient` always logs status (`auth-401d`).
- **Follow-ups:** targeted RWD hub reproduce.

### 2026-08-02 ? RWD auth 401 verified fixed; stripped dbg

- **Evidence:** `/rewinding/queue?machine=RWD` + `/shifts/current` `status:200` with `Bearer` + `stMode=header`; zero `401`/`nosession`.
- **Kept:** `apiClient` Bearer+`st-auth-mode` each doFetch; ST intercept only `/auth`; `API_DOMAIN=http://localhost:3000`.
- **Touched:** stripped ingest from `apiClient.ts`, `authMiddleware.ts`, `processStore.ts`.

### 2026-08-02 ? RWD combine order UI (6HI parity)

- **Goal:** Combine-order selection + start on RWD hub like 6HI.
- **Touched:** `rwdSiblingSelect.ts`, `ProcessHub.tsx`, `ProcessQueueRow.tsx`, `ProcessQueueDetailPanel.tsx`, `processStore.ts` (surface/combined fields), `TwoHiRewindingCapturePage.tsx`.
- **Decisions / skipped:** Server `start-combined` already existed; 2HI Rewinding hub combine UI deferred; full CombinedProductionOrdersPanel deferred (badge + cascade end only).
- **Follow-ups:** Wire TwoHiRewindingHub if operators need combine there too.

### 2026-08-02 ? RWD cancel-combine + 2HI hub combine

- **Goal:** Cancel Combined Order (6HI parity) + wire combine on TwoHiRewindingHub.
- **Touched:** `ProcessHub.tsx` (cancel btn + floating bar), `TwoHiRewindingHub.tsx`, `rwdSiblingSelect.ts` (generic + status groups).
- **Skipped:** Full CombinedProductionOrdersPanel on capture.

### 2026-08-02 ? RWD lifecycle audit (start?complete)

- **Goal:** Analyse working RWD order path end-to-end.
- **Touched:** canvas `rwd-lifecycle-audit.canvas.tsx` (analysis only).
- **Findings:** Save (`/production/rwd`) ? End; combine + cascades live; ProcessHub collapses PREPARING/STOPPAGE; `captureRwdOrder` unused.
- **Follow-ups:** Optional ? restore raw statuses on ProcessHub; wire or delete PATCH capture.

### 2026-08-02 ? Fix RWD ProcessHub status collapse

- **Goal:** Keep raw PREPARING / STOPPAGE / REJECTED on RWD hub (audit High finding).
- **Touched:** `processStore.ts` (`mapRwdQueueStatus`), `ProcessHub` filters + startable, `ProcessQueueRow`/`DetailPanel` labels, `ProcessStationService` RWD map.
- **Skipped:** Save?End merge (still separate rail End); dead PATCH capture.

### 2026-08-02 ? Audit RWD timer / running vs idle mismatch

- **Goal:** Analyse missing timer on reopen + Live says running / capture says not.
- **Touched:** canvas `rwd-timer-state-audit.canvas.tsx` (analysis only).
- **Findings:** RWD Start only updates capture-page local state; `processStore` stays idle; Live Status Open Form goes to `/capture` not `/rewinding`; reopen resets status to PENDING until `refreshOrder`.
- **Follow-ups:** Hydrate store or unify RWD paths; fix Live open URL.

### 2026-08-02 ? Fix RWD timer / running-state split

- **Goal:** One clock for RWD Start + Live Status + reopen.
- **Touched:** `processStore.hydrateRwdRun`, `TwoHiRewindingCapturePage` (sync on refreshOrder/end/hold), `ProcessLayout` (no dual rail on `/rewinding/`), `ProcessLiveStatusPage` (open `/rewinding` + hydrate from order), `StatusRail` (Idle/Running from captureStatus).
- **Skipped:** Saving prodStartAt on queue DTO.

### 2026-08-02 ? Finish RWD Idle/Running rail parity

- **Goal:** Close remaining Idle vs Running / wrong-batch reopen gaps after timer audit.
- **Touched:** `ProcessLayout.tsx` (hideShellRail for all RWD), `ProcessLiveStatusPage.tsx` + `RwdMhLiveDashboard.tsx` + `TwoHiRewindingHub.tsx` (pass `orderStatus` on navigate), prior hydrate/batch-pick already in place.
- **Decisions / skipped:** Server AutoSource IN_PROGRESS preference still deferred; Save?End merge deferred.
- **Follow-ups:** Operator verify Start ? leave ? reopen shows End + Running + live timer.

### 2026-08-02 ? Full RWD audit (bugs / endpoints / gaps)

- **Goal:** Ranked audit of RWD/2HI rewinding for bugs, functionality errors, endpoint issues (no fixes).
- **Touched:** read-only ? `rewindingRoutes`, `RewindingOrderService`, `RwdTensionForm`, `TwoHiRewindingCapturePage`, `ProcessHub`, `RwdMhLiveDashboard`, `PPCImportService`, plans.
- **Decisions / skipped:** Highest risk = Save via `/production/rwd` without completing `rwd_order`; RWD hub Manual ? stations API (no `rwd_order`); import safety ignores `rwd_order`/`prod_rwd`. No code changes.
- **Follow-ups:** Wire Save?order capture/end; ProcessHub Manual?`/rewinding/orders/manual`; MH 2HI desk; import safety; Forbidden?403.

### 2026-08-02 ? Fix all RWD audit issues

- **Goal:** Close critical/high/medium RWD bugs from full audit (capture complete, manual, import safety, auth, MH 2HI, hubs, handover).
- **Touched:** `RwdTensionForm`, `TwoHiRewindingCapturePage`, `ProcessHub`, `rewindingWrites`, `rewindingRoutes`, `RewindingOrderService`, `PPCImportService`, `ProcessStationService`, `SixHiQueueService`, `RwdMhLiveDashboard`, `rwdMhDesk`, `MachineHeadNav`, `ScopeHandoverRoute`, `HrsOutgoingHandoverPage`, `RwdOutgoingHandoverPage`, `SixHiLayout`, `classifyHandoverBranch`, e2e `rwd-operator.spec.ts`, tests.
- **Decisions / skipped:** Save uses `PATCH ?/capture` (complete). 2HI queue = `machine_code=2HI` only (assign from RWD/MH). No `prod_rwd.machine_code` column migration. No FOR UPDATE locks (txn re-check only). Combined history panel still deferred. Remark rail opens Hold.
- **Follow-ups:** Smoke Start?Save?queue COMPLETED; Manual on RWD hub; MH toggle RWD?2HI stays on `/machine-head/rwd/live`.

### 2026-08-02 ? New-Lines audit implementation (HRS/PKL/ANN/RWD)

- **Goal:** Execute `doc/ZEDRAL_NEWLINES_AUDIT_AND_PLAN_2026-08-02.md` Sprint 1+2: handover shell, RWD body, order-end/reject, COMPLETED read-only, lean MH desks, history APIs+UI, mhDesk/sibling unify, lifecycle/journey tests.
- **Touched:** `ProcessOutgoingHandoverShell.tsx`, `Hrs/Pkl/Ann/RwdOutgoingHandoverPage`, `ProcessLayout` (OrderEndModal + OrderRejectionModal), `CaptureWorkspace` (COMPLETED RO + Production Console), `classifyOperatorNav` + `OperatorNavRail`, `HrsMhCoilDetailPage`, `RwdMhCoilDetailPage`, `MhLiveEntry` (`resolveMhDesk`), `ProcessOperatorHistoryPage`, `ProcessStationService` history/readings, `orderLifecycleHelpers` heal/reject/stoppage gates, `siblingSelect.ts`, `mhDesk.ts`, tests.
- **Decisions / skipped:** CRS/CTL handover out of scope; T16 crew UI consolidate deferred; no CRM `REWINDING` seed drop; ANN handover chrome simplified onto shared shell; gold END SHIFT rule preserved.
- **Follow-ups:** Manual walk import?Start?Stoppage?End?handover?timeline; MH sole-RWD `/live` lands on RWD desk; History tabs on HRS/PKL/RWD.

### 2026-08-02 ? New-Lines follow-up (T16 + RWD End/Reject)

- **Goal:** Close deferred T16 crew UI + RWD capture End/Reject parity (shell rail hidden on RWD).
- **Touched:** `CrewCaptureModal.tsx` (optional `onConfirm`), `CaptureWorkspace.tsx` (shared crew modal; COMPLETED closes panels), `TwoHiRewindingCapturePage.tsx` (`OrderEndModal` + `OrderRejectionModal`; COMPLETED read-only).
- **Decisions / skipped:** Process crew still POSTs `/crew` (shiftLogId) via modal override ? not `/crew/attach` (session). CRS/CTL still out of scope.
- **Follow-ups:** Manual smoke RWD End confirm ? COMPLETED; process crew roster confirm on HRS/PKL.

### 2026-08-03 ? Sync outbox skip without session

- **Goal:** Stop POST `/api/stoppages` 401 noise after DB/ST restart (outbox boot replay).
- **Touched:** `packages/client/src/lib/sync/engine.ts`
- **Decisions / skipped:** Guard `pushOutbox` with SuperTokens `doesSessionExist`; pending rows kept for post-login retry. Re-login if ST session died after container recreate.
- **Follow-ups:** Log in again; queued stoppage should sync after auth.

### 2026-08-03 ? Fix operator badge/PIN login (header-mode tokens)

- **Goal:** Operator login appeared to succeed then bounced ? ST never saved session tokens.
- **Touched:** `packages/client/src/lib/supertokens.ts`, `packages/client/src/pages/Login.tsx`
- **Decisions / skipped:** Badge-pin now `fetch('/auth/badge-pin')` (matches apiBasePath); interceptor also forces `/api/auth`. Backend badge-pin was already 200.
- **Follow-ups:** Hard-refresh login; badge `3000` / PIN `1234`.

### 2026-08-03 ? Operator login interceptor relative-URL fix

- **Goal:** Badge/PIN still bounced to session=expired while staff email worked.
- **Touched:** `packages/client/src/lib/supertokens.ts`, `packages/client/src/pages/Login.tsx`
- **Decisions / skipped:** Relative `/auth/badge-pin` made original domain normaliser throw; override catch returned false so tokens never saved. Now pass absolute href; login fetch uses `window.location.origin`.
- **Follow-ups:** Hard-refresh (full reload) login page; badge 3000 / PIN 1234.

### 2026-08-03 ? Fix parked RWD /stoppages Forbidden (solid)

- **Goal:** Sync Attention `POST /stoppages` Forbidden line RWD; audit PKL stoppage path.
- **Touched:** `processStore.ts` (removed legacy `/stoppages` outbox fallback), `outboxPolicy.ts`, `outboxRepo.ts`, `processStationRoutes.ts` (shift process must match station), `outboxPolicy.test.ts`
- **Decisions / skipped:** Root cause = legacy closed-interval POST against shift 42 (RWD) when start never returned id; operator 3000 has no RWD. PKL/HRS already use `/stations/{code}/stoppages/start|end` ? leave pkl-order stoppage APIs unused by CaptureWorkspace (YAGNI).
- **Follow-ups:** Hard-refresh; Attention should clear on next sync via benign line-Forbidden drop.

### 2026-08-03 ? HRS capture zero-width outbox root fix

- **Goal:** Parked `POST /production/hrs` Invalid payload (actualWidthMm / motherWidthReadings widthMm > 0).
- **Touched:** `HrsSlitBuilder.tsx`, `processStore.submitProcessCapture` (schema gate), `outboxPolicy.ts` (+test), `hrsFanOut.test.ts`
- **Decisions / skipped:** Root = `motherWidth || 0` / `Number('')` seeding zero readings into outbox. Omit zeros; validate before queue; drop Invalid production payload as benign for stuck parks.
- **Follow-ups:** Hard-refresh; re-save HRS with width > 0 (or omit readings); Attention clears on sync.

### 2026-08-03 ? HRS/PKL rail stoppage timer hydration (plan)

- **Goal:** Implement `doc/ZEDRAL_HRS_PKL_RAIL_STOPPAGE_TIMER_FIX_PLAN.md` ? server-driven rail/gate/timer for HRS/PKL.
- **Touched:** `processStore.ts` (un-squash STOPPAGE, `hydrateProcessRun`, resume clock, order-linked stoppage), `hrsPklWrites.ts`, `ProcessLiveStatusPage.tsx`, `ProcessLayout.tsx`, `processStationRoutes.ts` (HRS/PKL stoppage ? order services), `hrsOrderRoutes`/`pklOrderRoutes` GET line auth, `hydrateProcessRun.test.ts`
- **Decisions / skipped:** Station stoppage start/end delegates to Hrs/PklOrderService when `coilNo` set (line auth + order link). RWD hydrate path unchanged via alias. ProductionActionRail already had Manage-Stop label.
- **Follow-ups:** Manual smoke Start?refresh?End; Stoppage?refresh?Resume; run timer continuous after resume.

### 2026-08-03 ? HRS End 400 / cannot complete order (root fix)

- **Goal:** Fix HRS `POST /production/hrs` 400 noise + End not completing orders; stoppage/reject auth for line operators.
- **Touched:** `hrsOrderRoutes.ts`, `pklOrderRoutes.ts` (machine ? line ACL), `productionRoutes.ts` (coerce shiftLogId; endProduction after HRS/PKL save), `HrsSlitBuilder.tsx`, `PklCoilForm.tsx`
- **Decisions / skipped:** Rail End only wrote `prod_hrs` ? never called `HrsOrderService.endProduction`. Badge ops had line WRITE but order routes used machine ACL (Forbidden). Open stoppage still blocks end (by design).
- **Follow-ups:** Hard-refresh; Resume any open stoppage before End; parked zero-width outbox drops as benign Invalid payload.


### 2026-08-03 ? HRS operator deep gap analysis + handover ACL

- **Goal:** Deep HRS operator gap analysis; probe every feature; fix remaining blockers so End/stoppage/handover work for line operators.
- **Touched:** `machineHandoverRoutes.ts` (process codes ? line WRITE), `machineHandoverService.ts` (ensureSession lineAccess), `productionRoutes.ts` (preflight open stoppage before save), canvas `hrs-operator-gap-analysis.canvas.tsx`
- **Decisions / skipped:** Root stack = dual ACL + End never completed order + transient rail + zero-width outbox. UI Manage-Stop update still local-only; crew/defect not API-probed.
- **Follow-ups:** Browser smoke Start?refresh?Stop?Resume?End; keep manual coilNo =30 chars.


### 2026-08-03 ? Import fail-safe + journey dedup

- **Goal:** Implement `doc/ZEDRAL_IMPORT_FAILSAFE_AND_DEDUP_PLAN.md` ? idempotent per-line import against journey advance.
- **Touched:** `ProcessRouteService.ts` (A1 upsert, A2 link guard), `195700?_order_journey_unique_active_coil.js`, `PPCImportService.ts` (A3/A4 + line scope), `previewSessionStore.ts`, `sixHiRoutes.ts`, `PpcRollingImportPanel.tsx`, `LineMhImportPage.tsx`, MH nav/App routes, `importFailsafeDedup.test.ts`
- **Decisions / skipped:** SUPERVISOR stays on plant-wide PPC; line-scoped path uses `assertLineOperation(WRITE)`. HRS/PKL import filters rolling sheet by route token S/P. Concurrent createJourney covered by partial unique + upsert (no separate stress test).
- **Follow-ups:** Run migration `195700?`; smoke MH Import on HRS/PKL/RWD with an advanced coil (expect advanced-skipped).

### 2026-08-03 ? LineMhImportPage import depth

- **Goal:** Fix Vite resolve failure ? file lives at `pages/machinehead/`, not `ann/`.
- **Touched:** `LineMhImportPage.tsx` only (`../../../` ? `../../` on shell/card/panel/authStore)
- **Decisions / skipped:** Matched sibling depth (`MachineHeadCrewPage`, `RwdMhLiveDashboard`). No moves, no alias, no other files.
- **Follow-ups:** None.

### 2026-08-03 ? RWD lifecycle audit gaps

- **Goal:** Close remaining findings from RWD lifecycle audit (Save?End, orphan CaptureWorkspace, dead 6hi queue).
- **Touched:** `RwdTensionForm.tsx` (`complete: false`), `TwoHiRewindingCapturePage.tsx` (Save stays on page), `ProcessCapturePage.tsx` (RWD ? `/rewinding/`), `CaptureWorkspace.tsx` (strip RWD chrome), `SixHiService.ts` (delete dead `getRewindingQueue`), `RewindingOrderService.ts` (ponytail note on combined prod_rwd).
- **Decisions / skipped:** Status collapse / stoppage onUpdate / 6hi queue delegate already fixed. Combined sibling `prod_rwd` weight split deferred. End-without-save still allowed (rail End). Stations RWD queue DTO unused ? left alone. No HRS/PKL/ANN/6HI behavior changes.
- **Follow-ups:** Smoke Start ? Save (stays IN_PROGRESS) ? End ? COMPLETED; optional combined weight split later.


### 2026-08-03 ? HRS/PKL audit plan Phases 1?3

- **Goal:** Implement `doc/audit/HRS_PKL_AUDIT_AND_PLAN.md` (operator bleed, start rollback, completion unify, SWR queue, dead endpoints, doc).
- **Touched:** `processStore.ts`, `useProcessHubQueue.ts`, `ProcessHub.tsx`, `ProcessLayout.tsx`, `ProcessLiveStatusPage.tsx`, `HrsSlitBuilder.tsx`, `PklCoilForm.tsx`, `ProcessStationService.ts`, `hrsOrderRoutes.ts`, `pklOrderRoutes.ts`, `PROJECT_STRUCTURE.md`, `processStoreHrsPklFixes.test.ts`
- **Decisions / skipped:** `resetForLine` fired from `ProcessLayout` (sync) not `authStore` ? static import cycles via `apiClient`. ?4.7 pattern converge deferred. Body Save ? `requestEndConfirm` ? same `OrderEndModal` as rail End.
- **Follow-ups:** Manual smoke HRS?PKL switch, double-start conflict banner, complete-from-body vs rail, two-terminal queue freshness (~15s).

### 2026-08-03 ? RWD/2HI audit G1?G7

- **Goal:** Implement doc/audit/RWD_2HI_REWINDING_AUDIT_2026-08-03.md fix order G1?G7 (no Skin Pass / other-line changes).
- **Touched:** RewindingOrderService.ts (G1 combined prod_rwd split, G2 End requires prod_rwd, G5 plan detail, G7 capture fields), 
ewindingRoutes.ts, RwdTensionForm.tsx (G3 surface toggle), 
ewindingWrites.ts (G4 patchQueued), RwdMhLiveDashboard.tsx (G6 alloc modal), RwdMhCoilDetailPage.tsx, TwoHiRewindingCapturePage.tsx, 
ewindingOrderLifecycle.test.ts
- **Decisions / skipped:** G8 dead 2HI_REWINDING seed left (FK risk). G9 manual always-allocated kept (modal forces machine). Combined Save weight = group total.
- **Follow-ups:** Smoke Start?Save?End; End without Save shows error; MH pending card detail; MTP unallocated ? RWD|2HI picker.

### 2026-08-03 ? Import gaps remediation (F1?F6)

- **Goal:** Implement `doc/ZEDRAL_IMPORT_GAPS_REMEDIATION_PLAN_2026-08-03.md`.
- **Touched:** `PPCImportService.ts` (`checkCoilSafetyForLine` + preview unify), `ProcessRouteService.ts` / `QueueTransferService.ts` (advanceJourney trx), `pklMhDesk.ts` / `MachineHeadNav.tsx` / `mhDesk.ts` (F4), `App.tsx` (F5 bare MH routes), tests.
- **Decisions / skipped:** F3 = code already in tree (no git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" unless asked). SUPERVISOR keeps plant-wide `/import/rolling`; line import routes are MH-only. CRS/CTL still out of scope.
- **Follow-ups:** Smoke four MH Import desks; git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" when ready.

### 2026-08-03 ? ANN brand/UI alignment (operator + MH)

- **Goal:** Apply Brand + UI/UX guidelines to ANN operator and machine-head surfaces only (presentation); no API/behavior changes.
- **Touched:** `AnnChargePage.tsx`, `AnnChargeBoard.tsx`, `AnnBatchesPanel.tsx`, `AnnBaseCard.tsx`, `AnnOperatorHistoryPage.tsx`, `AnnOutgoingHandoverPage.tsx`, `AnnMhLiveDashboard.tsx`, `AnnMhChargeDetailPage.tsx`, `AnnMhTrendsPage.tsx`, `AnnMhBatchingPage.tsx`
- **Decisions / skipped:** Green capture header + meta grid on charge page; Clear no longer gold; ZFilterPills on Bases/MH Live; ZBadge PENDING=accent; chart colors ? CSS tokens. Did not rewire ANN into CaptureWorkspace/ProductionActionRail (archetype B). Import/Specs left as thin shared shells. CRM untouched.
- **Follow-ups:** Next machine line when requested (HRS/PKL/RWD/CRS). Smoke Bases ? charge save/stoppage; MH Live ? detail ? trends.

### 2026-08-03 ? HRS/PKL/RWD brand/UI alignment

- **Goal:** Continue ANN-style presentation-only brand/UI alignment for HRS, PKL, RWD (shared chrome + line surfaces). No API/behavior changes.
- **Touched:** `ProcessLiveStatusPage.tsx`, `ProductionActionRail.tsx`, `ProcessQueueRow.tsx`, `CaptureWorkspace.tsx`, `ProcessOperatorHistoryPage.tsx`, `ProcessHub.tsx`, `HrsSlitBuilder.tsx`, `PklCoilForm.tsx`, `RwdTensionForm.tsx`, `PklMhLiveDashboard.tsx`, `RwdMhLiveDashboard.tsx`, handover pages (radius)
- **Decisions / skipped:** Gold CTAs ? primary; HOLD rail = accent gold (allowed); PENDING/HOLD ? ZBadge accent; chart hex ? CSS tokens; CRM 6HI/4HI/2HI untouched. Coil-detail pages left (already token-clean). CRS/CTL not started.
- **Follow-ups:** CRS/CTL when requested; smoke HRS/PKL capture + rail; RWD MH filters + MTP.

### 2026-08-03 ? 2HI rewinding brand/UI check + polish

- **Goal:** Audit 2HI rewinding vs brand guidelines; close presentation gaps vs RWD without touching frozen CRM mill chrome.
- **Touched:** `TwoHiRewindingHub.tsx`, `TwoHiRewindingCapturePage.tsx`, `RewindingMachineAllocationModal.tsx`, `RewindingManualOrderModal.tsx`, `RwdMhCoilDetailPage.tsx`
- **Decisions / skipped:** 2HI operator stays in SixHiLayout (CRM shell frozen). Shared capture/rail/MH live already OK from RWD pass. PENDING=accent; IN_PROGRESS=success; Combined?ZBadge; modals?ZButton/tokens. No ProcessLayout move.
- **Follow-ups:** Smoke 2HI tab=rewinding ? assign ? capture; MH focus 2HI live ? coil detail title.

### 2026-08-03 ? 2HI Rewinding hub filters

- **Goal:** Add missing operator filters (status + date) on 2HI Rewinding tab; confirm queue fetch.
- **Touched:** TwoHiRewindingHub.tsx (ZFilterPills All/Pending/In Progress/Hold/Completed + plan-date picker; always fetch /rewinding/queue?machine=?), TwoHiRewindingCapturePage.tsx (End ? ?tab=rewinding&status=COMPLETED).
- **Decisions / skipped:** Queue fetch was already wired (machine=2HI); empty list means no rows with machine_code=2HI (assign via RWD MTP or import Machine=2HI). Date filters client-side on planDate (API has no date param). Skin Pass unchanged.
- **Follow-ups:** Smoke 2HI Rewinding tab filters + Completed after End.

### 2026-08-03 ? 2HI Rewinding filter row layout

- **Goal:** Put status pills beside the search bar (same row).
- **Touched:** `TwoHiRewindingHub.tsx` only.
- **Decisions / skipped:** None.
- **Follow-ups:** None.

### 2026-08-03 ? 2HI Rewinding In Progress pill

- **Goal:** Ensure In Progress status pill is visible; match Skin Pass filter set.
- **Touched:** `TwoHiRewindingHub.tsx` ? filters All/Pending/Preparing/In Progress/Completed/Order Hold; search row no longer `w-full` so pills sit beside search.
- **Decisions / skipped:** PREPARING is its own pill (parity with SixHi Skin Pass). STOPPAGE still buckets under In Progress.
- **Follow-ups:** None.

### 2026-08-03 ? Remove duplicate Manual Order on 2HI Rewinding

- **Goal:** Drop header Manual Order button; nav already opens RewindingManualOrderModal via SixHiLayout.
- **Touched:** `TwoHiRewindingHub.tsx` only.
- **Decisions / skipped:** None.
- **Follow-ups:** None.

### 2026-08-03 ? RWD hub parity with 2HI Rewinding filters

- **Goal:** Apply 2HI Rewinding hub UX edits to RWD ProcessHub.
- **Touched:** `ProcessHub.tsx` (RWD: Preparing+In Progress pills, plan-date filter, hide Manual Add ? nav only), `processStore.ts` (`PREPARING` filter type + `planDate` on RWD queue cards).
- **Decisions / skipped:** HRS/PKL filter buckets unchanged. RWD Manual still opens via side-nav `requestManualCoil`.
- **Follow-ups:** Smoke RWD filters + date + nav Manual.

### 2026-08-03 ? RWD hub parity with 2HI Rewinding filters

- **Goal:** Apply 2HI Rewinding hub UX edits to RWD ProcessHub.
- **Touched:** ProcessHub.tsx (RWD: Preparing+In Progress pills, plan-date filter, hide Manual Add), processStore.ts (PREPARING filter + planDate on RWD cards).
- **Decisions / skipped:** HRS/PKL filter buckets unchanged. RWD Manual via side-nav only.
- **Follow-ups:** Smoke RWD filters + date + nav Manual.

### 2026-08-03 ? PKL MH Specs relocation + Pickling import

- **Goal:** Keep PKL Specs under Machine Head (not Admin chrome/URL); restrict PKL MH Import to dedicated `PICKLING` sheet type.
- **Touched:** `App.tsx`, `MachineHeadNav.tsx`, `PklSpecAdmin.tsx`, `rollingPlanXlsxParser.ts`, `adminService.ts`, `PPCImportService.ts`, `sixHiRoutes.ts`, `LineMhImportPage.tsx`, `PpcRollingImportPanel.tsx`, `rollingPlanXlsxParser.test.ts`, `importFailsafeDedup.test.ts`
- **Decisions / skipped:** No `PICKLING` type existed; mirrored ANN `ANNEALING` (reuse `parseRollingPlanXlsx`). PICKLING rejects non-matching sheet names (no first-sheet fallback). `/admin/pkl-specs` redirects to `/machine-head/pkl/specs`. Coil-key Batch vs Mother Coil left unchanged.
- **Follow-ups:** Smoke PKL Specs + Import in MH UI; plant import can select PKL Pickling Plan.

### 2026-08-03 ? Fix 401 on PPC import (header-mode auth)

- **Goal:** Fix PKL MH Import preview 401; same bug on all raw-fetch PPC/import/export paths.
- **Touched:** `apiClient.ts` (async `getAuthHeaders` attaches Bearer), `adminService.ts`, `validationConfigService.ts`, `ExportHistory.tsx`, `ExportJobPanel.tsx`
- **Decisions / skipped:** Root cause was SuperTokens `tokenTransferMethod: 'header'` + ST skipping `/api/*` interception; empty `getAuthHeaders()` sent no Authorization. Not caused by PICKLING sheet type.
### 2026-08-03 ? PKL Operator Capture / chart / Manual Stop / Shift Summary

- **Goal:** PKL operator UX: Capture nav rename, chart sectioned form, Manual Stop top bar, Shift Summary on Capture.
- **Touched:** `OperatorNavRail.tsx`, `PklChartGrid.tsx`, `PklOrderService.ts`, `processStationRoutes.ts`, `hrsPklWrites.ts`, `StatusRail.tsx`, `OperatorShell.tsx`, `ProcessLayout.tsx`, `ProcessLiveStatusPage.tsx`
- **Decisions / skipped:** Orders queue path verified OK (no fix). Manual stoppage PKL-only via `/stations/pkl/manual-stoppage*`. Chart save payload unchanged.
- **Follow-ups:** Smoke PKL Capture Manual Stop when idle; chart save; Shift Summary metrics.

### 2026-08-03 ? PKL chart history-first + drop interval fields

- **Goal:** History-first chart; form only on Add Reading; drop Out burner + rinse acid/iron from interval form.
- **Touched:** `PklChartGrid.tsx`, `processStationRoutes.ts`, `ProcessStationService.upsertPklChart`
- **Decisions / skipped:** DB columns kept for end-of-shift; regular upsert no longer writes those three fields.
- **Follow-ups:** End-of-shift UI for rinse acid/iron if needed.

### 2026-08-03 ? PKL chart history readable cards

- **Goal:** Replace cluttered L/T/A/I history table with labeled per-reading cards.
- **Touched:** `PklChartGrid.tsx`
- **Decisions / skipped:** Newest reading first; same data, display-only.
- **Follow-ups:** None.

### 2026-08-03 ? PKL Operator Production Console enhancements

- **Goal:** Align PKL console with Rolling: net timer, Process Route, no Time From/To, PKL-only codes, StatusRail, Orders vs Manual, status pills.
- **Touched:** `ProductionActionRail.tsx`, `ProcessStatusBanner.tsx`, `ProcessLayout.tsx`, `CaptureWorkspace.tsx`, `PklCoilForm.tsx`, `ProcessHub.tsx`, `ProcessQueueDetailPanel.tsx`, `StatusRail.tsx`, `processStore.ts`, `DefectTagSelector.tsx`, `OrderStoppageModal.tsx`, `OrderRemarkModal.tsx`, `useProcessNetTimer.ts`, `pklStoppageCodes.ts`, `hrsPklWrites.ts`, `ProcessLiveStatusPage.tsx`, `PklOrderService.ts`, `processStationRoutes.ts`
- **Decisions / skipped:** Net timer PKL-only (HRS wall); stoppage UI PKL-01..15 maps to category_code 01?16; Manual modal token consume on close; Completed queue = today's prod_date.
- **Follow-ups:** Smoke Start/stoppage/resume net timer; Completed pill; Manual reopen; defect filter.

### 2026-08-03 ? PKL console: timers, remark, shift crew

- **Goal:** Dedupe stoppage timers; fix rail Remark; Rolling-like crew prompt on PKL shift/session.
- **Touched:** `ProcessStatusBanner.tsx`, `CaptureWorkspace.tsx`, `ProcessLayout.tsx`
- **Decisions / skipped:** PKL stoppage live clock only on action rail; removed PKL STOPPAGE DETAILS box; Remark modal mounted in ProcessLayout (SixHi pattern); crew prompt PKL-only via ensureSession.
- **Follow-ups:** Smoke Remark during stoppage; crew prompt on login / after Shift End remind-later.

### 2026-08-03 ? PKL Save vs End production split

- **Goal:** Save Production persists data only; End rail + OrderEndModal is sole completion path.
- **Touched:** `PklCoilForm.tsx`, `processStore.ts` (draft schema map), `productionRoutes.ts` (`POST /pkl/draft`), `ProductionService.savePkl` (draft upsert), `CaptureWorkspace.tsx` comment
- **Decisions / skipped:** Draft upserts `txn.prod_pkl` with status IN_PROGRESS and skips `production.captured` / `endProduction`. Finalize still `POST /production/pkl`. HRS unchanged.
- **Follow-ups:** Smoke mid-run Save then rail End complete.

### 2026-08-03 ? Machine Classification for Defect Tags & Stoppage Codes

- **Goal:** Admin Master Data machine classification on defect/stoppage masters; filter production forms by current machine.
- **Touched:** `packages/server/migrations/19580000000000_stoppage_code_applies_to.js`, `MasterDataService.ts`, `PklOrderService.ts`, `SixHiService.ts`, `processStationRoutes.ts`, `sixHiRoutes.ts`, `db-types.ts`, `MasterDataAdmin.tsx`, `adminService.ts`, `DefectTagSelector.tsx`, `pklStoppageCodes.ts`, `CaptureWorkspace.tsx`, `ProcessLayout.tsx`, `SixHiLayout.tsx`, `OrderEndModal.tsx`, `OrderRejectionModal.tsx`, `OrderRemarkModal.tsx`, `shared-validation/src/utils/machineClassification.ts`
- **Decisions / skipped:** Reused `applies_to` (UI label Machine Classification) instead of a second column on defects; added `applies_to` to stoppage_code. Empty = all machines. CRM uses stoppage_category table unchanged. ANN `ann_stoppage_category` unchanged.
- **Follow-ups:** Run migration `19580000000000`; smoke Admin CRUD + PKL/HRS/6HI defect & stoppage pickers.

### 2026-08-04 ? Applied stoppage_code applies_to migration

- **Goal:** Fix Admin Stoppage Codes PUT 400 (`column applies_to does not exist`).
- **Touched:** ran `195700?` + `19580000000000_stoppage_code_applies_to` on local `m1_db`
- **Decisions / skipped:** App code was correct; migration had not been applied yet.
- **Follow-ups:** Retry Admin ? Master Data ? Stoppage Codes edit/save.

### 2026-08-04 — Fix ANN 500s + annealing PPC finishThk

- **Goal:** Unblock ANN board/bases/spec-limits (missing `master.ann_base` / `ann_spec_limit`) and ANN PPC preview (`finishThkMm` not required).
- **Touched:** `packages/server/src/utils/rollingPlanXlsxParser.ts`, `packages/server/src/services/PPCImportService.ts`, `packages/server/tests/rollingPlanXlsxParser.test.ts`; applied `1947000000000_ann_stages_readings_masters` + `19480000000000_ann_stoppage_delay_bucket` DDL on local DB (stamped in `pgmigrations`).
- **Decisions / skipped:** Did not run full `npm run migrate` — blocked by `1933000000000_quality_spec_sheet` preceding already-run `1933000000000_reintroduce_supervisor_role`. Shift-log 404 left as-is (no active ANN shift log).
- **Follow-ups:** Repair migrate order (rename/stamp quality_spec_sheet) so backlog 1940–1958 can apply cleanly; restart server if hot-reload missed parser change.
### 2026-08-04 — ANN PPC preview + shift-log + ANNE xlsx

- **Goal:** Fix ANN `/shift-logs/active` 404, PPC preview 500 (`txn.hrs_order`), align parser to `ANNE 21.07.2026.XLSX`.
- **Touched:** `PPCImportService.ts` (process-scoped coil safety), `shiftLogRoutes.ts` (auto-ensure for all lines), `rollingPlanXlsxParser.ts` (ANN finish/width combo/aliases), `rollingPlanXlsxParser.test.ts`; DB: created `txn.hrs_order`/`pkl_order`/`rwd_order`, stamped 1953/1954/1956.
- **Decisions / skipped:** Stoppage `order_kind` / `*_order_id` alters not applied (local `txn.stoppage` schema behind). Width combo `Σ(w×n)` for ANN plans.
- **Follow-ups:** Full migrate-order repair still needed for 1940–1958 backlog; add stoppage discriminator cols when HRS/PKL stoppages are used.
### 2026-08-04 — Migrate backlog + stoppage discriminator repair

- **Goal:** Apply stoppage `order_kind` / `hrs|pkl|rwd_order_id` and clear 1940–1958 migrate backlog.
- **Touched:** renamed `193301_quality_spec_sheet`, `193401_process_sheet`; normalized 14-digit migs → 13-digit (`1948`–`1958`); `repair-migration-history.mjs` (run_on realign); `scripts/gen-qss-migration.cjs`; local DB catch-up via `node-pg-migrate --check-order false` then run_on rewrite.
- **Decisions / skipped:** Kept `checkOrder` on by default; history `run_on` rewritten so name order matches.
- **Follow-ups:** none for migrate; `npm run migrate` now reports No migrations to run.
### 2026-08-04 — ANN seed data (board + batching queue)

- **Goal:** Populate annealing demo data from imported PPC queue.
- **Touched:** `packages/server/scripts/seed-process-queues.mjs` (`--ann-only` / `seedAnnOnly`), `package.json` (`seed:ann`), `seed-login-profiles.mjs`.
- **Decisions / skipped:** Reused existing seed script (UTF-8 safe on Windows); picks first 5 PPC coils for 2 charges on AB16/AB01; resets remaining queue to PENDING for batching page.
- **Run:** `npm run seed:ann -- --date=2026-08-04 --shift=A`

### 2026-08-04 — Polish ANN MH charge profile UI

- **Goal:** Improve readability and visual hierarchy for ANN machine-head charge profile.
- **Touched:** `packages/client/src/pages/machinehead/ann/AnnMhChargeDetailPage.tsx`
- **Decisions / skipped:** Kept all API calls and state logic unchanged; only presentation (skeleton loading, selected-stage highlight, operator readings layout, swipe motion smoothing).
- **Follow-ups:** If desired, apply the same visual patterns to other `AnnMh*` ANN machine-head screens.

### 2026-08-04 — Fix ANN Batching Stack column height

- **Goal:** Prevent the “Stack” (middle) panel from stretching to match “Incoming orders”; make each column size/scroll independently.
- **Touched:** `packages/client/src/pages/machinehead/ann/AnnMhBatchingPage.tsx`
- **Decisions / skipped:** Presentation-only layout refactor (grid alignment + max-height caps + independent vertical overflow); no changes to state, drag/order actions, or API calls.
- **Follow-ups:** Verify on mobile/tablet that each panel scrolls independently and the Stack grows/shrinks with its own content.
### 2026-08-04 — Seed extra ANN Trends readings

- **Goal:** Make ANN Trends charts show more than 5 points per base.
- **Touched:** DB only (	xn.ann_charge_reading) — inserted extra 5 readings per seeded ANN charge.
- **Decisions / skipped:** Only added for charges with nn_charge_reading count = 5 to avoid duplicates.
- **Follow-ups:** If user wants this for all imported charges automatically, we can adjust seed-process-queues.mjs threshold logic.
### 2026-08-04 — Fix ANN Trends datetime-local filtering

- **Goal:** Make ANN Trends charts show seeded readings (fix UTC/datetime-local mismatch).
- **Touched:** packages/client/src/pages/machinehead/ann/AnnMhTrendsPage.tsx
- **Decisions / skipped:** Keep server/data as-is; fix client time-window initialization only.
- **Follow-ups:** If charts still empty, verify /stations/ann/charges/:chargeNo response contains expected numeric fields.

### 2026-08-04 — Locate ANN MH analytics dashboard charts

- **Goal:** Identify Annealing MH analytics dashboard entry point(s) and chart composition.
- **Touched:** `packages/client/src/App.tsx`, `packages/client/src/pages/machinehead/ann/AnnMhTrendsPage.tsx`, `packages/client/src/pages/machinehead/ann/AnnMhLiveDashboard.tsx`, `packages/client/src/components/layout/machinehead/MachineHeadShell.tsx`, `packages/client/src/components/process/bodies/AnnBaseCard.tsx`
- **Decisions / skipped:** Only `AnnMhTrendsPage` uses `recharts`; live dashboard uses `AnnBaseCard` grid (no charts).
- **Follow-ups:** N/A.

### 2026-08-04 — Add ANN MH REPORT + XLSX export

- **Goal:** Ship ANN-only `REPORT` page (filters + charts + table) and wire it to server-side `ANN_CHARGE_REPORT` XLSX export.
- **Touched:** `packages/client/src/components/layout/machinehead/MachineHeadNav.tsx`, `packages/client/src/App.tsx`, `packages/client/src/pages/machinehead/ann/AnnMhReportPage.tsx`, `packages/client/src/lib/annReportUtils.ts`, `packages/client/src/lib/reportingService.ts`, `packages/server/src/export/types/index.ts`, `packages/server/src/export/definitions/index.ts`, `packages/server/src/export/auth/exportAuthz.ts`, `packages/server/src/export/jobs/ExportJobService.ts`, `packages/server/src/export/definitions/AnnChargeReport.ts`, `packages/server/src/export/render/AnnChargeReportWorkbookBuilder.ts`.
- **Decisions / skipped:** Kept export rendering server-side via ExcelJS workbook builder (no embedded chart objects in XLSX); export filters are applied server-side using optional `dateFrom/dateTo` scope fields.
- **Follow-ups:** Run a quick end-to-end browser check for ANN REPORT -> Generate -> Export (.xlsx) across typical time windows and large reading sets.

### 2026-08-04 — Fix ANN report route import

- **Goal:** Resolve frontend crash on `/machine-head/ann/report` caused by an undefined route component.
- **Touched:** `packages/client/src/App.tsx`
- **Decisions / skipped:** Added the missing `AnnMhReportPage` import only; left route structure and page implementation unchanged.
- **Follow-ups:** Reopen the ANN report route in the browser and confirm the page renders past `AppRoutes`.

### 2026-08-04 — Normalize ANN report page encoding

- **Goal:** Fix Vite parse failure on `AnnMhReportPage.tsx` caused by the file being saved as UTF-16 LE and treated as binary.
- **Touched:** `packages/client/src/pages/machinehead/ann/AnnMhReportPage.tsx`
- **Decisions / skipped:** Re-encoded the existing file content to UTF-8 without changing the page logic.
- **Follow-ups:** Reload `/machine-head/ann/report` and verify Vite recompiles the page cleanly.

### 2026-08-04 — Audit and normalize UTF-16 source files

- **Goal:** Eliminate repeated Vite "file appears to be binary" parse failures by auditing text-source encoding and converting affected files to UTF-8.
- **Touched:** `packages/client/src/lib/annReportUtils.ts`, `packages/client/docs/OFFLINE_WRITES.md`, `packages/server/scripts/write-process-station-service.js`
- **Decisions / skipped:** Converted every UTF-16/NUL-corrupted text file found by the repo scan; no logic changes were made during re-encoding.
- **Follow-ups:** If another parse overlay appears, rescan the newly added files first because the current repo-wide audit returned zero remaining UTF-16/NUL source files.

### 2026-08-04 — Fix ANN report export callback order

- **Goal:** Resolve `Cannot access 'reportComputed' before initialization` in `AnnMhReportPage`.
- **Touched:** `packages/client/src/pages/machinehead/ann/AnnMhReportPage.tsx`
- **Decisions / skipped:** Moved `handleExport` below the `reportComputed` `useMemo` so its dependency array no longer reads a not-yet-initialized binding; kept export behavior unchanged.
- **Follow-ups:** Reload the ANN report page and verify both initial render and XLSX export action work.
### 2026-08-04 — Deduplicate ANN REPORT screen content

- **Goal:** Remove repeated data on ANN MH REPORT, especially stage/cycle timeline shown twice.
- **Touched:** `packages/client/src/pages/machinehead/ann/AnnMhReportPage.tsx`
- **Decisions / skipped:** Kept a single Cycle Timeline panel; dropped Live Dashboard stage/stoppage/readings lists, duplicate Charge/Gas temp charts, overlapping summary/KPI fields, and Process Duration peak/avg/min KPIs already shown above.
- **Follow-ups:** Spot-check generated report layout in browser for remaining visual redundancy.

### 2026-08-04 — Allow ANN_CHARGE_REPORT in export_job check

- **Goal:** Fix report export insert failing on `export_job_export_type_check`.
- **Touched:** `packages/server/migrations/1959000000000_export_ann_charge_report_type.js`
- **Decisions / skipped:** Extended the existing CHECK constraint to include `ANN_CHARGE_REPORT`; no app-code changes required beyond the already-wired export type.
- **Follow-ups:** Retry ANN REPORT Export in the browser.

### 2026-08-04 — Drop stale export_job_type_check

- **Goal:** Fix remaining 400 on ANN report export caused by duplicate constraint `export_job_type_check`.
- **Touched:** `packages/server/migrations/1960000000000_drop_stale_export_job_type_check.js`
- **Decisions / skipped:** Dropped the stale constraint; kept canonical `export_job_export_type_check` which already includes `ANN_CHARGE_REPORT`.
- **Follow-ups:** Retry ANN REPORT Export once more.

### 2026-08-04 — Redesign ANN MH Trends dashboard UI

- **Goal:** Premium industrial analytics UI for ANN Machine Head Trends without changing data/API/filter logic.
- **Touched:** `packages/client/src/pages/machinehead/ann/AnnMhTrendsPage.tsx`
- **Decisions / skipped:** Kept Recharts + `load`/`chartData`/search/base/date filters intact; UI-only sticky toolbar, metric cards (live value + relative time), custom tooltip/legend, skeletons, empty state, placeholder card actions.
- **Follow-ups:** Visual smoke on `/machine-head/ann/trends` (filters, legend toggle, loading/empty).

### 2026-08-04 — ANN Trends: drop card icons + pill UI

- **Goal:** Remove unused chart action icons; modernize Trends with pill filters/controls.
- **Touched:** `AnnMhTrendsPage.tsx`, `AnnMhLiveDashboard.tsx`
- **Decisions / skipped:** UI-only; metric pill strip filters visible cards; data/API unchanged.
- **Follow-ups:** None.

### 2026-08-04 — Redesign ANN Operator Production Console UI

- **Goal:** Tablet-optimized industrial HMI layout for ANN charge console without changing workflows/APIs.
- **Touched:** `packages/client/src/pages/process/AnnChargePage.tsx`
- **Decisions / skipped:** UI-only five-zone layout (status/timeline/readings/actions/summary); ≥56px targets; Enter-to-next fields; elapsed clocks; no offline sync / range validation / architecture changes.
- **Follow-ups:** Smoke on 10–12" landscape tablet: save reading, swipe advance, stoppage start/end, skip cool stages.

### 2026-08-04 — ANN console single-screen compact layout

- **Goal:** Fit primary ANN operator workflow in one landscape tablet viewport with minimal scroll.
- **Touched:** `packages/client/src/pages/process/AnnChargePage.tsx`
- **Decisions / skipped:** Merged status into compact header; 3-col reading grid; one Quick Actions panel; history/orders in modals; no API/workflow changes.
- **Follow-ups:** Verify on 10–12" landscape that readings + actions fit without vertical scroll.

### 2026-08-04 — ANN console fill empty vertical space

- **Goal:** Remove blank voids in Reading Entry and Quick Actions panels.
- **Touched:** `packages/client/src/pages/process/AnnChargePage.tsx`
- **Decisions / skipped:** Flex-fill remarks + previous readings (existing data); last-reading block fills action panel mid-gap; fixed status strip contrast on primary; no API changes.
- **Follow-ups:** Confirm landscape tablet shows filled panels with Save still at bottom.

### 2026-08-04 — ANN console stoppage modal + clear reading area

- **Goal:** Move stoppage off main console into header modal; remove previous-readings under form; slim action rail.
- **Touched:** `packages/client/src/pages/process/AnnChargePage.tsx`
- **Decisions / skipped:** Kept STOPPED banner + Resume; same start/end APIs; History/Orders unchanged; remarks flex-fills freed space.
- **Follow-ups:** Smoke Start/Resume stoppage via header modal + banner Resume on tablet.

### 2026-08-04 — Premium ANN Operator Console MES polish

- **Goal:** Tablet MES/HMI polish: segmented header drawers, denser status/timeline/readings, action center with active stoppage card.
- **Touched:** `packages/client/src/pages/process/AnnChargePage.tsx`
- **Decisions / skipped:** Replaced AnnPopup with `ZDrawer` for History/Orders/Stoppage; remarks auto-grows (3–4 lines default); APIs/workflows unchanged.
- **Follow-ups:** Smoke drawers + start/end stoppage + save reading on landscape tablet.

### 2026-08-04 — Fix ANN console header spacing / responsive meta

- **Goal:** Status meta no longer flush under divider; timeline glow not clipped; responsive meta grid.
- **Touched:** `packages/client/src/pages/process/AnnChargePage.tsx`
- **Decisions / skipped:** Padding/grid only; no logic changes.
- **Follow-ups:** Visual check on tablet landscape.

### 2026-08-04 — Timeline fills width + reading scroll for remarks

- **Goal:** Stage timeline spans card (no blank right); reading/remarks scroll so remarks stay reachable.
- **Touched:** `packages/client/src/pages/process/AnnChargePage.tsx`
- **Decisions / skipped:** flex-1 stage nodes; overflow-y on reading + action rail; no API changes.
- **Follow-ups:** Confirm tablet landscape fill + remarks scroll.

### 2026-08-04 — Timeline fills width + reading scroll for remarks

- **Goal:** Stage timeline spans card (no blank right); reading/remarks scroll so remarks stay reachable.
- **Touched:** `packages/client/src/pages/process/AnnChargePage.tsx`
- **Decisions / skipped:** flex-1 stage nodes; overflow-y on reading + action rail; no API changes.
- **Follow-ups:** Confirm tablet landscape fill + remarks scroll.
