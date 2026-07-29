# Implementation Plan — All-Process Operator

## Overview

Bottom-up build so each layer is code-validated before the next depends on it:
**(1)** wire the journey-advance backbone (the one true blocker), **(2)** extract
the shared shell without disturbing CRM, **(3)** the journey-driven queue read
model, **(4)** Archetype-A with HRS as the reference vertical slice, then clone
to RWD/CRS/CTL, **(5)** Archetype-C (PKL chart), **(6)** Archetype-B (ANN charge),
**(7)** routing/handover, **(8)** retire the generic page. Tasks marked `*` are
tests. Every task cites the files it touches so an IDE agent can act directly.

## Tasks

- [ ] 1. Journey-advance backbone (unblocks live queues end-to-end)
  - [ ] 1.1 Create `JourneyAdvanceConsumer`
    - New: `packages/server/src/modules/m1-collection/consumers/JourneyAdvanceConsumer.ts`
    - Subscribe to `production.captured` via `getEventBus().subscribe('production.captured', handler)` (`@zedral/platform`, `packages/platform/src/eventbus/EventBus.ts`)
    - Filter `processCode ∈ {HRS,PKL,ANN,RWD,CRS,CTL}` (exclude CRM sub-processes to avoid double-advance)
    - Idempotency: skip if the coil's current `planning.order_journey_step` for this process is already `COMPLETED`
    - Call `ProcessRouteService.advanceJourneyByCoil(coilNo, { processCode, shiftLogId, entryId })` (`packages/server/src/services/ProcessRouteService.ts`)
    - **Wrap the entire handler in try/catch; log and never re-throw** (in-process bus awaits handlers — a throw would 500 a committed capture). Route failures to a bounded retry.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 14.2_
  - [ ] 1.2 Register the consumer
    - Edit `packages/server/src/modules/m1-collection/register.ts` to construct/subscribe `JourneyAdvanceConsumer` on module init
    - _Requirements: 3.1_
  - [ ]* 1.3 Property tests P1/P2 (advance idempotency; capture never rolled back)
    - New: `packages/server/src/modules/m1-collection/consumers/__tests__/JourneyAdvanceConsumer.test.ts`
    - **P1:** one commit ⇒ exactly one advance, re-delivery ⇒ no double-enqueue
    - **P2:** handler throw ⇒ capture row persists, publish does not reject caller
    - _Validates: 3.1, 3.3, 3.4_

- [ ] 2. Child-coil spawn for slitting (HRS/CRS) inside the consumer
  - [ ] 2.1 Spawn children on slit entries
    - In `JourneyAdvanceConsumer`, for `processCode ∈ {HRS,CRS}` load the entry by `entryId`, read slit slots (`txn.prod_hrs_slit` / `txn.prod_crs_slit`)
    - For each slot with a slit id: derive `child_coil_no = "<motherCoilNo>-<slotLabel>"` (mother coil + slit id, `slotLabel ∈ {A,B,C,D}` — LOCKED, do not free-type); upsert `coil.coil` inheriting `grade_code`, `customer_id`, `route_raw`; then `ProcessRouteService.createJourney(child, routeRaw, nextStep)`
    - Reject duplicate `(motherCoilNo, slotLabel)` within an entry (uniqueness guard)
    - Mark the mother's current step `COMPLETED`
    - _Requirements: 5.2, 5.3, 8.4_
  - [ ]* 2.2 Property test P3 (N slits ⇒ N child journeys, mother COMPLETED)
    - _Validates: 5.3, 8.4_

- [ ] 3. Extract the shared operator shell (no CRM behaviour change)
  - [ ] 3.1 Extract `OperatorShell` from `SixHiLayout`
    - New: `packages/client/src/components/process/ProcessLayout.tsx` + a shared `OperatorShell` used by both it and `components/sixHi/SixHiLayout.tsx`
    - Reuse `components/sixHi/ProductionHeader.tsx`, `hooks/useLiveTimer.ts`, `components/ui/operator/ZPageHeader`, `operator/sync/SyncStatusBadge.tsx`
    - _Requirements: 1.1, 1.2, 1.4, 14.1_
  - [ ] 3.2 Generalise the action rail
    - New: `packages/client/src/components/process/ProductionActionRail.tsx` from `components/sixHi/SixHiProductionActionRail.tsx` (Start/Stop/Defect/End-entry/End-shift)
    - _Requirements: 1.3_
  - [ ] 3.3 Generalise the access gate
    - New: `packages/client/src/components/process/StationAccessGate.tsx` from `components/MillAccessGate.tsx`
    - _Requirements: 12.2_
  - [ ] 3.4 Branch `UserScopeShell` to the new layout
    - Edit `packages/client/src/components/UserScopeShell.tsx`: keep `isCrmMillCode → SixHiLayout`; else render `StationAccessGate → ProcessLayout → <Outlet/>`
    - _Requirements: 1.5, 14.1_
  - [ ]* 3.5 Test P10 (CRM machine still renders `SixHiLayout`)
    - _Validates: 1.5, 14.1_

