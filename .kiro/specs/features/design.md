# Design Document — All-Process Operator

## 1. Overview

This design adds the operator experience layer for HRS, PKL, ANN, RWD, CRS, CTL
on top of the **already-existing** data contracts, capture endpoints, and
process-route engine. It is delivered as: (a) a generalised client shell +
per-process bodies, (b) new thin read endpoints for journey-driven queues,
(c) wiring capture→journey-advance on the server, and (d) a small migration for
per-process sub-form code seeds. The CRM (6HI/4HI/2HI) stack is refactored only
by *extraction* (shared code), never rewritten.

Build order is bottom-up so each layer is validated before the next depends on
it: shell extraction → queue read model → journey wiring → Archetype-A (HRS
first) → Archetype-C (PKL) → Archetype-B (ANN) → routing specifics → retire
generic page.

## 2. Existing assets to reuse (do NOT rebuild)

### 2.1 Contracts & schemas (`packages/shared-validation/src`)
| Asset | Path | Use |
| --- | --- | --- |
| Process entry types | `types/processes.ts` | `HRSEntry`, `HRSSlitSlot`, `PKLEntry`, `PKLChartRow`, `ANNEntry`, `RWDEntry`, `CRSEntry`, `CRSSlitSlot`, `CTLEntry` |
| Enums | `types/enums.ts` | `ShiftLogState`, `CoilStatus`, `StoppageCategory`, `CrewRole` |
| Roles | `types/roles.ts` | `UserRole.OPERATOR` (rank 0) |
| Route views | `types/processRoute.ts` | `OrderJourneyView`, `ProcessRouteStepView`, `JourneyStepStatus` |
| Form zod schemas | `rules/m1Forms.ts` | `hrsSchema`, `pklSchema`, `annSchema`, `rwdSchema`, `crsSchema`, `ctlSchema` |

### 2.2 Server (`packages/server/src`)
| Asset | Path | Use |
| --- | --- | --- |
| Capture endpoints | `modules/m1-collection/routes/productionRoutes.ts` | `POST /production/{hrs,pkl,ann,rwd,crs,ctl}` |
| Capture persistence | `modules/m1-collection/services/ProductionService.ts` | `save{Hrs,Pkl,Ann,Rwd,Crs,Ctl}` — **journey wiring goes here** |
| Route engine | `services/ProcessRouteService.ts` | `advanceJourneyByCoil`, `advanceJourney`, `getJourneyByCoil`, `getJourneysByCoils`, `parseRouteString` |
| Queue transfer | `services/QueueTransferService.ts` | `enqueueNextStep` |
| CRM queue reference | `routes/sixHiRoutes.ts` | `GET /6hi/queue`, `/orders/:batchNo`, `/orders/manual`, stoppage/defect masters — pattern to mirror for a generic queue |
| Route registration | `app.ts` (lines 138–174) | mount a new `processStationRoutes` under `m1Guard` |
| Line access policy | `auth/lineAccessPolicy.ts` | `assertLineOperation(user, processCode, 'READ'|'WRITE')` |
| RLS driver | `db.ts`, `middleware/*` | line-scoping — unchanged |

