# 2HI Rewinding / RWD — Code Audit & Gap Report

**Date:** 2026-08-03  ·  **Scope:** RWD order lifecycle + 2HI "Rewinding mode" cutover (commit `66d3005`), with focus on **Machine Head of RWD** and on **not regressing 2HI Skin Pass**.
**Governing plans:** `doc/Zedral_2HI_Rewinding_Mode_Plan.md`, `doc/Zedral_Rewinding_Line_Completion_Plan.md`, `.kiro/rwd-plan-sourcing.md`.

---

## 1. Headline verdicts

| Question | Verdict |
|---|---|
| Does the RWD work break **2HI Skin Pass**? | **No — safe.** Verified architecturally and confirmed the cutover commit never touches `SharedSkinPassForm`. |
| Is the **Machine Head of RWD** functional? | **Yes, end-to-end** (live queue → MTP → allocate → capture → end/stoppage/hold), **with the gaps below.** |
| Any **high-severity** gaps? | **Yes — 2.** Combined-order capture loses sibling production data; "End" with no "Save" completes an order without a `prod_rwd` row **and without advancing the journey to Annealing**. |

---

## 2. Why Skin Pass of 2HI is safe (verified, not assumed)

The core de-risking principle from the plan held in the implementation:

- **`SixHiSubProcess` was NOT extended.** It stays `ROLLING | SKIN_PASS`. Rewinding rides an entirely separate pipeline: `txn.rwd_order` + `txn.prod_rwd`, never `txn.crm_order`.
- **`SixHiHub` early-returns for rewinding** (`SixHiHub.tsx:106‑109`): `if (activeTab === 'rewinding') return <TwoHiRewindingHub/>`. The skin-pass/rolling engine `SixHiCrmHub` only ever runs with `apiSubProcess ∈ {ROLLING, SKIN_PASS}` (`SixHiHub.tsx:128`). A rewinding card can never reach the skin-pass card builder.
- **Skin-pass queue filter excludes rewinding** — `SixHiService.getQueue` filters `pb.sub_process = subProcess` (`SixHiService.ts:541/552/564`). A 2HI rewinding batch carries `sub_process='REWINDING'`, so `getQueue('2HI','SKIN_PASS')` can never return it.
- **Default 2HI tab unchanged** — `millProcessTabs('2HI') = ['skinpass','rewinding']`, `normalizeMillTab('2HI', null) → 'skinpass'` (`millConfig.ts:22‑40`). Existing 2HI operators still land on Skin Pass.
- **Registry seed is inert** — `MachineMasterService` maps only `['ROLLING','SKIN_PASS']` to capability flags (`MachineMasterService.ts:159`); the new `REWINDING`/`2HI_REWINDING` rows are ignored there.
- **The cutover commit did not modify `SharedSkinPassForm.tsx`** (confirmed via `git show 66d3005 --stat`); the file contains **zero** rewinding references.

Conclusion: **no shared mutable surface** between rewinding and 2HI skin pass. The only touch points are additive.

---

## 3. Gaps (ranked)

### HIGH

