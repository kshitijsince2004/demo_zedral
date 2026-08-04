# HRS / PKL — Status-Rail Gate · Manual Stoppage · Run↔Stoppage Timer — Fix Plan

**Date:** 2026-08-02
**Scope:** HRS and PKL operator lines. RWD is the working reference (already server-hydrated);
Rolling (`sixHi/*`) is the behavioural reference.
**Verdict:** all three reported issues share **one root cause**. The server is already complete for
HRS and PKL — the bug is entirely on the **client**.

---

## 0. Root cause (one bug, three symptoms)

The HRS/PKL production rail and its timers are driven by **transient `processStore` state**
(`activeCoilNo`, `captureStatus`, `runStartedAt`, `stoppageStartedAt`, `activeStoppageId`). That state
is set optimistically on Start/Stoppage **and is never rehydrated from the server**. So on any page
refresh or navigation it resets to `idle`/`null`:

- `ProcessLayout` renders the rail only when `activeCoilNo && !hideShellRail && archetype !== 'B'`, and
  passes `status={captureStatus}` (transient). → after refresh `activeCoilNo` is `null` ⇒ **the rail
  disappears / gate is wrong** even though the order is `IN_PROGRESS` on the server. **(Symptom 1)**
- The Stoppage button (`onStoppage`) only fires `stopCapture()` when `captureStatus === 'running'`, and
  `processRailFlags` disables it unless `isRunning || isStoppage`. Post-refresh the store is `idle`, so
  **the stoppage button does nothing**. **(Symptom 2)**
- The rail timer switches with `useLiveTimer(f.isStoppage ? stoppageStartedAt : runStartedAt, …)`.
  Those timestamps are transient, so **the run/stoppage timer resets or shows nothing** after refresh,
  and `resumeCapture` sets `runStartedAt = now` (not the real `prod_start_at`) so **the run timer
  restarts from zero on Resume**. **(Symptom 3)**

Two secondary bugs make it worse:

- **Queue status squash:** `processStore.loadQueueFor` maps HRS/PKL `STOPPAGE → IN_PROGRESS`
  (`store/processStore.ts`, HRS ~L…, PKL ~L…). RWD keeps `STOPPAGE` via `mapRwdQueueStatus`. So the hub
  can never *see* a stopped order to rehydrate from.
- **RWD-only hydration:** `hydrateRwdRun` (store) + the rehydrate `useEffect` in
  `ProcessLiveStatusPage` (guarded `processCode !== 'RWD'`) exist only for RWD. HRS/PKL have no
  equivalent, even though `HrsOrderService.getOrder` / `PklOrderService.getOrder` already return
  `status`, `prodStartAt`, and `stoppages[]` (open one included).

**Why RWD and Rolling work:** RWD hides the shell rail and drives its own rail from
`fetchRwdOrder(...)` + `hydrateRwdRun(...)`. Rolling's `SixHiProductionActionRail` reads the **server
order object** every render (`order.status`, `order.activeStoppage.startAt`). Both are server-driven;
HRS/PKL are transient-store-driven. **The fix is to make HRS/PKL server-order-driven too.**

Server is ready (no server work beyond exposing one read):
`HrsOrderService` — `getOrder` (status/`prodStartAt`/stoppages), `findRunning` (`status IN
('IN_PROGRESS','STOPPAGE')`), `resumeCoil`, orphan-STOPPAGE self-heal. `PklOrderService` — `getOrder`,
`findActiveMachineOrder`, `startProduction`/`endProduction`, same self-heal.

---

## 1. Shared prerequisite — generic server hydration (do this first)

**P1. Un-squash STOPPAGE for HRS/PKL** — `store/processStore.ts`, `loadQueueFor` HRS & PKL branches:
change `raw === 'IN_PROGRESS' || raw === 'STOPPAGE' ? 'IN_PROGRESS'` to keep `STOPPAGE` as `STOPPAGE`
(mirror `mapRwdQueueStatus`). Extend the `ProcessQueueCard.status` handling wherever it assumes HRS/PKL
never stop.

**P2. Running-order read wrappers** — new `fetchHrsOrder(coilNo)` / `fetchPklOrder(coilNo)` client
helpers (mirror `lib/rewindingWrites.ts::fetchRwdOrder`). Back them with a GET route per line
(`GET /hrs-order/:coilNo`, `GET /pkl-order/:coilNo`) that returns `HrsOrderService.getOrder` /
`PklOrderService.getOrder` if such a route isn't already exposed (services exist; confirm/attach route).