### 2.3 Client (`packages/client/src`)
| Asset | Path | Use |
| --- | --- | --- |
| Scope shell | `components/UserScopeShell.tsx` | branch to `ProcessLayout` when machine is non-CRM |
| CRM layout | `components/sixHi/SixHiLayout.tsx` | **extract** shared shell → `ProcessLayout` |
| Prod header / timers | `components/sixHi/ProductionHeader.tsx`, `hooks/useLiveTimer.ts`, `hooks/useElapsedTimer.ts` | reuse in shell |
| Action rail | `components/sixHi/SixHiProductionActionRail.tsx`, `ProductionActionBar.tsx` | generalise to `ProductionActionRail` |
| Hub reference | `pages/sixHi/SixHiHub.tsx`, `SixHiQueuePage.tsx` | pattern for `ProcessHub` |
| Capture reference | `pages/sixHi/SixHiCapturePage.tsx`, `components/sixHi/SixHiOrderWorkspace.tsx` | pattern for `CaptureWorkspace` |
| Sub-forms | `components/forms/CrewSubForm.tsx`, `components/sixHi/OrderStoppagePanel.tsx`, `StoppageCodeSelect.tsx`, `DefectTagSelector.tsx` | reuse directly |
| Access gate | `components/MillAccessGate.tsx` | generalise → `StationAccessGate` |
| Handover | `pages/sixHi/CrmOutgoingHandoverPage.tsx` | pattern for `ProcessHandoverPage` |
| Store | `store/sixHiStore.ts`, `store/shiftStore.ts` | pattern for `processStore` |
| Offline | `operator/sync/{submitOrQueue,engine,pull}.ts`, `SyncStatusBadge.tsx` | reuse directly |
| Primitives | `components/primitives/{ZButton,ZInput}.tsx`, `components/ui/operator/{ZPageHeader,ZFilterPills}.tsx` | reuse directly |
| Numeric/glove | `hooks/useNumericCapture.ts`, `hooks/useGloveModeClasses.ts`, `store/gloveModeStore.ts` | reuse directly |
| Legacy target to retire | `pages/capture/GenericCapturePage.tsx`, `pages/capture/ProcessForms.tsx` | remove per-process once workspace ships |

## 3. The identified backbone gap

`ProductionService.save*` currently only emits a `production.captured` platform
event (`emitCaptured`) and **no consumer advances the journey**. The 6HI/SKP
path advances explicitly via `sixHiRoutes` order-end. Therefore non-CRM captures
persist but never move the coil forward.

**Resolution (Requirement 3) — subscribe a consumer to the event that is already
being emitted.** `ProductionService.emitCaptured` already publishes
`production.captured` onto the platform event bus (`@zedral/platform`,
`getEventBus().publish`). Nothing consumes it. Rather than bolt an inline call
onto every `save*`, we add **one consumer** that turns that existing event into a
journey advance. This is the most aligned fix (the event, payload, key, and
lineage ref already exist) and it keeps the capture transaction fast and
decoupled from routing.

**Chosen approach — event consumer (`JourneyAdvanceConsumer`):**

```
POST /production/hrs ──▶ ProductionService.saveHrs
      (existing)              │ 1. write txn.prod_hrs (+_slit)  [transaction]
                              │ 2. emitCaptured('HRS', shiftLogId, entryId, coilNo)  [existing]
                              ▼
              production.captured  ──▶  JourneyAdvanceConsumer  (NEW)
                                          │ filter: processCode ∈ {HRS,PKL,ANN,RWD,CRS,CTL}
                                          │ load entry by entryId (for slit children)
                                          │ idempotency: skip if current step COMPLETED
                                          │ HRS/CRS: spawn child journeys (§6.1)
                                          │ else: ProcessRouteService.advanceJourneyByCoil(coilNo, payload)
                                          ▼
                                   QueueTransferService.enqueueNextStep → coil in next Hub
```

Design decisions baked in:

- **Idempotent (R3.4):** the consumer no-ops if the coil's current
  `order_journey_step` for this process is already COMPLETED, so event redelivery
  or a re-submit cannot double-enqueue. `advanceJourneyByCoil` is also guarded by
  `queue_batch_id` presence.
- **Resilient (R3.3):** the consumer runs *after* the capture transaction has
  committed, so an advance failure never rolls back production data. **Critical
  detail for the in-process bus:** `InProcessEventBus.publish` awaits all handlers
  (`Promise.all`) and `ProductionService.save*` does `await emitCaptured(...)`
  after the commit — so a handler that *throws* would reject `emitCaptured` and
  surface a 500 to the client even though the row is saved. Therefore
  `JourneyAdvanceConsumer` MUST wrap its whole body in try/catch, log on failure,
  and **never re-throw**; retries go through a bounded internal retry/outbox, not
  by rejecting the publish chain. (`EventBus` interface:
  `packages/platform/src/eventbus/EventBus.ts`; impls `InProcessEventBus.ts`,
  `KafkaEventBus.ts`.)
