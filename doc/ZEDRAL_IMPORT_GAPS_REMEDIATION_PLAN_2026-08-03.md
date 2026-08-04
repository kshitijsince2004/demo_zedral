# Per-Line Import — Gap Remediation Plan

**Date:** 2026-08-03
**Lines in scope:** HRS · PKL · ANN · RWD (CRS/CTL explicitly out of scope for this plan)
**Follows:** `doc/ZEDRAL_IMPORT_FAILSAFE_AND_DEDUP_PLAN.md` (A1–A4 / B1–B3 — already implemented)
**Goal:** close the residual gaps left after the fail-safe/dedup work, so that (1) an import can **never** inject a duplicate for a coil already live/complete on a line, (2) the preview an operator sees matches what commit actually does, and (3) every HRS/PKL/ANN/RWD machine head reliably sees and can use their line's import.

---

## 0. Current state (verified in code)

The fail-safe/dedup plan is **implemented and correct** for the happy paths:

- `ProcessRouteService.createJourney` is an upsert on `order_journey(coil_no) WHERE status='ACTIVE'` (A1). ✅
- `ProcessRouteService.linkBatchToJourney` guards against backward moves and re-activating `COMPLETED`/`SKIPPED` steps (A2). ✅
- `PPCImportService.checkProductionSafety` joins CRM + RWD + HRS + PKL + ANN and consults the journey (A3). ✅
- `classifyJourneyForLine` returns `new` / `already-in-line` / `already-advanced` and is called from preview, CSV commit, and XLSX commit (A4). ✅
- Line scope (`LINE_IMPORT_SCOPE`, `parseImportLineScope`) + `assertLineOperation(user, line, 'WRITE')` on preview/commit endpoints (B1). ✅
- `LineMhImportPage` (HRS/PKL/RWD) + `AnnMhImportPage`, nav items, and routes (B2/B3). ✅ **but uncommitted — see G6.**

So this plan is **not** a rewrite. It is five targeted fixes on top of a working base.

---

## 1. The gaps (root cause + evidence)

**G1 — New-batch imports skip the coil-level production safety check. (SEVERITY: high — the last real duplication vector)**
Both write paths run `checkProductionSafety` **only when an existing `ppc_batch` is found**:
- `PPCImportService.upsertRollingPlanRow` (XLSX) — safety at L1353, inside `if (existing)`; the `else` insert branch (L1388–1406) has **no** safety call.
- `PPCImportService.upsertPpcRow` (CSV) — safety at L704, inside `if (existing)`; the new-batch branch has **no** safety call.
The only guard on a brand-new `batch_number` is `classifyJourneyForLine`. If a coil is already live/complete on a line but has **no ACTIVE journey**, or its journey route has **no step for that line** (`steps.find(process_code === X)` is undefined ⇒ classed `new`), a fresh `ppc_batch` is injected with the coil-level `hrs_order`/`pkl_order`/`ann_charge` never consulted → **duplicate order**. This is exactly the "fail closed" case the failsafe plan intended to cover, but the safety net isn't wired into the inject path.

**G2 — Preview is less thorough than commit (preview ≠ commit). (SEVERITY: medium — trust/UX + hidden risk)**
`previewRollingXlsx`'s existing-batch enrichment query (L955–978) joins only `crm_order`, `crm_rolling`, `crm_skinpass`, `rwd_order`, `hrs_order`, `pkl_order`. It is **missing** the ANN join (`ann_charge_coil`/`ann_charge`) and the production tables (`prod_hrs`/`prod_pkl`/`prod_rwd`) that `checkProductionSafety` (L488–518) has. Its `hasProduction` (L1007–1009) only checks rolling/skinpass weight. Result: for an ANN-scoped import, or a process-line coil whose live order sits under a **different** `batch_number` than the imported row, preview labels rows `new`/`safe-update` that **commit then rejects**. The operator sees "12 new," clicks import, and some silently skip.

**G3 — Client route guards are inconsistent across lines. (SEVERITY: low)**
In `App.tsx`: `/machine-head/hrs/import` and `/machine-head/pkl/import` use bare `<MachineHeadRoute>`, while `/machine-head/ann/import` and `/machine-head/rwd/import` add `allow={[UserRole.SUPERVISOR]}` (L241–244). The server allows `SUPERVISOR` on all four scoped endpoints. Net effect: a supervisor can open ANN/RWD import but not HRS/PKL import — an inconsistency, not a security hole.

**G4 — `advanceJourney` is not transactional. (SEVERITY: low — pre-existing, import-adjacent)**
`ProcessRouteService.advanceJourney` (L372–450) runs COMPLETE-current → `enqueueNextStep` → set-next-PENDING → move-pointer on the raw `db` connection, not one transaction. A crash mid-advance can leave the current step `COMPLETED` with the next step never enqueued — which then **looks importable** and interacts with G1.