- [ ] 4. Per-process config + client store
  - [ ] 4.1 `processConfig.ts`
    - New: `packages/client/src/lib/processConfig.ts` — map each code → {label, archetype, endpoint, schema (`m1Forms` schemas), bodyComponent, routeCode, extraTabs}
    - _Requirements: 1.5, 4.1_
  - [ ] 4.2 `processStore.ts`
    - New: `packages/client/src/store/processStore.ts` (queue cards, active entry, filters) modelled on `store/sixHiStore.ts`
    - _Requirements: 2.1, 2.3, 13.3_

- [ ] 5. Journey-driven queue read model (server)
  - [ ] 5.1 `processStationRoutes.ts`
    - New: `packages/server/src/routes/processStationRoutes.ts`; mount in `app.ts` under `m1Guard` as `app.use('/stations', m1Guard, processStationRoutes)` (near lines 152–174)
    - `GET /stations/:process/queue` — coils whose journey step = process (`ProcessRouteService.getJourneysByCoils` + `coil.coil`/`master.grade`/`master.customer` joins)
    - `GET /stations/:process/entry/:coilNo` — prefill payload
    - `POST /stations/:process/manual` — ad-hoc coil (mirror `sixHiRoutes` `/orders/manual`)
    - Enforce `assertLineOperation(user, process, 'READ'|'WRITE')` (`auth/lineAccessPolicy.ts`)
    - _Requirements: 2.1, 2.2, 2.4_
  - [ ] 5.2 Autofill resolver
    - New/extend: `packages/server/src/services/AutoSourceService.ts` `resolvePrefill(process, coilNo)` implementing Plan ▸ Prior ▸ Master ▸ Manual
    - _Requirements: 2.2, 4.1_