- **No double-advance on 6HI/SKP (R14.2):** the SKP/6HI path advances explicitly
  through `sixHiRoutes` order-end and does **not** emit `production.captured` for
  routing — the consumer's `processCode` filter excludes CRM sub-processes, so the
  two paths never overlap.
- **Child spawn (§6.1):** for HRS/CRS the consumer needs slit-slot children, so it
  loads the persisted entry by `entryId` (already in the payload) rather than
  relying on payload width. If we prefer to avoid the re-read, enrich
  `emitCaptured` to include `slitSlots` — a one-line payload extension — but the
  re-read keeps `ProductionService` untouched.
- **Offline replay (R13.2):** a queued capture replays by hitting the same
  endpoint → save → emit → consume → advance, so advancement is always
  server-side and needs no client logic.

**Alternative considered — inline call in each `save*` after commit.** Simpler to
read but couples routing to capture, must be added in six places, and makes
advance failures harder to isolate from capture success. Rejected in favour of
the single consumer. (If the platform event bus is in-process/synchronous in this
deployment, the consumer still works and behaves like a post-commit hook.)

New file: `packages/server/src/modules/m1-collection/consumers/JourneyAdvanceConsumer.ts`,
registered in `modules/m1-collection/register.ts` alongside the existing module
wiring.

## 4. Client architecture

### 4.1 Layout branch in `UserScopeShell`
```
UserScopeShell (existing)
 ├─ isCrmMillCode(machine)  → MillAccessGate → SixHiLayout           (unchanged)
 └─ else (HRS/PKL/ANN/RWD/CRS/CTL) → StationAccessGate → ProcessLayout → <Outlet/>
```
`ProcessLayout` and `SixHiLayout` share an extracted `OperatorShell` so CRM stays
equivalent (Requirement 14.1).

### 4.2 New client tree (`packages/client/src`)
```
components/process/
  ProcessLayout.tsx            # shell body: header + status strip + action rail + Outlet
  ProcessHub.tsx               # queue/board + filter pills + shift dashboard
  CaptureWorkspace.tsx         # generic Archetype-A container (header autofill + body + subforms)
  ProductionActionRail.tsx     # generalised from SixHiProductionActionRail
  StationAccessGate.tsx        # generalised from MillAccessGate
  bodies/
    HrsSlitBuilder.tsx         # A–D slit slots + child coil mint
    RwdTensionForm.tsx         # 3-stage tension + M/B toggle
    CrsQualityForm.tsx         # mechanical/surface metrics + For-CTL + slit
    CtlPieceCounter.tsx        # piece/bundle counter + squareness prompt
    PklCoilForm.tsx            # pickling coil fields
    PklChartGrid.tsx           # hourly T1–T3 grid
    AnnChargeBoard.tsx         # charge cards
    AnnChargeDetail.tsx        # roster + furnace + atmosphere + status machine
pages/process/
  ProcessHubPage.tsx
  ProcessCapturePage.tsx
  ProcessHandoverPage.tsx
  PklChartPage.tsx
  AnnChargePage.tsx
store/
  processStore.ts              # queue cards, active entry, filters (pattern: sixHiStore)
lib/
  processConfig.ts             # per-process: code, archetype, field schema map, endpoint, route codes
```

### 4.3 `processConfig.ts` — the per-process driver
A single config object keyed by process code binds everything the generic
components need, so the shell stays process-agnostic:
```ts
type Archetype = 'A' | 'B' | 'C';
interface ProcessConfig {
  code: 'HRS'|'PKL'|'ANN'|'RWD'|'CRS'|'CTL';
  label: string;
  archetype: Archetype;
  endpoint: string;              // '/production/hrs' ...
  schema: ZodSchema;             // hrsSchema ...
  bodyComponent: React.FC<BodyProps>;
  extraTabs?: { id: string; label: string; el: React.FC }[];  // PKL chart
  routeCode: string;             // 'S','P','F','R','C','LE'
}
```

