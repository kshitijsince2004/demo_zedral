# Requirements Document

## Introduction

**All-Process Operator** extends the rich, order/queue-driven operator experience
that today exists only for the Cold-Rolling mills (6HI / 4HI / 2HI) to the
remaining seven shop-floor processes: **HR Slitting (HRS), Pickling (PKL) with
its hourly Process-Record chart, Annealing (ANN), Rewinding (RWD), CR Slitting
(CRS), and Cut-to-Length (CTL)**. These processes today run only on the flat
`packages/client/src/pages/capture/GenericCapturePage.tsx`, which lacks a queue,
live timers, stoppage/defect/crew sub-forms, process-specific logic, and — most
importantly — **journey advancement**, so a captured coil never appears in the
next process's queue.

This feature is a **UI/UX + workflow-logic** slice. The data contracts, DB
tables, zod schemas, capture endpoints, and the process-route engine already
exist and MUST be reused, not rebuilt:

- Contracts: `packages/shared-validation/src/types/processes.ts`
  (`HRSEntry`, `HRSSlitSlot`, `PKLEntry`, `PKLChartRow`, `ANNEntry`, `RWDEntry`,
  `CRSEntry`, `CRSSlitSlot`, `CTLEntry`).
- Tables: `txn.prod_hrs (+_slit)`, `txn.prod_pkl`, `txn.prod_pkl_chart`,
  `txn.ann_charge`, `txn.prod_rwd`, `txn.prod_crs (+_slit)`, `txn.prod_ctl`.
- Capture endpoints: `packages/server/src/modules/m1-collection/routes/productionRoutes.ts`
  (`POST /production/{hrs,pkl,ann,rwd,crs,ctl}`) → `ProductionService`.
- Route engine: `packages/server/src/services/ProcessRouteService.ts`
  (`advanceJourneyByCoil`, `advanceJourney`) + `QueueTransferService.enqueueNextStep`,
  seeded route codes in `master.route_code` (`S,P,4,6,R,F,X,Y,Z,C,LE,PKG`).
- Reference operator stack to generalise from: `packages/client/src/components/sixHi/*`,
  `packages/client/src/pages/sixHi/*`, `packages/client/src/store/sixHiStore.ts`,
  `packages/client/src/components/UserScopeShell.tsx`.

The build is governed by four non-negotiable principles:

- **Principle A — reuse the contract, build only the UX.** No new `txn.prod_*`
  columns or zod schemas are introduced except where a field named in the design
  has no home column. The operator layer writes exclusively through the existing
  `productionRoutes` endpoints and reads through new thin query endpoints.
- **Principle B — one shell, per-process body.** A single generalised
  `ProcessLayout` (extracted from `sixHi/SixHiLayout.tsx` + `ProductionHeader.tsx`)
  wraps every process. The 6HI route tree is NOT forked seven times. Processes
  differ only in their workspace body and their field form.
- **Principle C — the journey is the queue.** A coil enters a process's queue
  because its `planning.order_journey` current step points at that process, and
  leaves when capture completes and `ProcessRouteService.advanceJourneyByCoil`
  moves it on. Wiring capture→advance is the backbone of this feature.
- **Principle D — offline-first, unchanged.** All capture reuses the existing
  `packages/client/src/operator/sync` outbox (submit-or-queue, IndexedDB). No
  capture may bypass the outbox.

## Glossary

- **All_Process_Operator**: The feature defined by this specification — operator
  screens + queue + journey wiring for HRS, PKL, ANN, RWD, CRS, CTL.
- **Process_Station**: A `master.machine` row whose `process_code` is one of
  HRS/PKL/ANN/RWD/CRS/CTL; the operator's bound line.
- **Process_Layout**: The reusable operator shell generalised from `SixHiLayout`
  — top bar, live status strip, filter pills, action rail, offline badge, and a
  slot for the process-specific body.
- **Process_Hub**: The landing screen for a Process_Station — a queue of coils
  (Archetype A/C) or a board of charges (Archetype B) plus the shift dashboard.
- **Coil_Queue_Card**: A queue item derived from an `order_journey` step whose
  current process equals the station; carries autofilled header values.
- **Capture_Workspace**: The screen where the operator confirms/measures a coil's
  process-specific fields and submits.
- **Archetype_A**: Coil-queue single-pass UX (HRS, RWD, CRS, CTL).
- **Archetype_B**: Charge/batch board UX (ANN) — a lifecycle over many coils.
- **Archetype_C**: Dual-surface UX (PKL) — coil queue plus a timed instrument chart.
- **Slit_Builder**: The A–D slit-combination sub-form (HRS, CRS) that mints child
  coils.
- **Child_Coil_Spawn**: Minting a child `COIL_NO` for a slit slot and creating a
  new `order_journey` for it starting at the next route step.