**G1 — Combined rewinding orders lose per-sibling production data.**
`RewindingOrderService.capture()` writes **one** `prod_rwd` row (the open coil) and then `endProduction()` cascades **all** combined siblings to `COMPLETED` — but siblings never get their own `prod_rwd`. The code says so: *"combined sibling prod_rwd (allocateCombinedRemainderToBlanks) deferred — End cascades status only"* (`RewindingOrderService.ts:836`). Completion Plan Phase 3 explicitly required a weight split across members for `prod_rwd`. **Impact:** shift **Total Prod MT**, weight reconciliation and traceability under-count every combined rewind; siblings show COMPLETED with no captured tensions/weight/thickness.
*Fix:* on capture/end of a combined group, split combined weight across members (mirror rolling's `allocateCombinedRemainderToBlanks`) and write a `prod_rwd` per member.

**G2 — "End" without "Save" completes an order with no production record and no journey advance.**
The journey advance to Annealing (`R → F`) is driven by `emitCaptured('RWD', …)` inside `ProductionService.saveRwd` — which only runs on **capture** (`ProductionService.ts:372`). `endProduction()` performs **no** capture and **no** `emitCaptured` (`RewindingOrderService.ts:747‑813`), and there is no guard that a `prod_rwd` exists. So `Start → End` (operator never presses **Save Production Data**) yields: `rwd_order=COMPLETED`, `coil=DONE`, **but** journey stuck at step `R` and **zero** `prod_rwd`. **Impact:** the coil never reaches the Annealing queue and no production data is recorded, while the order looks complete.
*Fix:* require capture before End (or fold a final capture into End), and emit the RWD captured event on completion so the journey advances.

### MEDIUM

**G3 — No surface-finish input when the plan value is blank (breaks locked RWD‑Q2).**
`RwdTensionForm` only forwards the plan surface: `surfaceFinish: planSurface ?? undefined` (`RwdTensionForm.tsx:104`). There is **no** Matt/Bright toggle when the plan is blank, so `prod_rwd.surface_finish` stays null for those coils. `.kiro/rwd-plan-sourcing.md` RWD‑Q2 (locked) requires an editable, required Matt/Bright toggle **only when the plan is blank**. Not implemented.

**G4 — Order-backed capture bypasses the offline outbox.**
The order path calls `captureRwdOrder()` → a **direct** `apiClient.patch` (`rewindingWrites.ts:64`), while the legacy path used `submitProcessCapture` (offline-queued). kiro §6 specifies `submitOrQueue`. **Impact:** rewinding capture now **fails offline**, a regression against the app's offline-first design (Android WebView outbox, etc.).

**G5 — RWD Machine-Head order detail 404s for pending queue cards.**
`RwdMhCoilDetailPage` calls `GET /rewinding/orders/:batchNo`, which uses `getExistingOrder()` and returns **404** when no `rwd_order` row exists yet (`rewindingRoutes.ts:164‑174`, `RewindingOrderService.ts:200‑208`). But `getQueue` returns plan rows via `LEFT JOIN`, defaulting `status='PENDING'` with **no** order row (journey-fed coils, or imports where `action!=='inserted'`). Clicking such a card shows a raw "Order not found". **Impact:** MH cannot inspect pending orders. *Fix:* fall back to plan/`ppc_batch` data (or lazily derive a read-only detail) instead of 404.

**G6 — No desk path to assign an *unallocated* rewinding order to 2HI.**
`getQueue('2HI')` returns only `machine_code='2HI'` rows and intentionally keeps unallocated RWD-pool plans on the RWD desk (`RewindingOrderService.ts:348‑354`). The RWD MH live screen's MTP hardcodes allocation to the current focus line — `allocateRwdMachine(card.batchNumber, liveLine)` with no machine picker (`RwdMhLiveDashboard.tsx:74`). So a rewinding order can reach 2HI **only** via import/manual with `Machine=2HI`, not by pulling from the shared unallocated pool. This deviates from Completion Plan Phase 1 ("operator/MH picks RWD or 2HI"). Confirm this matches intended ops; if not, add a machine picker on the RWD desk MTP (the operator hub's `RewindingMachineAllocationModal` already does this — it's just not surfaced on the MH live dashboard).

### LOW

**G7 — MH detail shows fields the API never returns.** `RwdMhCoilDetailPage` renders `tensionMpa` and `finishWeightMt` (`RwdMhCoilDetailPage.tsx:24‑25,51,54`), but `RwdOrderDetail` never includes them, so they are always "—". Captured tensions/finish weight (in `prod_rwd`) are never surfaced back to the MH.

**G8 — Registry-seed leftover / coupling smell.** `19510000000000_2hi_rewinding_sub_process.js` seeds `master.crm_sub_process('REWINDING','2HI_REWINDING')`. `'2HI_REWINDING'` is **dead** (referenced nowhere). `'REWINDING'` is used as the `ppc_batch.sub_process` FK for 2HI rows — putting a rewinding marker inside the **CRM** sub-process table, which the Completion Plan (Phase 0) flagged to reconsider. It is inert for capability flags but is a real FK dependency and a conceptual coupling of "rewinding" to the CRM sub-process registry.

**G9 — Manual order is always allocated.** `createManualBatch` sets `machine_allocated: true` (`RewindingOrderService.ts:1213`), whereas Completion Plan Phase 4 specifies "unallocated by default". Defensible (the modal forces a machine choice), but it skips the pick-later flow and is a deviation from the locked plan.

---

## 4. What is solid (keep)

- **Clean isolation** of rewinding from the CRM engine — the single biggest risk was avoided correctly.
- **Client/server logic parity is byte-identical** for `finishGroup`/`rwdFinishGroup` and the combine key (`coilNo|slitId|finishGroup`) — verified by extracting both and diffing across 13 finish inputs. `netProdDurationMin`, surface B/M mapping, and stoppage-minute math check out.
- **Concurrency & self-healing:** `ACTIVE_ORDER_CONFLICT` is re-checked *inside* the start transaction (`RewindingOrderService.ts:581‑601`); orphan `STOPPAGE` is healed on read (`healOrphanStoppageStatus`).
- **Route auth is correct** and additive: `MachineHeadRoute` passes on rank (MACHINE_HEAD+) **or** the explicit `allow` list, so `allow=[SUPERVISOR,OPERATOR]` on the RWD desk **adds** operators without excluding Machine Heads (`RoleRoute.tsx:63‑66`). Queue/mutation endpoints are line-gated (`assertMachineAccess`, WRITE for mutations, READ for queue).
- **Migration hygiene:** additive DDL, `IF NOT EXISTS`, working `down`, and a clean stoppage discriminator (`order_kind` + nullable `rwd_order_id`) with a backfill.
- **MH desk toggle** wired per the PKL/ANN pattern (`rwdMhDesk.ts`, `RWD_NAV_ITEMS`, shared RWD↔2HI focus in `MachineHeadNav`/`MachineHeadShell`).
- **Tests** present and correct by inspection: `rewindingOrderLifecycle.test.ts`, `rewindingPlanXlsxParser.test.ts` (incl. the 2HI branch), `rwdMhDesk.test.ts`, `rwd-operator.spec.ts`.

---

## 5. Verification notes

- Pure-logic parity (finish group, combine key, duration, surface map) validated via a dependency-free Node script — **all identical / correct**.
- The Vitest suites **could not be executed in this environment**: `node_modules` was installed on Windows (OneDrive), so the Linux native binaries for `rollup`/`esbuild` are missing (`Cannot find module @rollup/rollup-linux-x64-gnu`). This is a toolchain/platform artifact, **not** a code defect. Run `npm ci` on a Linux CI runner (or on the dev host) and execute `npm run test:unit -w @m1/server` + the client `rwdMhDesk.test.ts` to get a green bar.

## 6. Suggested fix order

1. **G2** (End without capture — data + journey correctness).
2. **G1** (combined sibling `prod_rwd`).
3. **G4** (offline capture) and **G3** (blank-plan surface toggle).
4. **G5** (MH detail 404) and **G6** (2HI assignment path — confirm intent first).
5. **G7–G9** (cosmetic / cleanup / plan alignment).
