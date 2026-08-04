# Per-Line Import as Fail-Safe + Re-Import Dedup — Implementation Plan

**Date:** 2026-08-02
**Lines:** HRS · PKL · ANN · RWD (CRM/rolling is the reference import engine).
**Goal:** each line can import a plan as a **fail-safe** (inject an order the journey didn't deliver),
but importing must be **idempotent against the journey** — an order already present (via journey
advance or a prior import) must never be re-created or reset.

---

## 0. How the flow works today (verified)

1. **One journey per coil.** `ProcessRouteService.createJourney(coilNo, routeRaw)` builds
   `planning.order_journey` (one row, `current_step_no`) + `order_journey_step` (one per route token,
   e.g. `S`→HRS, `P`→PKL, `F`→ANN, `R`→RWD). It's **idempotent by read**: `where coil_no = … ; if
   existing return`.
2. **Forward advance.** On order complete, `advanceJourneyByCoil` marks the current step `COMPLETED`,
   finds the next non-`SKIPPED` step, and calls **`QueueTransferService.enqueueNextStep`** to create the
   next line's queue batch. `enqueueNextStep` is **well dup-guarded**: returns the existing
   `queue_batch_id`, and consults `planning.queue_handoff` (unique on
   `journey_id+source_step_id+target_step_no`) — so the *journey path* never double-enqueues. ✅
3. **Each line's queue = its journey step.** `HrsOrderService.getQueue` / `PklOrderService.getQueue` /
   `ProcessStationService` read `order_journey_step` where `process_code = <line>` and step/journey
   status is active. The line "sees" an order only while its step is live.
4. **Import today = one PPC engine, surfaced per page.** `PPCImportService` (1194 LOC) builds
   `ppc_batch` + links to the journey via `linkBatchToJourney`. It's shown on `RollingImportPage` and
   `AnnMhImportPage` (both render `PpcRollingImportPanel`). **HRS/PKL/RWD have no dedicated import** yet.

**Good protections already in place:** `enqueueNextStep` dedup, `createJourney` idempotent read,
`PPCImportService.checkProductionSafety` (skips IN_PROGRESS/COMPLETED/allocated/has-production for
CRM/RWD), and PPC preview row statuses (`duplicate-skipped`, `skippedProduction/Completed/Allocated`).

---

## 1. The three duplication vectors (root cause of the reported bug)

Your scenario — *coil completes HRS → journey advances to PKL → someone imports a plan into PKL → the
coil gets re-imported and duplicates* — is caused by three concrete gaps:

**V1 — `linkBatchToJourney` has no backward-move / completed-step guard. (SEVERITY: high)**
`ProcessRouteService.linkBatchToJourney` (L177–222) unconditionally sets the target step to `ACTIVE`
(`started_at = now`, `queue_batch_id = batchId`) and `order_journey.current_step_no = step.step_no`.
On re-import of an already-advanced coil it will **move `current_step_no` backward** and/or
**re-activate a `COMPLETED` step**, stomping `queue_batch_id` and resetting timestamps → the order
"reappears" upstream or the live PKL step gets overwritten. **This is the primary corruption path.**

**V2 — `checkProductionSafety` is blind to HRS/PKL/ANN and to journey progress. (SEVERITY: high)**
`PPCImportService.checkProductionSafety` (L381–431) only joins `crm_order`, `crm_rolling`,
`crm_skinpass`, `rwd_order`, `prod_rwd`. For an HRS/PKL/ANN order it computes `orderStatus = null` ⇒
`isDangerous = false` ⇒ **treats a live/complete process-line coil as safe to re-import/overwrite**. It
never consults `order_journey.current_step_no` / step status, so it has **no notion of "this coil has
already progressed down the route."**

**V3 — `order_journey.coil_no` is only a plain index, not UNIQUE. (SEVERITY: medium)**
Migration `1783…` creates `ix_order_journey_coil` (non-unique). `createJourney`'s "if existing return"
is a **read-then-write race**; two concurrent imports of the same coil can create **two journeys**.

---

## 2. Fix plan

### Part A — Make import journey-aware & idempotent (server core)

**A1 — Unique journey per coil (close V3).**
Migration (additive, idempotent): add a **partial UNIQUE index** on `planning.order_journey(coil_no)
WHERE status = 'ACTIVE'` (allows a historical COMPLETED journey to coexist if a coil is ever re-run,
but forbids two live journeys). Make `createJourney` an upsert: `insert … onConflict(coil_no) do
nothing`, then re-select and return the existing `journey_id`. Removes the race.

**A2 — Guard `linkBatchToJourney` (kills V1).**
Before mutating a step, load the journey's `current_step_no` and the target step's status. Apply:
- If target `step_no < current_step_no` → **no-op** (never move backward).
- If target step status is `COMPLETED` or `SKIPPED` → **no-op** (already handled downstream).
- Only set `ACTIVE` + advance `current_step_no` when the target is the current/next **PENDING** step
  that has no live order. Otherwise just (idempotently) attach `queue_batch_id` without resetting
  `started_at` or moving the pointer.

**A3 — Line-complete + journey-aware `checkProductionSafety` (kills V2).**
Extend the safety query to also `leftJoin` `txn.hrs_order`, `txn.pkl_order`, and the ANN order/charge
table (+ their production tables), and to read the coil's `order_journey` (`current_step_no`) and the
**target line's step status**. Recompute:
- `orderStatus = firstNonNull(crm, rwd, hrs, pkl, ann)` for the coil/batch.
- `journeyAdvancedPast(targetLine)` = journey exists AND (target step `COMPLETED` OR
  `current_step_no > targetStepNo`).
- `isDangerous / skipReason` also true when the line order is `IN_PROGRESS/STOPPAGE/COMPLETED` **or**
  `journeyAdvancedPast`. New reasons: `"Coil already <status> on <line> — cannot re-import"`,
  `"Coil has advanced past <line> in its route (now at <currentLine>) — handled downstream"`.

**A4 — Journey-aware row classification in the import (the fail-safe logic).**
In `upsertPpcRow` (and the line-scoped preview), classify each row against the coil's journey/target
step before writing:
- **new** → no journey OR target step is a live PENDING with no order → **inject** (this is the
  fail-safe: the order the journey didn't deliver).
- **already-in-line** → target step already PENDING/ACTIVE with a queue batch/order → **skip** (idempotent).
- **already-advanced** → target step COMPLETED or `current_step_no` beyond → **skip** (your exact case).
- **in-production / locked** → line order live/allocated/has-production → **skip** (A3 reasons).
Only **new** rows create/link; the rest are reported and skipped. Reuse the existing preview status
enum (`duplicate-skipped`, add `advanced-skipped`, `already-in-line`).

### Part B — Per-line import fail-safe surface (client + route)

**B1 — Line-scoped preview endpoint.** Add `POST /import/ppc/preview?line=HRS|PKL|RWD` (reuse the PPC
preview pipeline) that filters rows to the line's route token and runs A3/A4 classification, returning
per-row status + reason. No new engine — a thin scope wrapper over `PPCImportService`.

**B2 — Import pages for HRS/PKL/RWD.** Mirror `AnnMhImportPage` (which renders `PpcRollingImportPanel`)
on each line's machine-head desk — `HrsMhImportPage`, `PklMhImportPage`, `RwdMhImportPage` — passing the
`line` scope so the panel calls the scoped preview/commit. Wire routes under `MachineHeadRoute` like the
ANN import route.

**B3 — Preview UX.** Surface the skip classes prominently (counts + per-row reason), so the operator
sees "12 new · 3 already in line · 2 advanced (skipped) · 1 in production (skipped)" before commit. The
`PpcRollingImportPanel` already renders skip counters — extend it with the new classes.

### Part C — Idempotency & tests

**C1 — Constraints.** Confirm/keep `ppc_batch.batch_number` unique; `queue_handoff` unique (present);
add the A1 journey index. Reuse `txn.idempotency_key` for commit replays.

**C2 — Tests (must include your scenario).**
- **Re-import advanced coil:** import coil → start+complete HRS → assert PKL step enqueued once →
  re-import the same coil scoped to PKL → assert **no new ppc_batch/queue row**, journey `current_step_no`
  unchanged, row classified `advanced-skipped`. *(This is the regression test for the reported bug.)*
- **Safety coverage:** HRS/PKL/ANN order `IN_PROGRESS`/`COMPLETED` → import skipped with correct reason.
- **Backward-move guard:** `linkBatchToJourney` on a completed/earlier step is a no-op.
- **Concurrency:** two parallel `createJourney(sameCoil)` → exactly one journey (A1).
Add under `packages/server/tests/` (see existing `processRouteEngine.preservation.test.ts`,
`crsForCtlRouting.unit.test.ts` for patterns).

---

## 3. Sequencing, effort, risk

| Step | Item | Est |
|---|---|:--:|
| S1 | A2 `linkBatchToJourney` backward/completed guard (+ unit test) | 0.5d |
| S2 | A1 journey unique index + `createJourney` upsert | 0.5d |
| S3 | A3 line-complete + journey-aware `checkProductionSafety` | 1d |
| S4 | A4 row classification (new/already-in-line/advanced/in-production) | 1d |
| S5 | B1 scoped preview endpoint + B2 HRS/PKL/RWD import pages | 1.5d |
| S6 | B3 preview UX skip classes | 0.5d |
| S7 | C2 tests incl. the re-import regression | 1d |

**Do S1 + S2 + S3 first** — they stop the corruption/duplication immediately even before the per-line
UI ships. S4–S6 build the fail-safe surface on top. ~6 days total.

**Risk / guardrails:**
- **Don't touch the working paths:** `QueueTransferService.enqueueNextStep` dedup and the CRM PPC happy
  path stay as-is. All new logic is additive and gated behind the classification/scope.
- **Additive, idempotent migrations** with working `down` (the journey index especially — build it
  `CONCURRENTLY`/`IF NOT EXISTS` and pre-check for existing duplicate active journeys before adding the
  unique index; de-dupe any found first).
- **Fail closed:** when journey/order state is ambiguous, classify as skip (never inject) — duplication
  is worse than a manual re-try.
- Keep `SKIPPED` steps (e.g. CRS-For-CTL) semantics intact in A2/A4.

---

## 4. Files touched (summary)
- `packages/server/src/services/ProcessRouteService.ts` — A1 (`createJourney` upsert), A2
  (`linkBatchToJourney` guard).
- `packages/server/src/services/PPCImportService.ts` — A3 (safety joins + journey check), A4 (row
  classification, preview statuses).
- `packages/server/migrations/…_order_journey_unique_coil.js` — A1 partial unique index (+ pre-dedupe).
- `packages/server/src/routes/importRoutes.ts` (or `sixHiRoutes` PPC preview) — B1 `?line=` scope.
- `packages/client/src/pages/machinehead/{hrs,pkl,rwd}/…MhImportPage.tsx` — B2 (mirror `AnnMhImportPage`).
- `packages/client/src/components/admin/PpcRollingImportPanel.tsx` — B3 skip-class counters + `line` prop.
- `packages/server/tests/…` — C2 regression + safety + concurrency tests.

---

## 5. Machine-Head line-scoped import access (requested)

**Requirement:** import must be available to the Machine Head of their **respective assigned line(s)** —
an HRS MH imports only HRS, a PKL MH only PKL, etc.

**Good news — the enforcement primitive already exists.** `assertLineOperation(user, line, 'WRITE')`
(`auth/lineAccessPolicy.ts`) checks the user's `security.line_access` (derived from their assigned
machines via `MachineAccessService.lineAccessFromMachines`). For `WRITE` it requires an
`OPERATOR`/`MACHINE_HEAD` role **and** a matching line scope. So scoping import to the assigned line is
just calling this on the new endpoints — no new access model.

**Server (B1 endpoints):**
- The line-scoped preview/commit (`POST /import/ppc/preview?line=HRS|PKL|RWD|ANN`, `…/commit`) call
  `assertLineOperation(req.user!, line, 'WRITE')` **before** running. A MH without `line_access` to that
  line gets 403 automatically. `ADMIN` bypasses (superuser).
- **Decision needed on SUPERVISOR:** today the plant-wide PPC endpoints allow `[ADMIN, SUPERVISOR,
  MACHINE_HEAD]` by role only (not line-scoped). But `assertLineOperation` `WRITE` currently accepts
  only `OPERATOR`/`MACHINE_HEAD` (not `SUPERVISOR`). Recommended: **keep the existing plant-wide PPC
  import for ADMIN/SUPERVISOR unchanged**, and add the **line-scoped** import for **MACHINE_HEAD**
  (their assigned lines). If SUPERVISORs should also use the line-scoped path, add `SUPERVISOR` to the
  `WRITE` allow-list in `assertLineOperation` or pass an explicit `allowRoles` — a one-line, isolated call.

**Client (B2 pages + nav):**
- Gate each per-line import route with `MachineHeadRoute` **plus** a line-access check against
  `authStore.lineAccess` — redirect/hide if the line isn't assigned (mirror how `AccessDenied` already
  reads `lineAccess`/`machineAccess`).
- Show the **Import** nav item on a line's MH desk only for lines in the MH's `lineAccess`. Reuse the
  existing MH desk **focus** resolution (`resolveMhDesk` / `mhDesk`) so a single-line MH lands directly
  on their line's import, and a multi-line MH sees one per assigned line.

**Net:** zero new access plumbing — the per-line import inherits the plant's existing line-access model;
a MH sees and can commit imports only for the line(s) they own.

---

## 6. Impact / blast-radius analysis

Scope of the changes is **contained to the import subsystem + one DB index migration.** The order
lifecycle, the journey auto-advance path, and the CRM/rolling happy path are **not** on the change list.

| Change | Who calls it / touches | What it affects | Risk | Mitigation |
|---|---|---|:--:|---|
| **A2** guard `linkBatchToJourney` | **2 callers, both `PPCImportService`** (import only) | Import commit for all lines incl. CRM — only *prevents backward moves / completed-step re-activation* (desired everywhere) | **Low** | Journey auto-advance (`enqueueNextStep`) is a different path — untouched |
| **A1** `createJourney` upsert | 3 callers: import, fan-out child journeys (**distinct child `coil_no`** — verified), manual station coil | Still returns existing journey — behaviour-preserving | **Low** | Semantics unchanged for all 3 callers |
| **A1** unique partial index on `order_journey(coil_no)` | DB-wide (whole `order_journey` table) | Journey creation across every line | **Medium** | **The one cross-cutting change.** Pre-dedupe existing duplicate ACTIVE journeys in the migration, `WHERE status='ACTIVE'`, `IF NOT EXISTS`, build `CONCURRENTLY`, working `down` |
| **A3** broaden `checkProductionSafety` | **2 callers, both `PPCImportService`** | Import commit — now also skips live/complete/advanced HRS/PKL/ANN coils | **Low–Med** | CRM already covered (no change for CRM); only block on live/complete/allocated/advanced, still allow updates on PENDING/PREPARING; clear skip reasons |
| **A4** row classification | Import commit + preview only | Import UX/behaviour | **Low** | Additive; no effect outside import |
| **B1/B2** scoped endpoint + per-line pages | New/additive | New MH import surface | **Low** | Keep `PpcRollingImportPanel` default (no `line` prop) so Rolling/ANN pages are byte-identical |
| **B3** panel skip-class counters + `line` prop | `PpcRollingImportPanel` | Import preview UI | **Low** | Optional prop; default path unchanged |

**Explicitly NOT affected** (verified by caller mapping):
- **Order lifecycle** (start / stoppage / end / hold) — untouched.
- **Journey auto-advance** (`advanceJourneyByCoil` → `QueueTransferService.enqueueNextStep`, with its
  `queue_batch_id` + `queue_handoff` dedup) — untouched; still the primary line→line mover.
- **CRM / rolling PPC import happy path** — preserved (safety already covered CRM/RWD; the new guard only
  blocks backward/duplicate moves, which is also correct for CRM).
- **Other lines' queues, timers, handover, shift flow** — untouched.
- **The HRS/PKL rail-stoppage-timer fix** (separate workstream) — fully independent; no shared files.

**Bottom line:** the only change that reaches beyond `PPCImportService` + `ProcessRouteService` is the
`order_journey` unique-index migration, and that is de-risked by pre-deduping and a partial/`IF NOT
EXISTS` index. Everything else is import-local or purely additive, so regression risk to the working
lines is low — provided the migration pre-dedupe runs and the `PpcRollingImportPanel` default path is
preserved. Add the MH line-scoped access as **S0** (~0.5d) since it reuses `assertLineOperation`.