- **Charge**: An ANN grouping (Base No) over many coils sharing one furnace cycle;
  persisted in `txn.ann_charge`; state machine `IN_PROCESS→FOR_ANN→RW→DONE`.
- **Hourly_Chart**: The PKL process-record grid; one `txn.prod_pkl_chart` row per
  `(shift_log_id, chart_time, tank_no ∈ 1..3)`.
- **Quality_Gate**: The CRS submit guard that blocks advancement when mandatory
  quality fields fail grade-spec validation, routing the coil to HOLD.
- **For_CTL_Flag**: The CRS `for_ctl_mt` value; when `> 0` the coil's journey is
  routed to CTL (`LE`), otherwise to packaging (`PKG`).
- **Journey_Advance**: Server action `ProcessRouteService.advanceJourneyByCoil`
  that completes the current step and enqueues the next.
- **Field_Source**: The provenance tag of a capture field — Plan / Prior / Master
  / Manual / Derived (see design §Autofill).
- **Autofill_Hierarchy**: Plan (`planning.ppc_batch`) ▸ Prior-process output ▸
  Coil master/grade/customer ▸ Manual measure ▸ Derived.
- **Sub_Forms**: Shared stoppage, defect, crew capture components reused across
  all processes against the unified `txn` tables.
- **Station_Access_Gate**: The non-CRM analogue of `MillAccessGate` guarding a
  Process_Station route.
- **Operator**: End user (role `OPERATOR`, rank 0) bound to one Process_Station.

## Requirements

### Requirement 1: Reusable Process Layout shell

**User Story:** As an Operator at any non-CRM station, I want the same
consistent operator shell the mills have, so that I get live timers, a status
strip, an action rail, and offline safety without a bespoke UI per process.

#### Acceptance Criteria

1. WHEN a `Process_Layout` renders THEN it SHALL display a top bar (station name,
   shift, plant date, sync badge, operator identity) generalised from
   `components/sixHi/ProductionHeader.tsx` and `components/ui/operator/ZPageHeader`.
2. WHILE a coil capture or charge is running THEN the layout SHALL show a green
   run timer using `hooks/useLiveTimer.ts`; WHILE a stoppage is active THEN it
   SHALL show a red stoppage timer instead.
3. WHEN the layout renders an action rail THEN it SHALL expose Start, Stop
   (stoppage), Defect, End-entry, and End-shift actions with large touch targets,
   generalised from `components/sixHi/SixHiProductionActionRail.tsx`.
4. WHERE the device is offline THEN the layout SHALL render the existing
   `operator/sync/SyncStatusBadge.tsx` and no action shall throw.
5. IF the active machine is a CRM mill (`isCrmMillCode`) THEN `UserScopeShell`
   SHALL continue to render `SixHiLayout` unchanged; the new layout SHALL render
   only for HRS/PKL/ANN/RWD/CRS/CTL stations.

### Requirement 2: Journey-driven queue for each process

**User Story:** As an Operator, I want my Hub to list exactly the coils whose
journey has reached my process, so that I never type a coil that the plan or the
previous process already knows.

#### Acceptance Criteria

1. WHEN the Process_Hub loads THEN the server SHALL return `Coil_Queue_Card`s
   for coils whose `planning.order_journey` current step's `process_code` equals
   the station's process, via a new read endpoint.
2. WHEN a `Coil_Queue_Card` is built THEN it SHALL include header values
   (coil no, grade, customer, width, thickness, weight) resolved by the
   Autofill_Hierarchy so the operator confirms rather than types.
3. WHEN the queue is filtered THEN pills SHALL support All / Pending /
   In-Progress / Hold / Completed, mirroring `SixHiHub` `STATUS_FILTERS`.
4. IF no journey exists for a coil (ad-hoc material) THEN the Hub SHALL offer a
   manual-add path analogous to `sixHiRoutes` `POST /orders/manual`.

### Requirement 3: Journey advancement on capture (backbone)

**User Story:** As the plant, I want a completed capture to move its coil to the
next process automatically, so that queues stay live end-to-end.

#### Acceptance Criteria

1. WHEN `ProductionService.save{Hrs,Pkl,Ann,Rwd,Crs,Ctl}` commits successfully
   THEN the server SHALL call `ProcessRouteService.advanceJourneyByCoil(coilNo, payload)`
   for the captured coil within the same request lifecycle.
2. WHEN advancement runs THEN it SHALL complete the current `order_journey_step`
   and enqueue the next step via `QueueTransferService.enqueueNextStep`, so the
   coil appears in the downstream Process_Hub.
3. IF advancement fails THEN the capture SHALL still persist AND the failure
   SHALL be recorded (log + retry/outbox), so no production data is lost.
