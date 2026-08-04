# Zedral — New-Lines Audit & Completion Plan (HRS · PKL · ANN · RWD)

**Date:** 2026-08-02
**Reference line:** Rolling / CRM (`sixHi/*`) — the "sorted" line used as the parity baseline.
**Scope:** HRS, PKL, ANN, RWD operator + machine-head flows (CRS/CTL noted where they leak in).
**Method:** static architecture audit of the actual tree (`packages/client`, `packages/server`,
`packages/shared-validation`) cross-checked against the existing plan docs in `doc/`. A full
`tsc`/build gate could not be executed in the review sandbox (no `node_modules`, restricted network);
running it locally is step 0 of execution (see §7).

---

## 1. TL;DR — where each line stands

The six new lines share a **generic "process framework"** (`ProcessHub`, `ProcessCapturePage`,
`ProductionActionRail`, `ProcessStatusBanner`, `useLiveTimer`, `ProcessRouteService`) with a per-line
**body** component (`HrsSlitBuilder`, `PklCoilForm`, `AnnChargeBoard`, `RwdTensionForm`, …). That
framework is sound and already wires timers, the production console, and the order journey for every
line. The gaps are **not** in the core plumbing — they're in the **per-line depth** (machine-head
desk, operator history/readings, shift review) and in **duplicated handover code**.

Maturity gradient (highest → lowest): **ANN ▸ PKL ▸ RWD ▸ HRS**.

| Capability (vs Rolling) | HRS | PKL | ANN | RWD |
|---|:--:|:--:|:--:|:--:|
| Capture body (production console) | ✅ | ✅ | ✅ | ✅ |
| Run/stoppage timer (`useLiveTimer` rail) | ✅ | ✅ | ✅ (per-base) | ✅ |
| Server order lifecycle | ✅ `HrsOrderService` (719) | ✅ `PklOrderService` (670) | ✅ `ProcessStationService` (charge) | ✅ `RewindingOrderService` (1225) |
| Order journey wired (route token) | ✅ `S` | ✅ `P` | ✅ `F` | ✅ `R` |
| Outgoing handover | ✅ (own, 324) | ✅ (own, 346) | ✅ (own, 490) | ⚠️ borrows HRS chrome |
| Operator History / Readings screen | ❌ | ⚠️ chart only | ✅ | ❌ |
| Shift-review panel | ❌ | ✅ | ✅ (rich) | ❌ |
| Machine-head desk pages | ❌ (0) | ⚠️ 2 (no Trends) | ✅ 5 | ⚠️ 1 (live only) |
| Spec admin | n/a | ✅ | ✅ | n/a |
| Automated tests | thin | good | good | ⚠️ lifecycle untested |

✅ done · ⚠️ partial/borrowed · ❌ missing

**Headline conclusion:** the lines are far more functional than the file counts suggest (RWD's 6-line
handover file hides a 1,225-line server lifecycle). The real work is (a) **MH parity for HRS & RWD**,
(b) **operator history/readings for HRS, PKL, RWD**, (c) **de-duplicating the three handover pages**,
and (d) **closing the CRS/CTL handover-falls-back-to-CRM bug**. None of it requires touching the
rolling engine.

---

## 2. Architecture recap (so the plan makes sense)

**Rolling (reference, `sixHi/`)** is a bespoke, deep implementation: `SixHiHub`, `SixHiOrderWorkspace`,
`CrmOutgoingHandoverPage` (1003 LOC), `ProductionTimerDisplay`, `ShiftEndModal`, `ShiftReadingsModal`,
`OrderStoppageModal`, `OrderProductionHistory`, `SixHiShiftSummaryPanel`, its own `sixHiStore` +
offline `sixHiWrites`. It is intentionally **not** the template to copy file-for-file — it is the
behavioural spec.

**New lines share one framework** (`components/process/*`, `pages/process/*`):

- **Console:** `ProcessCapturePage` → `CaptureWorkspace` renders `PROCESS_CONFIG[code].bodyComponent`.
- **Timer/rail:** `ProductionActionRail` (documented "6HI-parity": Start→End, Stoppage→Resume, Hold,
  Remark, footer timer) driven by `processRailFlags` + `useLiveTimer`. `ProcessStatusBanner` shows the
  live elapsed time. This is the equivalent of rolling's `ProductionTimerDisplay` — **two timer
  implementations now coexist** (consolidation candidate, not a bug).
