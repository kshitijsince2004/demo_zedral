# HRS & PKL Line Audit — measured against the Rolling (6HI) reference

**Scope:** HR Slitting (`HRS`) and Pickling (`PKL`) operator lines — client flow, server
routes/services, and where they diverge from or interfere with the Rolling (6HI) workspace,
which is the most mature line and the intended reference for user flow and functionality.

**Method:** traced end-to-end from routing → hub → capture → server write, for all three lines.
Every finding below cites `file:line`. This is a functional/flow audit (what works, what's
broken, what interferes) — not a style pass.

---

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

---

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

---

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

---

## 5. Priority fix list

1. Reset `useProcessStore` on line switch (§4.1) — stops cross-line state bleed.
2. Roll back optimistic Start and surface the conflict banner (§4.2) — stops "phantom running" coils.
3. Unify the two order-completion paths (§4.3).
4. Put HRS/PKL queue on SWR (§4.4) and fix `loadQueue()` to honour its line (§4.5).
5. Delete the redundant `/stations/*` HRS/PKL queue + `hrs-order` stoppage twins (§4.6).
6. Refresh `PROJECT_STRUCTURE.md` (§4.8).

Items 1 and 2 are the ones an operator actually feels; everything else is correctness-hardening
and maintenance.