**P3. Generalize hydration** — rename/extend `processStore.hydrateRwdRun` → **`hydrateProcessRun`**
(line-agnostic; key match on `coilNo`, and `batchNumber` for RWD). Keep `hydrateRwdRun` as a thin
alias so RWD keeps working. It already maps `status → captureStatus/queueStatus` and sets
`runStartedAt`/`stoppageStartedAt`/`activeStoppageId` — reuse verbatim.

**P4. Hydrate on load for HRS/PKL** — generalize the `ProcessLiveStatusPage` rehydrate `useEffect`
(currently `if (processCode !== 'RWD') return;`) to also run for HRS/PKL: when the queue shows an
`IN_PROGRESS`/`STOPPAGE` card and the store is idle, call `fetchHrsOrder/fetchPklOrder` → `hydrateProcessRun`.
Also invoke the same hydrate from `ProcessLayout` init (so the shell rail restores even if the operator
lands somewhere other than Live Status). This restores `activeCoilNo` ⇒ the shell rail re-appears.

*Files:* `store/processStore.ts`, `lib/rewindingWrites.ts` (+ new `lib/hrsPklWrites.ts` or extend),
`pages/process/ProcessLiveStatusPage.tsx`, `components/process/ProcessLayout.tsx`,
optional server route files `routes/hrsOrderRoutes.ts`, `routes/pklOrderRoutes.ts`.

---

## 2. Fix 1 — Status-rail gate on HRS/PKL

**Goal:** the rail is always present and correct for a running/stopped HRS/PKL order — Start when idle,
End when running, Resume when stopped — surviving refresh and navigation, exactly like RWD/Rolling.

**Changes (on top of §1):**
1. With P1–P4 done, `ProcessLayout`'s `activeCoilNo` and `captureStatus` are restored from the server,
   so the rail renders with the right gate. Verify `processRailFlags(status, coilNo)` mapping:
   `canStart = idle && coil`, `canResume = stoppage`, `canEnd = running` — no change expected.
2. **Drive the gate from server status, not just the local flag.** In `ProcessLayout`, prefer the
   hydrated `captureStatus` (now server-sourced). Guard against the optimistic-vs-server race: after a
   Start/Stoppage/End POST resolves, re-hydrate from the returned order (both HRS/PKL start/stoppage
   endpoints already return the order/`stoppageId`).
3. Ensure the rail is not hidden for HRS/PKL: `hideShellRail` must stay `false` for them (it's RWD-only
   today — leave as-is).

**Acceptance:** open an HRS order → Start → refresh browser → rail still shows **End** + live runtime;
enter Stoppage → refresh → rail shows **Resume** + stoppage timer; End → lands on Completed. Same for PKL.

---

## 3. Fix 2 — Manual stoppage button (rolling parity)

**Reference:** `sixHi/SixHiProductionActionRail.tsx` — Stoppage button label toggles
**"Stoppage" ↔ "Manage Stop"** on `hasActiveStoppage`, enabled via `canRecordStoppage(order)`
(`lib/sixHiRuntime.ts`), opens `OrderStoppageModal`; footer shows `StoppageTimerText` while stopped.

**Changes to `components/process/ProductionActionRail.tsx` + `ProcessLayout` wiring:**
1. Compute `hasActiveStoppage` from `captureStatus === 'stoppage'` (now server-hydrated) and show the
   button label **"Manage Stop"** when stopped, **"Stoppage"** when running (mirror rolling). Keep the
   existing "Resume" as the primary slot when stopped.
2. **Enable logic:** allow the button when `isRunning || isStoppage` (a `canRecordStoppage` equivalent)
   — but because state is now hydrated, this is reliable after refresh.
3. **Full wiring (already mostly present in `processStore`, make it first-class):**
   - Start stoppage → `stopCapture()` → `POST /stations/:line/stoppages/start` → store `activeStoppageId`
     + `stoppageStartedAt` (server `start_at`).
   - "Manage Stop" opens `OrderStoppageModal` (reuse the one already imported in `CaptureWorkspace`) to
     categorize/close; on confirm → `POST /stations/:line/stoppages/:id/end`.
   - Resume (primary) → `resumeCapture()` → ends the open stoppage, returns to running.
   - `cancelStoppage()` (abort without counting) already exists — keep.
4. Make the button reachable from the **rail on both the console and Live Status**, not only when the
   local store happens to be `running` (the `onStoppage` handler in `ProcessLayout` currently calls
   `stopCapture()` only if `captureStatus==='running'` — extend it to open Manage-Stop when already
   stopped, matching rolling).