**G6 — The HRS/PKL/RWD import feature is uncommitted, and mixed-assignment desks don't get it. (SEVERITY: high for "why can't I see it")**
`git status`: `LineMhImportPage.tsx` is **untracked**; `MachineHeadNav.tsx`, `App.tsx`, `PPCImportService.ts`, `AnnMhImportPage.tsx` are **modified, not committed**. So no built/deployed app shows the button yet. Additionally, `MachineHeadNav` only renders the line-scoped Import when the desk resolves to exactly HRS, exactly PKL, or the HRS+PKL pair (`isHrsMhDesk`/`isPklMhDesk` in `pklMhDesk.ts` require `ops.length===1` or a matching `focus`). A machine head assigned **HRS/PKL plus another line** falls through to `ALL_NAV_ITEMS`, whose Import points at the plant-wide `/import/rolling` (supervisor-oriented) — so those MHs get no working line import.

*(G5 reserved — CRS/CTL line coverage — intentionally deferred; out of scope per decision to keep to the 4 wired lines.)*

---

## 2. Fix plan (sequenced by engineering risk)

### Phase 1 — Data safety (stops the last duplication vector)

**F1 — Run coil-level safety on the inject path (closes G1).**
In `upsertRollingPlanRow` and `upsertPpcRow`, move/duplicate the `checkProductionSafety` call so it runs for **new** batches too, not only existing ones. Because `checkProductionSafety` currently keys off an existing `ppc_batch` row (`where pb.batch_id = …`), add a **coil-scoped** safety helper that takes `(coilNo, processCode)` and checks the live order/production tables + journey directly — independent of whether a `ppc_batch` exists yet:

```
// new: PPCImportService.checkCoilSafetyForLine(trx, coilNo, processCode)
//   → leftJoin hrs_order/pkl_order/ann_charge(+coil)/rwd_order + prod_* by coil_no
//   → reuse classifyJourneyForLine(trx, coilNo, processCode)
//   → returns { isDangerous, skipReason } with the same reason strings
```

Call order in both upsert functions:
1. `classifyJourneyForLine` (existing) → skip `already-in-line`/`already-advanced`.
2. **NEW:** `checkCoilSafetyForLine` → skip when the coil is `IN_PROGRESS`/`STOPPAGE`/`COMPLETED`/has-production on the target line even with **no journey / no matching step**.
3. Existing `ppc_batch` found → `checkProductionSafety` as today.
**Fail closed:** ambiguous ⇒ skip. This is additive; happy-path new coils (no order anywhere) still insert.

**F2 — Make preview use the same safety as commit (closes G2).**
Extend the preview existing-batch query (L955–978) to add the ANN joins (`ann_charge_coil`, `ann_charge`) and `prod_hrs`/`prod_pkl`/`prod_rwd`, and widen `hasProduction` to include those, so the enrichment mirrors `checkProductionSafety`. Better: have preview call the **same** `checkCoilSafetyForLine`/`checkProductionSafety` code path used at commit, so the two can never drift again. The row classifier then reports `in-production`/`completed`/`advanced-skipped`/`already-in-line` identically to commit. Add a regression assertion that preview status == commit outcome for a fixed fixture.

### Phase 2 — Ship the visible feature (makes the button real)

**F3 — Commit the per-line import wiring (closes the visible half of G6).**
Land the currently-uncommitted set as one reviewed change: `LineMhImportPage.tsx`, `MachineHeadNav.tsx`, `App.tsx`, `PpcRollingImportPanel.tsx`, `AnnMhImportPage.tsx`, `PPCImportService.ts`, and `tests/importFailsafeDedup.test.ts`. Build the client (`npm run build -w @m1/client`) and smoke the four MH desks before merging.

**F4 — Fix mixed-assignment desk detection (closes the rest of G6).**
In `MachineHeadNav`, when the desk isn't a pure HRS/PKL/ANN/RWD desk but the MH's `lineAccess`/machines **include** HRS or PKL, still surface the **line-scoped** Import item (pointing at `/machine-head/<line>/import`) rather than falling back to `/import/rolling`. Simplest implementation: derive the import target from `hrsPklAssigned(machines)` (and ANN/RWD equivalents) independently of the full desk resolution, and render one Import item per assigned importable line. Keep the plant-wide `/import/rolling` only for SUPERVISOR/ADMIN.

### Phase 3 — Consistency & durability (polish)

**F5 — Unify client route guards (closes G3).**
Make all four scoped import routes use the same guard. Recommended: bare `<MachineHeadRoute>` on all four (line access is already enforced inside `LineMhImportPage` and again server-side by `assertLineOperation`), OR add `allow={[UserRole.SUPERVISOR]}` to all four — but pick one and apply uniformly.

**F6 — Wrap `advanceJourney` in a transaction (closes G4).**
Run the COMPLETE→enqueue→PENDING→pointer sequence inside `db.transaction()`, passing the `trx` through to `QueueTransferService.enqueueNextStep` (it currently uses module-level `db`; thread the connection like `ProcessRouteService` already does elsewhere). Preserves behavior; removes the partial-advance window.

