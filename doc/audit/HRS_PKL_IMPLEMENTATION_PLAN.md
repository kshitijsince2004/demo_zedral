# HRS & PKL — Implementation Plan

Companion to `HRS_PKL_LINE_AUDIT.md`. Each finding (§4.1–§4.8) is mapped to concrete code
changes, sequenced by operator impact, with files, approach, risk, and verification.

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

---

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

---

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

---

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

---

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