- **Routing:** `ScopeCaptureRoute` / `ScopeHandoverRoute` pick the body/handover by `processCode`.
- **Journey:** `ProcessRouteService` maps every line to a route token (`S/P/F/R/C/LE`) and advances to
  the next non-skipped step on completion; `ProcessRouteTimeline` renders the order journey.
- **Nav:** `OperatorNavRail` + `classifyOperatorNav` branch the side-nav. Today only `isPkl`/`isAnn`
  get bespoke nav (ANN: Base/Batches/History; PKL: Process Chart/Orders/Capture). **HRS/RWD/CRS/CTL
  fall to the generic Orders/Capture only** — this is why HRS/RWD have no History tab.

This is a good design. The plan below **extends** it rather than replacing anything.

---

## 3. Per-line gap analysis

### 3.1 HRS (HR Slitting) — thinnest UI, solid server
- **Have:** `HrsSlitBuilder` body (slit fan-out), `HrsOrderService` (719 LOC, full order lifecycle),
  `HrsOutgoingHandoverPage` (324; also the shared template RWD reuses), route token `S`, tests
  `hrsRouteFlags` / `hrsFanOut` / `hrsPklConsole`.
- **Gaps:**
  - **G-HRS-1 (P1): No machine-head desk.** Zero `pages/machinehead/hrs/*`. An HRS-sole machine head
    lands on the generic `/live` (rolling desk). Needs a live dashboard + slit/coil detail, mirroring
    the PKL MH pattern (`pklMhDesk` + `PklMhLiveDashboard` + `PklMhCoilDetailPage`).
  - **G-HRS-2 (P1): No operator History/Readings screen.** Nav gives only Orders/Capture. Rolling has
    `OrderProductionHistory` + `ShiftReadingsModal`. Add an HRS history tab.
  - **G-HRS-3 (P2): No shift-review panel.** Handover has crew/notes but no per-order/slit shift
    summary like `PklShiftReviewPanel`/`AnnShiftReviewPanel`.
  - **G-HRS-4 (P3): dead `const MACHINE_CODE = 'HRS'`** at module scope (line 16), shadowed by the
    prop at line 47. Remove during handover refactor (§4).

### 3.2 PKL (Pickling) — most complete after ANN
- **Have:** `PklCoilForm` + `PklChartGrid`, `PklChartPage`, `PklOutgoingHandoverPage` (346),
  `PklShiftReviewPanel`, MH `PklMhLiveDashboard` + `PklMhCoilDetailPage`, `pklMhDesk` desk resolver,
  `PklSpecAdmin`, `pklSiblingSelect` (run-together grouping), rich tests.
- **Gaps:**
  - **G-PKL-1 (P2, cosmetic): "Capture" → "Production Console" rename** in `OperatorNavRail` `isPkl`
    items + console header (guarded `processCode === 'PKL'`). Matches rolling naming. (This is "Gap A1"
    in `ZEDRAL_100PC_COMPLETION_PLAN.md`.)
  - **G-PKL-2 (P3): MH Trends page** absent (`PklMhTrendsPage`) — optional parity with ANN's trends.
  - **G-PKL-3 (P3): No dedicated operator History tab** — the Process Chart covers readings, but there
    is no order-level production history like rolling's `OrderProductionHistory`.
  - Verify `pklMhDesk` correctly claims `/live` + `/machine-head-dashboard` for a PKL-sole desk
    (ANN-wins-tie logic in `MhLiveEntry` must not swallow PKL).

### 3.3 ANN (Annealing) — effectively complete
- **Have:** `AnnChargeBoard`/`AnnBaseCard`/`AnnBatchesPanel` (fan-in charge model), `AnnChargePage`,
  `AnnOperatorHistoryPage`, `AnnOutgoingHandoverPage` (490, embeds `AnnShiftReviewPanel`), full shift
  review with **delay buckets + crew roles + total delay** (sub-sections under `annShiftReview/`), full
  5-page MH set (`Live`, `ChargeDetail`, `Trends`, `Batching`, `Import`) + `MhLiveEntry` desk resolver,
  `AnnSpecAdmin`, and strong tests (`annShiftReviewDelayBuckets`, `annDoneFanOut`, `annStageInvariant`).
