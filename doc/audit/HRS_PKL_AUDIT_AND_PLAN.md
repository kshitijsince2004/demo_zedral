# HRS & PKL — Line Audit + Implementation Plan

A single document in two parts:

- **Part I — Audit:** what works on the HRS and PKL lines, and where they interfere or diverge
  from the Rolling (6HI) reference. Every finding cites `file:line`.
- **Part II — Implementation Plan:** each audit finding (§4.1–§4.8) mapped to concrete code
  changes, sequenced by operator impact, with files, risk, and verification.

**Scope:** HR Slitting (`HRS`) and Pickling (`PKL`) operator lines — client flow, server
routes/services — measured against the Rolling (6HI) workspace, the most mature line and the
intended reference for user flow and functionality.

**Method:** traced end-to-end from routing → hub → capture → server write, for all three lines.
This is a functional/flow audit (what works, what's broken, what interferes) — not a style pass.

## Contents

- [Part I — Audit](#part-i--audit)
  - [1. The Rolling (6HI) reference](#1-the-rolling-6hi-reference--how-the-good-flow-is-built)
  - [2. HRS — what works](#2-hrs--what-works)
  - [3. PKL — what works](#3-pkl--what-works)
  - [4. Interference & flow defects](#4-interference--flow-defects-ranked-biggest-first)
  - [5. Priority fix list](#5-priority-fix-list)
- [Part II — Implementation Plan](#part-ii--implementation-plan)
  - [Phase 1 — Operator-facing correctness](#phase-1--operator-facing-correctness)
  - [Phase 2 — Flow consistency with rolling](#phase-2--flow-consistency-with-rolling)
  - [Phase 3 — Cleanup & documentation](#phase-3--cleanup--documentation)
  - [Sequencing, testing, rollback](#sequencing-testing-rollback)

---

# Part I — Audit

## 1. The Rolling (6HI) reference — how the "good" flow is built

This is the shape HRS/PKL should be compared against.

- **Own store, own queue hook.** Rolling has a dedicated `useSixHiStore` and pulls its queue
  through SWR (`useSixHiHubQueue`) — deduped, background-revalidated, with optimistic overlays
  (`SixHiHub.tsx:159`, `applyOptimisticEndOverlay` at `:45`).
- **Hub with sectioned queue + detail + allocation.** Backlog / Awaiting-machine / Assigned /
  Completed / Hold sections, machine-allocation modal, and combined-order multi-select
  (`SixHiHub.tsx:745-792`, `MachineAllocationModal` at `:848`).
- **In-page workspace modal for capture.** `openWorkspace(batchNumber)` opens the production
  console over the hub (`SixHiHub.tsx:511-517`) — Start/Stoppage/End live in one place.
- **Errors are surfaced.** Every write path funnels failures to a visible banner via
  `setActionError` (`SixHiHub.tsx:499-509, 698-702`).

HRS/PKL instead share **one generic engine**: `ProcessHub` → `ProcessLayout` (side rail) →
route to `/capture/:coilNo` → `CaptureWorkspace` → a per-line body
(`HrsSlitBuilder` / `PklCoilForm`), all backed by a **single shared** `useProcessStore`. Most
of the findings below stem from that shared engine.

## 2. HRS — what works

- **Full pipeline is wired and coherent:** plan → `/hrs-order/queue` (`processStore.ts:488-524`)
  → hub list/detail (`ProcessHub.tsx`) → rail Start (`ProcessLayout.tsx:129`) →
  slit builder capture (`HrsSlitBuilder.tsx`) → `/production/hrs`
  (`productionRoutes.ts:127`) → server completes the order
  (`completeHrsPklOrder` → `HrsOrderService.endProduction`, `productionRoutes.ts:107-117`).
- **Slit builder is solid:** parent→child slot expansion from PPC order lines, per-slit
  thickness/taper reading rows, route-derived HOLD / For-CTL flags
  (`HrsSlitBuilder.tsx:51-56, 113-136`), width-pack and mass-balance advisories
  (`:156-162`).
- **Spec tolerances** are fetched live from the quality module (`/quality/fetch`,
  `HrsSlitBuilder.tsx:92-111`) with sane NOT_EVALUATED fallbacks.
- **Single-active-order guard** on the server prevents two HRS orders running at once
  (`HrsOrderService.ts:398-404`, `ACTIVE_ORDER_CONFLICT`).
- **Dedicated handover** (`HrsOutgoingHandoverPage`) and MH coil detail
  (`HrsMhCoilDetailPage`) exist.

## 3. PKL — what works

- **Two-surface design matches the paper log:** coil capture (`PklCoilForm.tsx`) plus the
  hourly process chart (`PklChartGrid.tsx`) reached from the nav rail
  (`OperatorNavRail.tsx:90-98` → `/…/chart` → `PklChartPage`).
- **Chart grid** faithfully reproduces the tank/steam/rinse log columns, flags out-of-spec
  cells amber against advisory spec-limits, and stacks history by reading time
  (`PklChartGrid.tsx:122-138, 200-322`). Persistence is per-shift-log via
  `/stations/pkl/chart` (`processStationRoutes.ts:91-100`).
- **Sibling grouping:** picking a coil auto-selects its mother/slit siblings and sums group
  weight, then walks the group coil-by-coil on save (`ProcessHub.tsx:271-287`,
  `advancePklGroup` in `processStore.ts:259-270`).
- **Dedicated spec admin** (`PklSpecAdmin`, `/admin/pkl-specs`, `/stations/pkl/spec-limits`),
  MH live dashboard (`PklMhLiveDashboard`), handover (`PklOutgoingHandoverPage`).
- **Single-active-order guard** server-side, same as HRS (`PklOrderService.startProduction`).

## 4. Interference & flow defects (ranked, biggest first)

### 4.1 One shared `useProcessStore` bleeds state across line switches — HIGH
`ProcessLineSwitcher.go()` sets `activeMachine` and navigates but **never resets the store**
(`ProcessLineSwitcher.tsx:20-27`). HRS, PKL, RWD, CRS, CTL all share the same singleton
(`processStore.ts:194`). So switching HRS→PKL (or back) carries over stale
`activeCoilNo`, `activePrefill`, `captureStatus`, `runStartedAt`, `activeStoppageId`,
`stoppageCode/Remarks`, and PKL-only `pklGroupCoilNos/pklGroupWeightMt`.
- The rail renders whenever `activeCoilNo` is set (`ProcessLayout.tsx:122`), so the operator
  can land on PKL and briefly see HRS's active coil / running timer / rail until the init
  effect re-hydrates — and that effect only reloads the queue and running order for the new
  line (`ProcessLayout.tsx:90-104`); it does **not** clear the group selection or open panels.
- Rolling avoids this entirely with a separate store + per-machine `refreshMachineState`
  (`SixHiHub.tsx:250-252`).
- **Fix:** reset `useProcessStore` on `setActiveMachine`/line change (a `resetForLine(code)`
  action), or key the store by process code.

### 4.2 Optimistic Start is never rolled back on server rejection — HIGH
`resumeCapture` optimistically flips the card to `IN_PROGRESS` and starts the timer, then POSTs
`/stations/{code}/start` (`processStore.ts:293-346`). If the server throws
`ACTIVE_ORDER_CONFLICT` (another order already running — `HrsOrderService.ts:404`), the catch
only `console.error`s (`processStore.ts:360-362`): **no rollback, no banner.** The operator
sees a coil "running" that the server refused. Rolling surfaces the identical conflict to the
user (`SixHiHub.tsx:499-509`).
- **Fix:** on start failure, revert the optimistic status/timer and show the error (reuse the
  `queueError`/banner pattern already in `ProcessHub.tsx:417-422`).

### 4.3 Two different paths for the same "complete order" action — MEDIUM
The in-body **"Save Production Data"** button completes the order immediately with no
confirmation (`HrsSlitBuilder.tsx:467`, `PklCoilForm.tsx:156` → `/production/*` →
`endProduction`), while the rail **"End"** routes through the `OrderEndModal` confirmation
(`ProcessLayout.tsx:130-137, 155-163`). Rolling has a single End path. Result: inconsistent UX
and an un-confirmed way to finish an order from inside the form.
- **Fix:** make the body Save and the rail End share one path (either both confirm, or the body
  button becomes a plain "save readings" while End owns completion).

### 4.4 HRS/PKL queue has no background revalidation — MEDIUM
Rolling's queue is SWR (dedupe + background refresh + optimistic overlay, `useSixHiHubQueue`).
HRS/PKL poll manually through `loadQueueFor` + a `queueRefreshToken` + a `jsonEqual` diff
(`processStore.ts:440-566`, `ProcessHub.tsx:105-121`). Between actions the queue can sit stale
until the operator hits refresh or an action bumps the token. On a shared shop-floor terminal
this shows other operators' changes late.
- **Fix:** move HRS/PKL queue reads onto SWR like rolling (the hook pattern already exists).

### 4.5 `loadQueue()` resolves the line from stale store state — MEDIUM (latent)
`ProcessLiveStatusPage` calls the no-arg `loadQueue()` (`ProcessLiveStatusPage.tsx:47`), which
resolves the line from `get().processCode` and **ignores the `processCode` prop it was handed**
(`processStore.ts:438`). Because `loadQueueFor` skips updating `processCode` when two lines
return byte-identical queues (the `jsonEqual` short-circuit at `:484/:522/:558` — e.g. both
empty), a stale `processCode` can load/keep the wrong line's queue. `ProcessLayout`'s
`setProcessCode` (`:62-65`) usually masks this, so it's order-dependent and latent — but it's a
real correctness trap.
- **Fix:** have `ProcessLiveStatusPage` call `loadQueueFor(processCode)` with its prop; always
  set `processCode` in `loadQueueFor` regardless of the `jsonEqual` result.

### 4.6 Redundant queue + stoppage endpoints for HRS/PKL — LOW (maintenance)
- Queue exists twice: `/hrs-order/queue` & `/pkl-order/queue` (what the client uses,
  `processStore.ts:503,540`) and `/stations/HRS|PKL/queue` (`processStationRoutes.ts:483`,
  which just delegates to the same service). The `/stations/*` variants are unused by the
  operator client (only ANN/CRS/CTL use them).
- Stoppages exist twice: `/hrs-order/orders/:coilNo/stoppages*` (`hrsOrderRoutes.ts:88-161`)
  and `/stations/{code}/stoppages/*` (`processStationRoutes.ts:542-628`, delegating for
  HRS/PKL). The client only uses the `/stations/*` set (`processStore.ts:316,387,423`); the
  `hrs-order` stoppage routes are dead from the operator path.
- **Fix (ponytail):** converge on one surface per concern and delete the unused twin.

### 4.7 Adjacent lines use divergent implementations of the same concept — LOW
- **Specs:** PKL has its own spec-limit table + admin (`/stations/pkl/spec-limits`,
  `PklSpecAdmin`); HRS pulls tolerances from the generic quality module
  (`/quality/fetch`, `HrsSlitBuilder.tsx:98`). Two spec systems on neighbouring lines.
- **MH live:** PKL has a bespoke `PklMhLiveDashboard`; HRS reuses the generic
  `ProcessLineLiveDashboard` (`App.tsx:245-248`).
- **"Process multiple coils together":** PKL sibling grouping (`findPklSiblingCoils`) is a
  separate implementation from rolling's combined orders
  (`findCompatibleOrdersForCombine`) and RWD's combine — three parallel takes on one idea.
- **Fix:** not urgent, but pick one pattern per concept when next touching these lines.

### 4.8 Documentation drift — LOW
`PROJECT_STRUCTURE.md` still describes the HRS/PKL UI as `pages/forms/HRSForm`, `PKLForm`,
`PKLChartForm` and `components/sections/HRSSection/PKLSection` resolved via
`processSectionRegistry.tsx`. **None of those exist** — the current implementation is
`components/process/bodies/*` wired through `lib/processConfig.ts`. Anyone onboarding to these
lines is reading a stale map.
- **Fix:** update the doc to the `processConfig` + `bodies/` architecture.

## 5. Priority fix list

1. Reset `useProcessStore` on line switch (§4.1) — stops cross-line state bleed.
2. Roll back optimistic Start and surface the conflict banner (§4.2) — stops "phantom running" coils.
3. Unify the two order-completion paths (§4.3).
4. Put HRS/PKL queue on SWR (§4.4) and fix `loadQueue()` to honour its line (§4.5).
5. Delete the redundant `/stations/*` HRS/PKL queue + `hrs-order` stoppage twins (§4.6).
6. Refresh `PROJECT_STRUCTURE.md` (§4.8).

Items 1 and 2 are the ones an operator actually feels; everything else is correctness-hardening
and maintenance.

---

# Part II — Implementation Plan

**Guiding principle (ponytail):** fix at the shared choke point, not per-caller. HRS and PKL
run through one engine (`processStore` + `ProcessLayout` + `CaptureWorkspace`), so most fixes
are one change that both lines inherit. Reuse the rolling patterns that already exist
(`useSixHiHubQueue`, `setActiveMachine`→`setMachineCode`, `setActionError` banner) rather than
inventing new ones.

**Phasing at a glance**

| Phase | Findings | Theme | Operator impact | Effort |
| --- | --- | --- | --- | --- |
| 1 | §4.1, §4.2 | Correctness the operator feels | High | ~1–1.5 days |
| 2 | §4.3, §4.4, §4.5 | Flow consistency with rolling | Medium | ~2–3 days |
| 3 | §4.6, §4.7, §4.8 | Cleanup & docs | Low | ~1 day |

Do Phase 1 first and ship it on its own — it stops two bugs an operator hits daily and carries
almost no blast radius. Phase 2 is the larger refactor. Phase 3 is safe to trickle in.

## Phase 1 — Operator-facing correctness

### 1A. Reset the shared store on line switch (§4.1)

**Problem:** `useProcessStore` is a singleton shared by HRS/PKL/RWD/CRS/CTL; switching lines
leaves stale `activeCoilNo`, `captureStatus`, timers, and PKL group state behind.

**Change**
1. Add a `resetForLine(code)` action to `packages/client/src/store/processStore.ts`. It sets
   the process code and clears everything run-scoped in one call:
   ```ts
   resetForLine: (code) => set({
     processCode: code,
     queue: [],
     activeCoilNo: null,
     activePrefill: null,
     captureStatus: 'idle',
     runStartedAt: null,
     stoppageStartedAt: null,
     activeStoppageId: null,
     pklGroupCoilNos: [],
     pklGroupWeightMt: 0,
     defectPanelOpen: false,
     crewPanelOpen: false,
     remarkPanelOpen: false,
     stoppageCode: '12',
     stoppageRemarks: '',
     statusFilter: 'ALL',
   }),
   ```
   (`finishCapture` at `processStore.ts:273-280` already resets a subset — have it call the same
   internal reset to avoid drift.)
2. Fire it from the **single choke point** that already does the mirror for rolling:
   `packages/client/src/lib/authStore.ts:132-143` `setActiveMachine`. Right beside the existing
   `if (isCrmMillCode(machineCode)) useSixHiStore…setMachineCode(...)`, add: when the code
   **changes** and is a process station, `useProcessStore.getState().resetForLine(code)`. Guard
   on change so re-renders that re-assert the same machine don't nuke an in-progress capture.

**Watch:** possible import cycle authStore→processStore. authStore already statically imports
`useSixHiStore`; if a cycle appears, use a dynamic `import()` inside the action (processStore
already uses that pattern, e.g. `hrsPklWrites` at `:349`).

**Risk:** low. Only adds clearing on an already-navigating transition.
**Verify:** start an HRS coil, select a PKL sibling group, switch HRS→PKL via
`ProcessLineSwitcher` — PKL must open with no rail, no timer, no group. Add a Vitest that calls
`resetForLine('PKL')` after seeding HRS run state and asserts the cleared shape.

### 1B. Roll back optimistic Start and surface the conflict (§4.2)

**Problem:** `resumeCapture` flips the card to `IN_PROGRESS` + starts the timer before the
server confirms; on `ACTIVE_ORDER_CONFLICT` the catch only logs
(`processStore.ts:360-362`), leaving a phantom "running" coil.

**Change** (all in `packages/client/src/store/processStore.ts`)
1. Snapshot the card's prior status and the prior `captureStatus`/`runStartedAt` **before** the
   optimistic `set(...)` at `:293-301`.
2. Add a `captureError: string | null` field (default `null`).
3. In the catch at `:360-362`: revert the card to its prior status, restore
   `captureStatus`/`runStartedAt`/`stoppageStartedAt`, and set
   `captureError` from the message. Parse `ACTIVE_ORDER_CONFLICT:<coilNo>` into a readable
   "Coil <X> is already running — end it before starting another."
4. Clear `captureError` at the top of the next successful `startCapture`/`resumeCapture`.
5. Render it: `ProcessHub` already has an error banner (`ProcessHub.tsx:417-422`) and
   `ProcessLayout` renders the rail — surface `captureError` in the rail/hub the same way
   rolling uses `setActionError` (`SixHiHub.tsx:698-702`).

**Do the same for the stoppage path** (`stopCapture` catch at `:407-409`) so a failed
stoppage-start also reverts and reports — same root cause, same shared fix.

**Risk:** low–medium (touches the hot start path). Keep the optimistic flip; only add
rollback + message.
**Verify:** with one HRS order running, try to start a second — the second card reverts to
PENDING and a banner appears. Vitest: mock `apiClient.post` to reject with the conflict string
and assert card status + `captureError`.

## Phase 2 — Flow consistency with rolling

### 2A. Unify the two order-completion paths (§4.3)

**Problem:** the in-body "Save Production Data" button completes the order with no confirmation
(`HrsSlitBuilder.tsx:467`, `PklCoilForm.tsx:156`); the rail "End" confirms via `OrderEndModal`
(`ProcessLayout.tsx:130-163`). One destructive action, two behaviours.

**Change (lazy, single path)**
- Route the body button through the same confirm the rail uses. The rail already submits the
  body form via `endCaptureToken` (`CaptureWorkspace.tsx:123-132`). So make the body button
  **not** submit directly — instead have it ask the store to open `OrderEndModal`
  (e.g. a `requestEnd()` / `pendingEndCoil`), and let modal-confirm → `requestEndCapture()` →
  the existing form-submit effect run the write. Result: exactly one completion path, one
  confirmation, for both entry points.
- Alternative if a confirm-on-body feels heavy for a fast shop floor: drop `OrderEndModal` and
  let both paths submit directly (parity by removing the modal). Pick one; don't keep both.

**Risk:** medium (changes submit wiring for two bodies). Contained to `CaptureWorkspace`,
`ProcessLayout`, and the two body components.
**Verify:** complete an HRS order from the body button and from the rail End — identical confirm,
order completes exactly once, PKL group still advances to the next sibling
(`CaptureWorkspace.tsx:241-249`).

### 2B. Put the HRS/PKL queue on SWR (§4.4)

**Problem:** no background revalidation; manual `loadQueueFor` + `queueRefreshToken`
(`processStore.ts:440-566`, `ProcessHub.tsx:105-121`).

**Change**
1. Extract the per-line response→`ProcessQueueCard` mapping out of `loadQueueFor`
   (`processStore.ts:488-560`) into a pure `mapQueue(code, raw)` so the store and the new hook
   share it.
2. Add `packages/client/src/hooks/useProcessHubQueue.ts` mirroring `useSixHiHubQueue.ts`
   (`refreshInterval: 15_000`, `revalidateOnFocus: false`, `keepPreviousData: true`,
   `compare: jsonEqual`, `subscribeProductionSync`, `refreshToken`). Key on the line's endpoint
   (`/hrs-order/queue`, `/pkl-order/queue`, else `/stations/{code}/queue`).
3. `ProcessHub` consumes the hook. To keep one cache, push results into the store on success
   (`useProcessStore.setState({ queue })`) so the rail and `ProcessLiveStatusPage` — which read
   `store.queue` for hydration — stay consistent.

**Risk:** medium (queue is central). Land behind the same shape the store already produces so
downstream consumers don't change.
**Verify:** open HRS hub on two terminals; an action on one appears on the other within ~15s
without a manual refresh.

### 2C. Fix `loadQueue()` line resolution (§4.5)

**Problem:** `ProcessLiveStatusPage` calls no-arg `loadQueue()` which resolves the line from
`get().processCode` and ignores its prop; the `jsonEqual` short-circuit can leave `processCode`
stale.

**Change**
1. `ProcessLiveStatusPage.tsx:47` → call `loadQueueFor(processCode)` with the prop (or use the
   new hook from 2B, which already keys on the resolved line).
2. In `loadQueueFor` (`processStore.ts:484, 522, 558`), always set `processCode: code` even when
   the queue is unchanged — keep the `jsonEqual` guard for `queue` only.

**Risk:** low. Mostly closes a latent trap; largely subsumed once 2B lands.
**Verify:** with both HRS and PKL queues empty, switch lines and confirm prefill/start target
the correct line (`/stations/PKL/entry/...`, not HRS).

## Phase 3 — Cleanup & documentation

### 3A. Delete redundant endpoints (§4.6)
- Confirm-then-remove the unused twins (grep every caller first — repo has both `/stations` and
  order routes):
  - `/stations/HRS|PKL/queue` branch in `ProcessStationService.getQueue`
    (`processStationRoutes.ts:483`) — client uses the order routes; keep `/stations/{code}/queue`
    for ANN/CRS/CTL.
  - Dead HRS/PKL stoppage routes `/hrs-order/orders/:coilNo/stoppages*`
    (`hrsOrderRoutes.ts:88-161`) and the PKL equivalent — client uses `/stations/{code}/stoppages/*`
    (`processStore.ts:316, 387, 423`).
- **Risk:** low if grep confirms no caller. Do after Phase 2 so the SWR hook's endpoint choice
  is settled first.

### 3B. Converge divergent patterns (§4.7) — defer / opportunistic
Not urgent. When next touching these lines: standardise MH live on the generic
`ProcessLineLiveDashboard` (retire the bespoke `PklMhLiveDashboard`), and pick one spec source
(generic `/quality/fetch` vs PKL's own `/stations/pkl/spec-limits`). Track as tech-debt; don't
block Phases 1–2 on it.

### 3C. Update `PROJECT_STRUCTURE.md` (§4.8)
Rewrite the HRS/PKL section to the real architecture: `lib/processConfig.ts` +
`components/process/bodies/*` (`HrsSlitBuilder`, `PklCoilForm`, `PklChartGrid`) instead of the
removed `pages/forms/*` and `processSectionRegistry.tsx`. Do this alongside Phase 1 so the doc
matches the code someone will be editing.

## Sequencing, testing, rollback

**Order:** 1A → 1B (ship together) → 2C → 2B → 2A → 3A → 3C → (3B later). 2C before 2B because
the SWR hook supersedes the no-arg `loadQueue()` path; 2A after 2B so completion wiring is
changed once the queue source is stable.

**Testing per phase**
- Unit (Vitest, already in the client): `resetForLine`, optimistic-start rollback, `mapQueue`.
- Manual smoke on a shared terminal (the real risk surface): HRS↔PKL switch, double-start,
  complete-from-body vs rail, two-terminal queue freshness.
- Regression: RWD/ANN/CRS/CTL also ride `processStore`/`ProcessHub` — after 1A/2B, sanity-check
  RWD combine and ANN charge board still work (they share the store and hub).

**Rollback:** each phase is an independent PR. Phase 1 is additive (new action + rollback
branch) and trivially revertible. Phase 2B is the one to feature-flag or land behind a careful
review since the queue is shared by all six process lines.