---

## 3. Files touched

| File | Change |
|---|---|
| `packages/server/src/services/PPCImportService.ts` | F1 new `checkCoilSafetyForLine` + call in `upsertRollingPlanRow`/`upsertPpcRow`; F2 preview joins/unify |
| `packages/server/src/services/ProcessRouteService.ts` | F6 transaction around `advanceJourney` |
| `packages/server/src/services/QueueTransferService.ts` | F6 accept `trx` param in `enqueueNextStep`/`recordHandoff` |
| `packages/client/src/components/layout/machinehead/MachineHeadNav.tsx` | F3 commit; F4 line-scoped Import for mixed-assignment desks |
| `packages/client/src/lib/pklMhDesk.ts` | F4 helper to resolve importable assigned lines independent of desk focus |
| `packages/client/src/App.tsx` | F3 commit; F5 uniform route guards |
| `packages/client/src/pages/machinehead/LineMhImportPage.tsx` | F3 commit (currently untracked) |
| `packages/client/src/components/admin/PpcRollingImportPanel.tsx` | F3 commit |
| `packages/server/tests/importFailsafeDedup.test.ts` | F1/F2 new cases (below); commit |

---

## 4. Tests (must-haves)

Add under `packages/server/tests/` (extend `importFailsafeDedup.test.ts`):

1. **Inject-path safety, no journey (F1):** create a live `pkl_order` for a coil with **no** `order_journey` → import a new `batch_number` for that coil scoped to PKL → assert **skipped** with `already IN_PROGRESS on PKL`, no new `ppc_batch`.
2. **Inject-path safety, journey missing the step (F1):** coil journey route `S` (HRS only), coil live/complete on ANN via an off-route charge → import ANN plan → assert skipped, not injected.
3. **Preview == commit (F2):** for one fixture with a mix of new / already-in-line / advanced / in-production coils, assert each preview `previewStatus` matches the commit action (insert vs skip + reason).
4. **Regression (unchanged behavior):** a genuinely new coil with no order anywhere still imports (guards must not over-block).
5. **Concurrency (already covered by A1):** keep the two-parallel-`createJourney` test green.
6. **Client (F4):** unit-test the nav helper — MH with `[HRS, CRM]` still yields an HRS import item at `/machine-head/hrs/import`.

Run: `npm run test -w @m1/server` and `npm run arch:check`.

---

## 5. Sequencing & effort

| Step | Item | Gap | Est |
|---|---|:--:|:--:|
| S1 | F1 `checkCoilSafetyForLine` + wire into both upserts (+ tests 1,2,4) | G1 | 1.0d |
| S2 | F2 preview/commit unification (+ test 3) | G2 | 0.75d |
| S3 | F3 commit + build + smoke the 4 MH import desks | G6 | 0.5d |
| S4 | F4 mixed-assignment desk nav (+ test 6) | G6 | 0.75d |
| S5 | F5 uniform route guards | G3 | 0.1d |
| S6 | F6 `advanceJourney` transaction | G4 | 0.5d |

**Total ≈ 3.5 days.** Do S1 + S2 first (data integrity), then S3 + S4 (make the feature real), then S5 + S6 (polish/durability).

---

## 6. Risk / blast radius

- **F1/F2** touch only the import commit/preview inside `PPCImportService`; the new safety helper is **additive** and fails closed. CRM happy path unaffected (CRM coils were already covered by `checkProductionSafety`). **Low.**
- **F3** is a pure "commit existing WIP" step; risk is that of the already-written code — de-risk with the smoke test on all four desks. **Low.**
- **F4** changes nav rendering only; keep the existing pure-desk paths byte-identical and add mixed-assignment resolution alongside. **Low.**
- **F5** is a one-line-per-route guard alignment. **Very low.**
- **F6** is the only change to the auto-advance path. Wrap-in-transaction is behavior-preserving; the risk is threading `trx` through `enqueueNextStep`. Cover with the existing advance tests. **Low–medium.**

**Explicitly not touched:** order lifecycle (start/stop/end/hold), `QueueTransferService` dedup semantics (`queue_handoff` unique), the `order_journey` unique index, CRS/CTL, timers/handover/shift flow.

---

## 7. Definition of done

- New-coil import of a coil already live/complete on a line is **skipped with a clear reason**, journey or not (F1).
- Preview counts and per-row statuses **exactly match** what commit does on the same file (F2).
- HRS, PKL, ANN, RWD machine heads each see an **Import** item that opens their line-scoped page — including MHs with mixed assignments (F3/F4).
- All four scoped import routes share one guard policy (F5).
- `advanceJourney` is atomic (F6).
- `npm run test -w @m1/server` and `npm run arch:check` green; the four new/updated tests pass.