- **Gaps:**
  - **G-ANN-1 (P3, cosmetic):** dynamic top-nav label text ("Annealing" vs "ANN") — "Gap A4".
  - **G-ANN-2 (verify):** confirm the delay-bucket migration
    (`…_ann_stoppage_delay_bucket`) shipped and `getAnnShiftReview` emits all five buckets + total (the
    test `annShiftReviewDelayBuckets` suggests done — confirm on the build gate).
  - ANN is the **reference for the other new lines' MH/history/shift-review** — copy its shape.

### 3.4 RWD (Rewinding) — deep server, thin client
- **Have:** `RwdTensionForm` (order-backed capture, `batchNumber` completes `rwd_order`),
  **`RewindingOrderService` (1225 LOC)** with `ensureOrder`/combine/`allocateMachine`/stoppage/hold/
  queue + `19530000000000_rwd_order.js` migration, route token `R`, `RwdMhLiveDashboard`, `rwdMhDesk`,
  `rwdSiblingSelect`, tests `rwdMhDesk` / `rwdPrefill`.
- **Gaps:**
  - **G-RWD-1 (P1): Handover borrows HRS chrome verbatim** — `RwdOutgoingHandoverPage` is
    `<HrsOutgoingHandoverPage machineCode="RWD" />`. The HRS effect that fetches slit metrics is guarded
    `MACHINE_CODE !== 'HRS'`, so RWD gets a handover with **no RWD-specific locked fields** (tension,
    combined-group Σ weight, machine RWD|2HI). Give RWD its own body slot in the shared shell (§4).
  - **G-RWD-2 (P1): MH desk is live-only** — no `RwdMhCoilDetailPage`/detail drill-down or trends.
  - **G-RWD-3 (P2): No operator History/Readings screen** (generic Orders/Capture nav only).
  - **G-RWD-4 (P1, quality): `RewindingOrderService` (1225 LOC) has no lifecycle test.** Its combine/
    stoppage/hold/heal-orphan paths are the riskiest untested surface in the new lines. Add a lifecycle
    unit/integration test before further edits.
  - **G-RWD-5 (verify):** the earlier `19510000000000_2hi_rewinding_sub_process.js` seeded
    `master.crm_sub_process`. The completion plan says the rewind machine pool should be its **own**
    registry, not the CRM sub-process registry — confirm this was moved so RWD/2HI don't imply a CRM
    rewinding sub-process.

---

## 4. Duplication & dead code (the "duplicacy" ask)

1. **Outgoing-handover pages are ~90% copy-paste. (P1 — highest-leverage cleanup.)**
   `HrsOutgoingHandoverPage` (324) and `PklOutgoingHandoverPage` (346) share the same imports,
   `SectionHeader`, `LockedField`, constants (`MIN_NOTES_LENGTH`, `AUTO_SAVE_MS`, `PRIORITIES`),
   autosave loop, crew-roster fetch, and `useHandoverPreview`/`useHandoverDraft` wiring;
   `AnnOutgoingHandoverPage` (490) repeats the same chrome around an ANN body. RWD delegates to HRS.
   → **Extract `ProcessOutgoingHandoverShell`** (chrome + preview/draft/autosave/crew/submit) taking a
   per-line **body slot** (`HrsHandoverBody`, `PklHandoverBody`, `RwdHandoverBody`,
   `AnnShiftReviewPanel`). Removes ~600+ duplicated lines and makes RWD's own fields trivial (fixes
   G-RWD-1). Delete the shadowed `MACHINE_CODE` const (G-HRS-4).

2. **CRS/CTL handover falls back to the CRM mill form. (P1 — real bug.)**
   `classifyHandoverBranch` returns `process-fallback` for CRS/CTL → `ProcessHandoverPage` →
   re-exports `CrmOutgoingHandoverPage` (1003 LOC rolling handover with roll-change/rolling-pass/
   skin-pass fields). A CRS/CTL operator ending a shift sees the wrong form. → Once the shell exists,
   give CRS/CTL a minimal body and branch them, or explicitly route them to a generic process handover.
   *(Out of the four-line scope but same subsystem — cheap to fix alongside.)*