4. WHEN a capture is re-submitted for a coil whose step is already COMPLETED
   THEN advancement SHALL be idempotent (no double-enqueue).

### Requirement 4: Archetype A capture (HRS, RWD, CRS, CTL)

**User Story:** As an Operator on a single-pass line, I want a pick-from-queue →
confirm/measure → submit flow, so that a coil takes ≤ 30–45 seconds.

#### Acceptance Criteria

1. WHEN the operator opens a `Coil_Queue_Card` THEN the Capture_Workspace SHALL
   pre-fill all Plan/Prior/Master fields and require only Manual fields.
2. WHEN the operator submits THEN the client SHALL POST to the process's existing
   `productionRoutes` endpoint through the `operator/sync` outbox.
3. WHEN submit succeeds THEN the coil SHALL leave the queue and its journey SHALL
   advance (Requirement 3).
4. WHERE a Manual numeric field is focused THEN the on-screen numeric keypad and
   glove-mode classes (`hooks/useGloveModeClasses.ts`) SHALL apply.

### Requirement 5: HR Slitter slit builder and child-coil spawn

**User Story:** As an HRS Operator, I want to slit one mother coil into up to four
child coils, so that each child becomes its own traceable coil.

#### Acceptance Criteria

1. WHEN the operator adds a slit slot (A–D) THEN the Slit_Builder SHALL capture
   width, thickness, taper per slot into `HRSSlitSlot`.
2. WHEN a slot is committed THEN the system SHALL mint a child `COIL_NO` of the
   form `"<motherCoilNo>-<slotLabel>"` (mother coil no + slit id, `slotLabel ∈
   {A,B,C,D}`), inherit grade/customer from the mother, and store it as
   `childCoilNo`. The child number SHALL be derived from `(motherCoilNo, slotLabel)`,
   never free-typed, and a duplicate `(motherCoilNo, slotLabel)` within one entry
   SHALL be rejected. The same rule applies at CRS (Requirement 8.4).
3. WHEN the HRS capture is submitted THEN each child coil SHALL get a new
   `order_journey` starting at its next route step AND the mother's HRS step
   SHALL be marked COMPLETED.
4. IF `Σ(child widths) + scrap` deviates from the mother width beyond tolerance
   THEN the system SHALL surface a mass-balance warning (non-blocking).
5. WHEN scrap is entered THEN `scrap_pct` SHALL be derived, never keyed.

### Requirement 6: Pickling dual-surface (coil log + hourly chart)

**User Story:** As a PKL Operator, I want to log coils and the hourly tank chart
independently, so that instrument readings are captured on the clock regardless
of which coil is running.

#### Acceptance Criteria

1. WHEN the PKL Hub renders THEN it SHALL present two tabs, `Coils` and
   `Process Chart`.
2. WHEN the plant clock reaches a chart interval THEN the Hub SHALL surface a
   soft "reading due" prompt without blocking coil capture.
3. WHEN a chart reading is saved THEN the system SHALL write one
   `txn.prod_pkl_chart` row per tank (1–3) for that `chart_time`.
4. WHEN a coil capture completes THEN its journey SHALL advance to rolling
   (`4|6`) independently of chart state.

### Requirement 7: Annealing charge board (Archetype B)

**User Story:** As an ANN Operator, I want to manage charges over many coils
rather than capture coil-by-coil, so that furnace cycles are tracked correctly.

#### Acceptance Criteria

1. WHEN the ANN Hub renders THEN it SHALL show a Charge Board of cards (base no,
   charge no, furnace, grade, coil count, charge weight, status, unloading
   countdown).
2. WHEN the operator opens a charge THEN the Charge Detail SHALL allow rostering
   coils from the upstream queue, allocating a furnace, and capturing atmosphere
   (dew point N2/H2, temperature).
3. WHEN charge status transitions `IN_PROCESS→FOR_ANN→RW→DONE` THEN the change
   SHALL persist to `txn.ann_charge.status`.
4. WHEN a charge reaches DONE THEN every rostered coil's journey SHALL advance
   together to skin pass (`X|Y|Z`) per each coil's route.
5. WHEN a charge is displayed THEN `charge_wt_mt` and `no_of_coils` SHALL be
   derived from the roster, never keyed.

### Requirement 8: CR Slitter quality gate and For-CTL routing

**User Story:** As a CRS Operator, I want the coil's quality captured and its
onward route decided at slitting, so that only in-spec coils advance and For-CTL
material reaches Cut-to-Length.

#### Acceptance Criteria

1. WHEN the operator submits a CRS capture THEN the server SHALL validate
   mandatory quality fields (hardness, UTS, elongation, Ra/Rz, camber) against
   grade spec.
2. IF quality validation fails THEN the coil SHALL be set HOLD and its journey
   SHALL NOT advance, pending MACHINE_HEAD review.