## 5. Server architecture

### 5.1 New read endpoints (`routes/processStationRoutes.ts`, mount `/stations`)
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/stations/:process/queue` | Coil_Queue_Cards for coils whose journey step = process (uses `ProcessRouteService.getJourneysByCoils` + coil master join) |
| GET | `/stations/:process/entry/:coilNo` | Prefill payload (Autofill_Hierarchy) for a coil |
| POST | `/stations/:process/manual` | Ad-hoc coil (mirror `sixHiRoutes /orders/manual`) |
| GET | `/stations/ann/charges` | ANN charge board cards |
| POST | `/stations/ann/charges` | create/roster/allocate/transition charge |
| GET | `/stations/pkl/chart/:shiftLogId` | hourly chart rows |
| POST | `/stations/pkl/chart` | upsert a `(chart_time, tank_no)` set |

Capture writes continue through the **existing** `productionRoutes`. Journey
advancement is wired inside `ProductionService` (§3).

### 5.2 Autofill resolver
Add `services/AutoSourceService.ts` method (or reuse existing `AutoSource*` if
present) `resolvePrefill(process, coilNo)` implementing the hierarchy: PPC batch
→ prior `txn.prod_*` output for the coil → `coil.coil`/`master.grade`/`master.customer`
→ empty (manual). Returns a partial entry the client renders read-only.

## 6. Process-specific logic

### 6.1 Child-coil spawn (HRS §Requirement 5, CRS §Requirement 8.4)
On `saveHrs`/`saveCrs`, for each slit slot with a `childCoilNo`:
1. Upsert `coil.coil` child row inheriting `grade_code`, `customer_id`, `route_raw`
   (mother route minus consumed step).
2. `ProcessRouteService.createJourney(child, routeRaw, startStep = next)`.
3. Mark mother's current step COMPLETED (mother does not continue past slitting
   for HRS; for CRS the mother/parent handling follows CRS route).
**Child numbering (LOCKED — OQ-1 resolved):** child `COIL_NO` = **mother coil no
+ slit id**, i.e. `"<motherCoilNo>-<slotLabel>"` where `slotLabel ∈ {A,B,C,D}`
(e.g. mother `HR12345` slit into `HR12345-A`, `HR12345-B`, …). This applies
identically at HRS and CRS. The mother coil number is always a prefix, so
traceability displays the parentage without a lookup, and the slot letter is
stable and human-readable on the shop floor. `child_coil_no` is derived from
`(coilNo, slot)` — never free-typed — and a uniqueness guard rejects a duplicate
`(motherCoilNo, slotLabel)` within the same entry.

### 6.2 ANN charge lifecycle (Requirement 7)
`txn.ann_charge` already has `status`, `charge_no`, `base_no`, `furnace_id`,
`no_of_coils`, `charge_wt_mt`. Charge Detail rosters coils (link table or
`ann_charge_coil`; verify existing schema, add migration only if absent).
Furnace allocation mirrors `components/sixHi/MachineAllocationModal.tsx`. On
`DONE`, iterate roster → `advanceJourneyByCoil` for each (Requirement 7.4).
`charge_wt_mt`/`no_of_coils` derived from roster (Requirement 7.5).

### 6.3 CRS quality gate + For-CTL (Requirement 8)
Validate quality fields against grade spec in `ProductionService.saveCrs`
(reuse `shared-validation` rule runner). Fail → set `CoilStatus.HOLD`, skip
advance. Pass → advance; if `for_ctl_mt > 0` the enqueued next step is `LE`,
else `PKG` (encode in the coil's `route_raw` / advance payload).

### 6.4 CTL derivations (Requirement 9)
kg→MT and `total_prod_mt` computed client-side for display and server-side as
source of truth (`shared-validation/utils/calculationEngine.ts`). Squareness
prompt is a client counter side-effect at every 50 pcs.

### 6.5 PKL chart (Requirement 6)
Independent write path to `txn.prod_pkl_chart`; plant-clock prompt from
`shared-validation/utils/plantTime.ts`. Never blocks coil capture or advance.

## 7. Data model changes

Minimal. Verify-then-add only:
1. **Sub-form code seeds** — `node-pg-migrate` migration seeding per-process
   stoppage/defect codes into existing master code tables (Requirement 11.4).
2. **ANN charge↔coil roster** — add `txn.ann_charge_coil (charge_id, coil_no)`
   only if no roster linkage exists today (verify against migrations
   `1800000000000_crm_mill_sub_processes.js` and the `ann_charge` baseline).
3. No new `txn.prod_*` columns expected; every field in the spec maps to an
   existing column per `types/processes.ts`.

## 8. Routing (client `App.tsx`)

Extend the existing `/:userScope` block (currently lines 164–173). The scope
shell already resolves the active machine; child routes render per archetype:
```
/:scope                  → ProcessHubPage        (index)
/:scope/capture          → ProcessCapturePage
/:scope/capture/:coilNo  → ProcessCapturePage    (resume)
/:scope/chart            → PklChartPage           (PKL)
/:scope/charge/:chargeNo → AnnChargePage          (ANN)
/:scope/handover         → ProcessHandoverPage
```
Guarding: `ProtectedRoute` → `StationAccessGate`. CRM mills continue to hit
`SixHiLayout` via the existing branch (Requirement 1.5 / 14.1).

## 9. Correctness properties (test targets)

| # | Property | Validates |
| --- | --- | --- |
| P1 | Capture commit ⇒ exactly one journey advance for the coil (idempotent) | R3.1, R3.4 |
| P2 | Advance failure never rolls back capture | R3.3 |
| P3 | HRS/CRS slit ⇒ N child journeys created, mother step COMPLETED | R5.3, R8.4 |
| P4 | `Σ child width + scrap ≈ mother width` warn boundary | R5.4 |
| P5 | `scrap_pct`, `weight_mt`, `total_prod_mt`, `charge_wt_mt` never accept client value | R5.5, R7.5, R9.2 |
| P6 | CRS fail-spec ⇒ HOLD, no advance | R8.2 |
| P7 | `for_ctl_mt>0 ⇒ next=LE` else `PKG` | R8.3 |
| P8 | ANN DONE ⇒ all roster coils advanced once each | R7.4 |
| P9 | PKL chart write independent of coil advance | R6.3, R6.4 |
| P10 | Non-CRM only: CRM machine still renders SixHiLayout | R1.5, R14.1 |
| P11 | Offline replay advances server-side, no duplicate cards | R13.2, R13.3 |

## 10. Rollout & non-regression

- Ship behind a per-process feature flag (reuse `tenant_module_flags` migration
  pattern) so stations flip on individually.
- Retire `GenericCapturePage` per process, not globally, until all six ship
  (Requirement 12.4).
- CI: existing `e2e/` must pass; add e2e per archetype (HRS, PKL, ANN).

## 11. Open questions (carry from design spec §15)

- ~~**OQ-1** Child-coil numbering scheme~~ — **RESOLVED:** child = `"<motherCoilNo>-<slotLabel>"` (mother coil + slit id), same at HRS and CRS. See §6.1.
- **OQ-2** ANN Base No: operator-chosen or plan-assigned; single-grade guarantee?
- **OQ-3** PKL chart cadence fixed (1st/3rd/5th/7th) or configurable; soft/hard?
- **OQ-4** CTL squareness exactly every 50 pcs or per-customer configurable?
- **OQ-5** CRS For-CTL split: per-coil all-or-nothing, or partial (split journey)?
- **OQ-6** Furnace master count; can a charge change furnace mid-cycle?