3. **`sibling-select` logic duplicated** — `pklSiblingSelect` (57) vs `rwdSiblingSelect` (95) implement
   the same "run-together sibling grouping (mother+slit+grade/finish)". → Unify into
   `siblingSelect(processCode, …)` with per-line key config. (P2)

4. **`mhDesk` resolvers duplicated** — `pklMhDesk` (122) / `annMhDesk` (45) / `rwdMhDesk` (50) repeat
   the "does this line own the `/live` desk" pattern. → Unify into one `resolveMhDesk(focus)` with a
   per-line registry; keeps the ANN-wins-tie rule in one place. (P2, do when adding HRS MH.)

5. **Two timer implementations** — `ProductionTimerDisplay` (sixHi) vs `useLiveTimer` +
   `ProductionActionRail` (process). Not a defect; fold `ProductionTimerDisplay` onto `useLiveTimer`
   only if touching rolling for another reason. (P3)

---

## 5. Timers · Production Console · Order Journey (explicit checks)

- **Timers — OK across HRS/PKL/RWD.** `ProductionActionRail` + `useLiveTimer` give Start/Resume/End +
  Stoppage with a live footer timer, driven by `runStartedAt`/`stoppageStartedAt` from the server.
  ANN uses per-base timers in `AnnBaseCard`. Verify on the build gate that stoppage start/stop persists
  per shift (`ProcessLiveStatusPage` fetches `/stations/:code/shift/:id/stoppages`).
- **Production console — OK, one cosmetic gap.** `CaptureWorkspace` is the shared console and renders
  each line's body. PKL header still says "Capture" (G-PKL-1); rename for parity with rolling.
- **Order journey — wired for all four.** `ProcessRouteService` maps `HRS→S, PKL→P, ANN→F, RWD→R` and
  advances to the next non-skipped step on completion. Verify each line actually **calls the advance on
  order-complete** — especially RWD/HRS order-backed capture — so the journey timeline moves. Add one
  e2e per line that walks import → capture → complete → journey advance.

---

## 6. Work breakdown (senior-dev triage)

Priority: **P0** = correctness/blocker · **P1** = parity gap users will hit · **P2** = consolidation/
polish · **P3** = nice-to-have.

| ID | Item | Line | Pri | Est | Depends on |
|---|---|---|:--:|:--:|---|
| T0 | Local build gate green (shared-validation→server→client) + run existing tests | all | P0 | 0.5d | — |
| T1 | Extract `ProcessOutgoingHandoverShell`; migrate HRS/PKL/ANN; give RWD its own body | HRS/PKL/ANN/RWD | P1 | 2.5d | T0 |
| T2 | RWD handover body (tension, Σ group weight, RWD\|2HI machine) via shell | RWD | P1 | 0.5d | T1 |
| T3 | `RewindingOrderService` lifecycle test (combine/stoppage/hold/heal-orphan) | RWD | P1 | 1d | T0 |
| T4 | HRS machine-head desk (live + coil/slit detail) mirroring PKL MH | HRS | P1 | 2d | T0 |
| T5 | RWD MH **lean** desk = live + coil detail (no trends/batching) | RWD | P1 | 1.5d | T0 |
| T6 | Operator History **AND** shift-readings log for HRS & RWD; + order history for PKL | HRS/RWD/PKL | P1 | 2.5d | T0 |
| T7 | Unify `mhDesk` resolvers into `resolveMhDesk(focus)` registry | all | P2 | 0.5d | T4 |
| T8 | PKL "Capture" → "Production Console" rename (guarded) | PKL | P2 | 0.25d | T0 |
| T9 | Unify `pkl/rwdSiblingSelect` into `siblingSelect(code)` | PKL/RWD | P2 | 0.5d | T0 |
| ~~T10~~ | ~~CRS/CTL handover fix~~ — **OUT OF SCOPE** this pass (see §8); bug stays documented | CRS/CTL | — | — | — |
| T11 | Journey-advance e2e per line (import→capture→complete→timeline) | all | P2 | 1d | T0 |
| T12 | Cosmetics: ANN label text (A4), remove dead `MACHINE_CODE` const | ANN/HRS | P3 | 0.25d | T1 |
| **T13** | **OrderEnd sub-form parity** — end-confirmation (final weight/defects) for HRS/PKL/RWD | HRS/PKL/RWD | P1 | 1.5d | T0 |
| **T14** | **Guard completed order = read-only** on re-open (no re-submit) | all | P1 | 0.5d | T0 |
| **T15** | Order **rejection** sub-form for process lines (REJECTED bucket exists, no modal) | HRS/PKL/RWD | P2 | 1d | T0 |
| **T16** | Crew-capture UI consolidation (inline panel vs rolling `CrewCaptureModal`) | all | P3 | 0.75d | T0 |