- [ ] 6. Archetype-A shell screens (generic)
  - [ ] 6.1 `ProcessHub` + `ProcessHubPage`
    - New: `components/process/ProcessHub.tsx`, `pages/process/ProcessHubPage.tsx` — queue + `ZFilterPills` (All/Pending/In-Progress/Hold/Completed) + shift dashboard; pattern `pages/sixHi/SixHiHub.tsx`
    - _Requirements: 2.1, 2.3_
  - [ ] 6.2 `CaptureWorkspace` + `ProcessCapturePage`
    - New: `components/process/CaptureWorkspace.tsx`, `pages/process/ProcessCapturePage.tsx` — header autofill (read-only) + `config.bodyComponent` + shared sub-forms; submit via `operator/sync/submitOrQueue.ts` to `config.endpoint`
    - Reuse `hooks/useNumericCapture.ts`, `hooks/useGloveModeClasses.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 13.1_

- [ ] 7. HRS — reference vertical slice (build end-to-end first)
  - [ ] 7.1 `HrsSlitBuilder` body
    - New: `components/process/bodies/HrsSlitBuilder.tsx` — A–D slots (width/thk/taper), child-coil mint, mass-balance warning, derived `scrap_pct`
    - Writes via existing `POST /production/hrs` (`productionRoutes.ts`)
    - _Requirements: 5.1, 5.4, 5.5, 4.2_
  - [ ]* 7.2 Test P4/P5 (mass-balance boundary; scrap_pct not client-accepted)
    - _Validates: 5.4, 5.5_
  - [ ] 7.3 Wire HRS route + retire generic for HRS
    - Edit `packages/client/src/App.tsx` `/:userScope` block: index `ProcessHubPage`, `capture[/:coilNo]`, `handover`; stop routing HRS to `GenericCapturePage`
    - _Requirements: 12.1, 12.4_
  - [ ]* 7.4 e2e: HRS pick→slit→submit→child appears in PKL queue
    - New: `e2e/hrs-operator.spec.ts`
    - _Validates: 2.1, 3.2, 5.3_

- [ ] 8. Clone Archetype-A bodies: RWD, CRS, CTL
  - [ ] 8.1 `RwdTensionForm` — 3-stage tension segmented control + Matt/Bright toggle → `POST /production/rwd`
    - New: `components/process/bodies/RwdTensionForm.tsx`
    - _Requirements: 10.1, 10.2, 10.3_
  - [ ] 8.2 `CrsQualityForm` — mechanical/surface metrics + slit builder + For-CTL field → `POST /production/crs`
    - New: `components/process/bodies/CrsQualityForm.tsx`
    - _Requirements: 8.1, 8.4_
  - [ ] 8.3 CRS quality gate + For-CTL routing (server)
    - Edit `ProductionService.saveCrs` / consumer: validate quality vs grade spec (`shared-validation` runner); fail ⇒ `CoilStatus.HOLD`, no advance; `for_ctl_mt>0 ⇒ next=LE` else `PKG`
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ]* 8.4 Tests P6/P7 (HOLD on fail; For-CTL routing)
    - _Validates: 8.2, 8.3_
  - [ ] 8.5 `CtlPieceCounter` — piece/bundle counter, kg→MT derived, squareness prompt every 50 pcs → `POST /production/ctl`
    - New: `components/process/bodies/CtlPieceCounter.tsx`; conversions via `shared-validation/utils/calculationEngine.ts`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ] 8.6 Wire RWD/CRS/CTL routes + retire generic for each (`App.tsx`)
    - _Requirements: 12.1, 12.4_

- [ ] 9. Archetype-C — Pickling (coil + hourly chart)
  - [ ] 9.1 `PklCoilForm` body → `POST /production/pkl`
    - New: `components/process/bodies/PklCoilForm.tsx`
    - _Requirements: 6.4_
  - [ ] 9.2 `PklChartGrid` + `PklChartPage` (T1–T3 hourly)
    - New: `components/process/bodies/PklChartGrid.tsx`, `pages/process/PklChartPage.tsx`; two-tab Hub (Coils/Process Chart) via `config.extraTabs`
    - Plant-clock prompt from `shared-validation/utils/plantTime.ts`
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ] 9.3 Chart endpoints (server)
    - Add to `processStationRoutes.ts`: `GET /stations/pkl/chart/:shiftLogId`, `POST /stations/pkl/chart` → `txn.prod_pkl_chart` (one row per tank 1–3)
    - _Requirements: 6.3_
  - [ ]* 9.4 Test P9 (chart write independent of coil advance)
    - _Validates: 6.3, 6.4_

- [ ] 10. Archetype-B — Annealing charge board
  - [ ] 10.1 Verify/add charge↔coil roster
    - Check `txn.ann_charge` linkage in migrations (`1800000000000_crm_mill_sub_processes.js` + baseline). If absent, new migration `packages/server/migrations/<ts>_ann_charge_coil.js` creating `txn.ann_charge_coil(charge_id, coil_no)`
    - _Requirements: 7.2, 7.5_
  - [ ] 10.2 Charge endpoints (server)
    - Add to `processStationRoutes.ts`: `GET/POST /stations/ann/charges` (create, roster, allocate furnace, transition status)
    - On `DONE`: iterate roster → `advanceJourneyByCoil` each; derive `charge_wt_mt`/`no_of_coils`
    - _Requirements: 7.1, 7.3, 7.4, 7.5_
  - [ ] 10.3 `AnnChargeBoard` + `AnnChargeDetail` + `AnnChargePage`
    - New: `components/process/bodies/AnnChargeBoard.tsx`, `AnnChargeDetail.tsx`, `pages/process/AnnChargePage.tsx`; furnace allocation modal pattern from `components/sixHi/MachineAllocationModal.tsx`
    - _Requirements: 7.1, 7.2, 7.3_
  - [ ]* 10.4 Test P8 (DONE ⇒ all roster coils advanced once)
    - _Validates: 7.4_

- [ ] 11. Shared sub-form code seeds
  - [ ] 11.1 Seed migration
    - New: `packages/server/migrations/<ts>_process_subform_codes.js` seeding per-process stoppage + defect codes (design §11: CTL 36-type, HRS symbol codes, PKL list) into existing master code tables, scoped by process
    - _Requirements: 11.1, 11.2, 11.4_
  - [ ] 11.2 Wire sub-forms into `CaptureWorkspace`
    - Reuse `components/forms/CrewSubForm.tsx`, `components/sixHi/OrderStoppagePanel.tsx`/`StoppageCodeSelect.tsx`, `DefectTagSelector.tsx`; feed per-process code lists
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 12. Handover + offline parity + flags
  - [ ] 12.1 `ProcessHandoverPage`
    - New: `pages/process/ProcessHandoverPage.tsx` from `pages/sixHi/CrmOutgoingHandoverPage.tsx`
    - _Requirements: 12.3_
  - [ ]* 12.2 Test P11 (offline replay advances server-side, no duplicate cards)
    - _Validates: 13.2, 13.3_
  - [ ] 12.3 Per-process feature flags
    - Reuse `tenant_module_flags` pattern so stations flip on individually
    - _Requirements: 12.4_

- [ ] 13. Retire the generic capture page
  - [ ] 13.1 Once all six workspaces ship, remove HRS/PKL/ANN/RWD/CRS/CTL configs from `pages/capture/ProcessForms.tsx` and drop `GenericCapturePage` routing
    - _Requirements: 12.4_
  - [ ]* 13.2 Full regression: existing `e2e/` suites green
    - _Validates: 14.3_

## Task dependency notes

- Task 1 blocks everything that shows a live queue (2, 5, 6+). Build and test it
  first — it is the fix for "captures don't move coils forward".
- Task 3 (shell extraction) blocks all client screens; keep CRM parity (P10).
- HRS (task 7) is the reference slice; RWD/CRS/CTL (task 8) clone its body.
- **OQ-1 resolved:** child coil = `"<motherCoilNo>-<slotLabel>"` (mother coil + slit id) at both HRS and CRS — task 2.1 is unblocked.