3. IF `for_ctl_mt > 0` THEN the coil's journey SHALL be routed to CTL (`LE`);
   OTHERWISE it SHALL be routed to packaging (`PKG`).
4. WHEN slit slots are captured THEN CRS SHALL mint child coils identically to
   HRS (Requirement 5.2–5.3).

### Requirement 9: Cut-to-Length piece counter, conversion, squareness

**User Story:** As a CTL Operator, I want to count pieces and bundles with
weight conversion and periodic squareness checks, so that output is measured in
pieces and MT correctly.

#### Acceptance Criteria

1. WHEN the operator increments the piece counter THEN a running bundle total
   SHALL update; bundles support four slots per the log sheet.
2. WHEN weight is entered in kg THEN `weight_mt` and `total_prod_mt` SHALL be
   derived, never keyed.
3. WHEN cumulative pieces cross each multiple of 50 THEN the system SHALL prompt
   for flatness and squareness readings (soft-block beyond threshold).
4. WHEN a CTL capture completes THEN the coil's journey SHALL advance to
   packaging (`PKG`).

### Requirement 10: Rewinding tension stages

**User Story:** As an RWD Operator, I want to record three rewinding-tension
stages and the surface finish, so that the rewind quality is captured.

#### Acceptance Criteria

1. WHEN the RWD Capture_Workspace renders THEN it SHALL present a three-cell
   segmented input for RW tension 1/2/3 (kg) into `rwTension{1,2,3}Kg`.
2. WHEN surface finish is set THEN it SHALL be a Matt/Bright toggle into
   `surfaceFinish`.
3. WHEN capture completes THEN the journey SHALL advance to the next route step
   (ANN or CRS) per `route_raw`.

### Requirement 11: Shared sub-forms and per-process code catalogues

**User Story:** As an Operator, I want the same stoppage/defect/crew capture
everywhere, seeded with my process's code list, so that logging is consistent.

#### Acceptance Criteria

1. WHEN a stoppage is logged THEN it SHALL reuse the unified stoppage capture and
   write to the unified stoppage table, with a per-process code list.
2. WHEN a defect is logged THEN it SHALL reuse the unified defect capture with
   the process's catalogue (CTL 36-type, HRS symbol codes, PKL list per design §11).
3. WHEN crew is rostered THEN it SHALL reuse `CrewSubForm` with the roles from
   the process's log sheet mapped onto the `CrewRole` enum.
4. WHEN sub-form code lists are needed THEN they SHALL be seeded via a
   `node-pg-migrate` migration into the existing master code tables, scoped by
   process.

### Requirement 12: Routes, guards, and handover

**User Story:** As an Operator, I want my station's screens under my scope with
proper access control and a shift handover, so that navigation matches the mills.

#### Acceptance Criteria

1. WHEN routes are defined THEN each station SHALL expose `/:scope` (Hub),
   `/:scope/capture[/:coilNo]`, `/:scope/handover`, plus `/:scope/chart` (PKL)
   and `/:scope/charge/:chargeNo` (ANN), under the existing `/:userScope` shell
   in `packages/client/src/App.tsx`.
2. WHEN a non-CRM station route is accessed THEN a `Station_Access_Gate`
   (generalised from `MillAccessGate.tsx`) SHALL enforce station binding.
3. WHEN a shift ends THEN the operator SHALL complete an outgoing handover
   reusing the pattern in `pages/sixHi/CrmOutgoingHandoverPage.tsx`.
4. WHEN implementation for a process ships THEN its station SHALL no longer route
   to `GenericCapturePage`; the generic page SHALL be retired once all six ship.

### Requirement 13: Offline capture parity

**User Story:** As an Operator beside running machinery, I want captures to
survive a dropped network, so that no data is lost.

#### Acceptance Criteria

1. WHEN any capture is submitted offline THEN it SHALL be queued in the
   `operator/sync` outbox and replayed on reconnect.
2. WHEN a queued capture replays THEN journey advancement (Requirement 3) SHALL
   run server-side at replay time, not client-side.
3. WHILE captures are queued THEN the Hub SHALL reflect pending state without
   duplicating queue cards.

### Requirement 14: Non-regression of the CRM stack

**User Story:** As a Machine Head, I want the existing 6HI/4HI/2HI experience
unchanged, so that this feature adds processes without disturbing rolling.

#### Acceptance Criteria

1. WHEN `ProcessLayout` is extracted THEN `SixHiLayout` behaviour SHALL remain
   byte-for-byte equivalent for CRM mills (shared code, not a rewrite).
2. WHEN journey advancement is wired into `ProductionService` THEN the SKP/6HI
   paths that already advance via `sixHiRoutes` SHALL NOT double-advance.
3. WHEN this feature is built THEN existing e2e suites under `e2e/` SHALL pass.