**MH scope is LEAN (locked):** HRS/RWD machine-head = **live dashboard + detail drill-down only** — no
trends/batching/import pages (unlike ANN's 5-page desk). Adjust T4/T5 accordingly.

**Suggested sequencing (2 sprints):**
- **Sprint 1 (correctness + de-dup):** T0 → T1 → T2 → T3 → **T13 → T14** → T8/T12. Ships the handover
  shell (kills the biggest duplication), fixes the RWD handover, locks the RWD server lifecycle with a
  test, adds the order-end sub-form parity, and guards completed orders read-only.
- **Sprint 2 (MH + history parity):** T4 → T5 → T6 → **T15** → T7 → T9 → T11 → T16. Brings HRS/RWD
  lean machine-head desks and BOTH history views up to parity, adds the rejection sub-form, then
  consolidates desk/sibling/crew helpers and adds journey e2e.

**Guardrails (from the existing plans — keep):** do not modify the CRM/6HI/4HI/2HI rolling engine or
`crm_order`; keep all new behaviour behind `isPkl`/`isAnn`/`processCode` guards; every migration
additive + idempotent with a working `down`; build-green gate after each item
(`@m1/shared-validation` → `@m1/server` → `@m1/client` + targeted tests).

---

## 7. How to verify (do this first)

```bash
# 0. deps + build gate (couldn't run in the review sandbox)
npm ci
npm run build            # shared-validation → platform → connectors → m1-collection → client → server
npm run test             # workspace tests; new-line suites live in packages/*/tests
npm run arch:check       # dependency-cruiser + server arch tests

# focused new-line tests
npm run test -w @m1/client   # hrsPklConsole, pkl*, ann*, rwdMhDesk, processRailFlags
npm run test -w @m1/server   # ann*, crs*, hrs*, rwd*, processRoute*
```

Then walk each line manually: **import → open console → Start → Stoppage → Resume → End → outgoing
handover → confirm order-journey timeline advanced**, plus a machine-head login per line to confirm the
desk lands on the right dashboard (not the rolling `/live`).

---

## 8. Locked scope decisions (answered 2026-08-02)
1. **HRS & RWD machine-head = LEAN** — live dashboard + detail drill-down only. No trends/batching/
   import pages. (T4/T5 scoped down.)
2. **Operator History for HRS/RWD = BOTH** — order-level production history **and** a shift-readings
   log. Add order history to PKL too. (T6.)
3. **CRS/CTL = out of scope this pass.** The CRM-handover fallback bug (§4.2) stays **documented, not
   fixed** now. Do not build CRS/CTL bodies. (T10 dropped.)
4. **RWD ⊃ 2HI (locked):** 2HI is **just another machine on the Rewinding line** where RWD happens —
   not a CRM sub-process. Current code already treats `machineCode ∈ {RWD, 2HI}` inside the RWD line
   (`ProcessHub` RWD allocation, `RewindingMachineAllocationModal`). G-RWD-5 reduces to: ensure the
   2HI-as-RWD-machine pool is modeled on the **RWD line**, and the leftover
   `19510000000000_2hi_rewinding_sub_process.js` CRM-sub-process seed is retired/not implying a CRM
   rewinding sub-process.

---

## 9. Order production cycle — parity map vs Rolling (pass 2)

Traced the full operator journey and compared to rolling (`sixHi/*`). **Good news: the process
framework reuses rolling's own sub-form modals**, so most of the cycle is already at parity. Gaps are
localized to order-**end**, **rejection**, completed-order **read-only**, and crew UI.

| Cycle stage | Rolling (reference) | Process lines (HRS/PKL/ANN/RWD) | Verdict |
|---|---|---|---|
| Order click → open workspace | `SixHiOrderWorkspace` | `ProcessHub.openCapture(card)` | ✅ parity |
| Machine assignment (if present) | `MachineAllocationModal` | RWD: `RewindingMachineAllocationModal` (RWD\|2HI). HRS/PKL/ANN single-machine → n/a | ✅ (RWD), n/a others |
| Production console fields | mill form | per-line body (`PROCESS_CONFIG.bodyComponent`) | ✅ parity |
| Timer start/stop | `ProductionTimerDisplay` | `useLiveTimer` + `ProductionActionRail` footer | ✅ parity |
| Stoppage sub-form | `OrderStoppageModal` | **reuses** `OrderStoppageModal` (in `CaptureWorkspace`) | ✅ shared |
| Remark sub-form | `OrderRemarkModal` | **reuses** `OrderRemarkModal` | ✅ shared |
| Hold | rail Hold + HOLD bucket | rail `onHold` + HOLD bucket | ✅ (verify hold-reason capture) |
| **Order End** | **`OrderEndModal`** (final weight/defects confirm) | rail End → **just submits the form**, no end-confirm sub-form | ⚠️ **G-CYC-1 (T13)** |
| **Rejection** | `OrderRejectionModal` | REJECTED bucket exists, **no rejection modal wired** | ⚠️ **G-CYC-2 (T15)** |
| Completed-order display | COMPLETED filter | `ProcessHub` COMPLETED bucket; lands there after End (6HI-style) | ✅ shows |
| **Completed order re-open** | read-only | `CaptureWorkspace` guards only on `!shiftLogId`, **not `status===COMPLETED`** | ⚠️ **G-CYC-3 (T14)** verify/guard |
| Order status rail buckets | PENDING/IN-PROG/HOLD/COMPLETED | same buckets (PREPARING→Pending, STOPPAGE→In-Prog, REJECTED→Hold) | ✅ parity |
| Crew capture | `CrewCaptureModal` | inline crew **panel** in `CaptureWorkspace` (writes `/crew`) | ✅ works, **UI diverges (T16)** |
| Shift-end popup | `ShiftEndModal` | **reuses** `ShiftEndModal` (`ProcessLayout`) | ✅ shared |
| Auto shift boundary | shift watcher | **reuses** `useShiftEndWatcher` + `ShiftBoundaryService` | ✅ shared |
| Manual handover | handover page | per-line handover + `HandoverAcceptGate` | ✅ parity |
| Handover details (auto summary) | auto shift summary | `useHandoverPreview`/`useHandoverDraft` (auto) + manual notes | ✅ parity |

**New order-cycle gaps folded into the backlog:**
- **G-CYC-1 → T13 (P1):** process "End" submits the body with no end-confirmation sub-form. Rolling's
  `OrderEndModal` captures final weight/defects at end. Add an end sub-form for HRS/PKL/RWD (reuse
  `OrderEndModal` or a process variant) so End is an explicit confirm-and-capture, not a silent submit.
- **G-CYC-2 → T15 (P2):** the rail's REJECTED bucket has no rejection path for process lines — wire
  `OrderRejectionModal` (or confirm reject is intentionally rolling-only).
- **G-CYC-3 → T14 (P1):** re-opening a COMPLETED order should be read-only. Guard `CaptureWorkspace`
  edit/submit on `status === 'COMPLETED'` so completed orders can't be silently re-submitted.
- **T16 (P3):** crew is captured via an inline panel on process lines vs `CrewCaptureModal` on rolling —
  both persist crew, but consolidating to one component removes the divergence.

**Bottom line:** the order production cycle is ~85% at rolling parity out of the box (stoppage, remark,
hold, timer, status rail, shift-end, auto/manual handover, crew are all wired). The remaining 15% is
order-**end** confirmation, **rejection**, completed-order **read-only**, and crew-UI unification —
all small, all in Sprint 1/2 above.