**Acceptance:** with an HRS/PKL order running, press **Stoppage** → timer flips to stoppage, server
`txn.stoppage` row opens (visible in stoppage history); button now reads **Manage Stop**; press
**Resume** → stoppage closes with duration, run timer resumes. Refreshing mid-stoppage keeps the open
stoppage and the Manage-Stop/Resume state.

---

## 4. Fix 3 — Run ↔ Stoppage timer switch (HRS/PKL)

**Goal:** when an order is running the **run timer** ticks; the moment a stoppage starts, the run timer
stops and the **stoppage timer** starts (and vice-versa on resume) — consistent with rolling, and
correct after refresh.

**Changes:**
1. The switch logic already exists (`ProductionActionRail` + `ProcessLiveStatusPage`
   `useLiveTimer(captureStatus==='stoppage' ? stoppageStartedAt : runStartedAt)`). Make the two
   timestamps **server-sourced** via §1 hydration: `runStartedAt = order.prodStartAt`,
   `stoppageStartedAt = open stoppage.startAt`.
2. **Bug to fix in `processStore.resumeCapture`:** it sets `runStartedAt: now.toISOString()` on every
   start — on a **Resume** this restarts the run clock from zero. On resume, restore `runStartedAt` to
   the order's original `prodStartAt` (re-hydrate from the resume response) so runtime is continuous;
   only a brand-new Start uses `now`. (Decide the display convention with plant: wall-clock since
   `prod_start_at` vs net-of-stoppage. Rolling's `ProductionRuntimeFooterText` uses `prodStartAt`
   continuous; `endProduction` already subtracts stoppage minutes via `netProdDurationMin`, so keep the
   footer continuous and let the server compute net on End.)
3. On stoppage-start, set `runStartedAt = null` (already done) so the run timer is unambiguously paused;
   on resume set `stoppageStartedAt = null` (already done).

**Acceptance:** run timer increments while running; on Stoppage it freezes and the stoppage timer
counts up from the server `start_at`; on Resume the stoppage timer disappears and the run timer
continues from the original start (not zero); all correct across a refresh.

---

## 5. Sequencing, effort, risk

| Step | Item | Est |
|---|---|:--:|
| S1 | §1 P1–P4 generic hydration (un-squash, fetch wrappers, `hydrateProcessRun`, hydrate-on-load) | 1.5d |
| S2 | Fix 1 rail gate verification + post-POST re-hydrate | 0.5d |
| S3 | Fix 2 manual stoppage button (label toggle, enable logic, Manage-Stop/Resume wiring) | 1d |
| S4 | Fix 3 timer switch + `resumeCapture` run-clock bug | 0.5d |
| S5 | Tests: hydrate after refresh (unit on `hydrateProcessRun`), rail-flags gate, stoppage open/close round-trip | 1d |

**Do S1 first** — it unblocks all three fixes. S2–S4 are then small and mostly verification.

**Risk / guardrails:**
- **Do not touch RWD or Rolling paths** — generalize `hydrateRwdRun` behind an alias so RWD is
  byte-for-byte unchanged; keep `hideShellRail` RWD-only.
- The optimistic-then-server race: always reconcile to the server order after a POST resolves, so the
  gate can't get stuck in an optimistic state.
- Preserve the existing orphan-stoppage self-heal (server already downgrades a dangling `STOPPAGE` with
  no open row back to `IN_PROGRESS`) — the client hydrate must respect the healed status.

**Test hooks that already exist:** `client/tests/processRailFlags.test.ts`,
`client/tests/hrsPklConsole.test.ts` — extend these; add a `hydrateProcessRun` unit test and a
stoppage open→close round-trip.

---

## 6. Files touched (summary)
- `packages/client/src/store/processStore.ts` — un-squash STOPPAGE (HRS/PKL); `hydrateRwdRun`→
  `hydrateProcessRun` (+alias); fix `resumeCapture` run-clock on resume.
- `packages/client/src/lib/rewindingWrites.ts` (+ new `hrsPklWrites.ts`) — `fetchHrsOrder`/`fetchPklOrder`.
- `packages/client/src/pages/process/ProcessLiveStatusPage.tsx` — generalize rehydrate effect to HRS/PKL.
- `packages/client/src/components/process/ProcessLayout.tsx` — hydrate on init; extend `onStoppage`
  (Manage-Stop when stopped); keep rail visible for HRS/PKL.
- `packages/client/src/components/process/ProductionActionRail.tsx` — Stoppage/Manage-Stop label toggle,
  enable logic parity with `SixHiProductionActionRail`.
- `packages/server/src/routes/hrsOrderRoutes.ts`, `pklOrderRoutes.ts` — expose `GET /:coilNo` running-order
  read **only if not already present** (services already implement it).
- Tests under `packages/client/tests/`.
