# ZEDRAL — HRS Console Re-skin, Target/Actual Fields & HRS↔PKL Machine-Head Merge · Implementation Plan

**Hero Steels Limited · HR Slitting (HRS) + Pickling (PKL) · M1 Data Collection**
**Audience:** developers / IDE agent. *Logic + data + architecture* plan — **no pixel-level visual design**. It names the modules to touch or create; where a rule is reasonably a developer's call it is marked **[dev-decision]**.

> Companion to `doc/ZEDRAL_HRS_OPERATOR_IMPLEMENTATION_PLAN.md` (the HRS fan-out spec, ~80–85% built). That plan delivered the **data + fan-out engine**; this plan delivers the **operator experience** (console framing, planned↔actual presentation) and a **role-consolidation** (one Machine-Head desk that toggles between HRS and PKL).
> Route position: HRS = `S` (seq 10), the birth point of most coils. PKL = `P` (seq 20), the next step. The two are adjacent, both single-station, both low-complexity — which is exactly why their Machine-Head desks can merge (§WS-C).

---

## 0. Guiding principle — the rolling console is the reference, not a rebuild

The 6HI/CRM **rolling console** (`packages/client/src/components/sixHi/`) is the mature, plant-proven operator surface: PPC info cards, live net-production timer, status banner, a workspace-modal capture window, a full action rail (Start/End/Reject/Remark/Stoppage), stoppage/defect/crew modals, and a shift-summary panel. HRS today runs on the **lighter generalised `process/` shell** (`ProcessLayout` + a compact `ProductionActionRail` + the `HrsSlitBuilder` body) which is functionally complete but visually and interactionally thin next to rolling.

**The work is to lift rolling's console *framing* onto the process shell — generically — so HRS (and every other process line: PKL/ANN/RWD/CRS/CTL) inherits the same look and ergonomics.** Do **not** fork the `sixHi/` tree per-process. Generalise the reusable pieces into process-agnostic components under `process/` and feed them process-shaped data.

Three workstreams, independently shippable:

| WS | Title | Outcome |
| --- | --- | --- |
| **A** | HRS **+ PKL** console re-skin | HRS **and PKL** capture wrapped in rolling-grade console framing (PPC cards, timer/status, capture-window, action rail) |
| **B** | Target ↔ Actual field polish | Every planned value shown against its measured actual with a live delta/tolerance cue (HRS; PKL where pairs exist) |
| **C** | HRS↔PKL Machine-Head merge | One MH desk, toggle between HRS and PKL line scope |

> **Scope note (added):** the aesthetics are applied to **PKL wherever possible**, not just HRS. Because the guiding principle is *generalise, don't fork* (§0), the ported console components serve every process line — so PKL adopts the same framing "for free," plus its two line-specific surfaces (`PklCoilForm`, `PklChartGrid` — the hourly process chart) get the treatment. See §WS-A.6.

---

## WS-A — HRS + PKL console re-skin (borrow the rolling framing)

### A.1 Current vs target
**Current HRS surface** (`process/`): `ProcessLayout` renders `OperatorShell` → `ProcessHub` (queue cards + status pills + shift-metric subtitle) → on pick, routes to `CaptureWorkspace` → `HrsSlitBuilder` (a plain `<form>` of grid inputs). A compact 5.5rem right rail (`ProductionActionRail`: Start/Stop/Defect/Crew/End Entry/End Shift + `useLiveTimer`). No PPC cards, no status banner, no workspace-modal framing.

**Target HRS surface**: same data flow, wrapped in rolling-grade framing:
- **PPC info cards** at the top of capture (customer / grade / slit-ID / width·thk / target wt / route / batch) — the operator's "what am I making" glance.
- **Production status banner + timer display** — running/stoppage state and net-production clock, matching rolling.
- **Capture-window** presentation (the slit-builder lives inside a framed workspace, not a bare form).
- **Action rail** consistent with rolling's affordances (Start/End/Stoppage/Remark/Defect/Crew), driven by the existing process store.

### A.2 Components to generalise (not fork)
| Rolling source (`sixHi/`) | Coupling today | Generalisation |
| --- | --- | --- |
| `PPCInfoCards.tsx` | typed to `SixHiOrderDetail`/`SixHiQueueCard` (order-shaped) | extract a process-agnostic `ProcessPPCCards` (or add a mapping adapter from `ProcessQueueCard`/prefill → the card's field set). HRS feeds mother + active slit line. |
| `ProductionTimerDisplay.tsx`, `ProductionStatusBanner.tsx` | reads `sixHiStore` | re-point at `processStore` (`captureStatus`, `runStartedAt`, `stoppageStartedAt`); timer logic (`useNetProductionTimer`/`useLiveTimer`) is already shared |
| `SixHiGlobalProductionPanel.tsx` (action rail) | order-action props | the process `ProductionActionRail` already exists — extend it with **Stoppage** + **Remark** to reach parity; keep it store-driven |
| `SixHiWorkspaceModal.tsx` (capture window) | CRM order workspace | frame the `CaptureWorkspace` in the same panel styling; HRS body unchanged |
| `OrderStoppageModal.tsx` | `sixHiStore` writes | reuse the modal shell; wire to process stoppage endpoints (see WS-A.4) |

### A.3 Data the cards/banner need (HRS)
`ProcessHub.openCapture` already stashes `orderLines`, `widthMm`, `thicknessMm`, `weightMt`, `gradeCode`, `motherCoilNo`, `slitId` into the active-coil prefill. The PPC card set maps from that prefill + the *currently focused* slit line inside `HrsSlitBuilder`. **[dev-decision]** whether the card shows the pass (mother) summary, the active line, or a compact both. Recommended: mother summary card + a slim per-line strip (since HRS fans out to N lines, one "current order" card is misleading).

### A.4 Interaction parity — what exists vs what to upgrade
*(Corrected against the code — several of these already work; the job is polish, not net-new.)*
- **Stoppage — already captured, upgrade the surface.** The process path *does* capture stoppages: the rail's **Stop** button toggles `captureStatus: 'stoppage'`, `CaptureWorkspace` reads codes via `useSixHiStoppageCodes`, and `processStore` posts to `/stoppages`. HRS/PKL codes are seeded (`master.stoppage_code`, migration `1945…`). Gap = it's inline/compact, not rolling's dedicated modal. **Upgrade** to the `OrderStoppageModal`-grade experience (category + breakdown + remarks), reusing that modal shell against the existing `/stoppages` write.
- **Crew — already wired, align UX.** `CaptureWorkspace` already renders a crew panel (`crewPanelOpen`, `openCrewPanel`) and persists crew for process lines — this is **not** net-new (contrary to a common assumption / companion plan §11, which predates it). Gap = it's a slide panel, not rolling's `CrewCaptureModal` prompt-on-session flow. **[dev-decision]** align to the modal or leave the panel.
- **Remark — genuine gap.** No remark affordance on the process path (rolling has `OrderRemarkModal`). **Add** one.
- **Shift-summary — data exists, promote it.** HRS exposes `/stations/hrs/shift-metrics/:shiftLogId` and PKL exposes `/stations/pkl/shift-metrics/:shiftLogId`, but both are surfaced only as a header *subtitle* string in `ProcessHub`. **Promote** into a proper **shift-summary panel** mirroring `SixHiShiftSummaryPanel` (HRS: Target · Production · Scrap · Scrap% · Coils · Settings; PKL: Production · Coils · Avg speed · Repeats · Chart readings/due). One shared `ProcessShiftSummaryPanel` serves both. *(Overlaps HRS plan §9; this is the UI half.)*

### A.6 Apply to PKL (wherever possible)
Because WS-A generalises rather than forks, **PKL inherits the same framing from the same components** — this is the cheapest place to get PKL parity, so do it in this pass. Specifics:
- **PPC cards + timer/status + action rail + shift-summary panel:** identical treatment to HRS; PKL feeds its own prefill (coil / grade / width / thk / target wt / mother / slit-id — `ProcessHub.openCapture` already stashes these for PKL, including sibling-group selection).
- **`PklCoilForm`** (the 1-in-1-out coil form) gets the paired-field styling of WS-B where planned↔actual pairs exist (e.g. planned vs pickled dimensions/weight). Confirm which PKL fields are plan-carried vs measured — **[dev-decision]**.
- **`PklChartGrid`** (the hourly process chart — CRUD 2-hourly readings, advisory spec limits) keeps its grid but adopts the console chrome (header, status, panel styling) so it reads as the same product as rolling. The chart itself is PKL-specific and stays.
- **Shift-summary** uses the PKL metric set (Production · Coils · Avg speed · Repeats · Chart readings/due) from `/stations/pkl/shift-metrics`.
- PKL's queue already supports **sibling-coil grouping** (`findPklSiblingCoils`, `pklGroupWeightMt`) — the re-skin must preserve the "Selected N · Σ MT" affordance, just restyled.

Net: HRS and PKL end up visually and interactionally identical to the rolling console, which also sets up the WS-C desk merge nicely (one head, two lines that look and feel the same).

### A.5 Non-goals for WS-A
No change to the fan-out engine, contracts, migrations, or journey spawn (all in the companion plan). No change to queue-build logic or the PKL hourly-chart data model. Timer stays operator-tap-stamped (not PLC).

---

## WS-B — Target ↔ Actual field presentation

### B.1 What already exists (verified)
The planned↔actual **model and capture** is already in place end-to-end:
- **Header:** `RM Width` → `Actual Mother Width`.
- **Per slit line** (`HrsSlitBuilder`): `Target Width` → `Actual Width`; `Planned Wt` → `Actual Weight`; `Planned Thk` → `Thk ID / Centre / OD`.
- Persisted by `saveHrs` into `txn.prod_hrs` / `txn.prod_hrs_slit` (`target_width_mm`, `actual_width_mm`, `planned_weight_mt`, `actual_weight_mt`, `planned_thk_mm`, `thk_id/centre/od_mm`).

So this workstream is **presentation + validation cues**, not new capture.

### B.2 The polish
1. **Show planned as reference, not as a bare readout.** Today targets render as unstyled `ReadOnly` cells. Move them into the PPC-card / paired-field styling so each input sits beside its plan value (matches how rolling shows PPC-target next to captured-actual).
2. **Live delta / tolerance cue.** For each pair, compute and display Δ (actual − planned) and colour it against a tolerance band: width Δ vs `FIN_WIDTH_TOL`, thickness ID/Centre/OD vs finish-thickness tol, weight Δ vs mass-balance band. Green in-band, amber out-of-band (soft warn), consistent with the existing `widthWarn`/`massWarn` amber panels already in `HrsSlitBuilder`.
3. **Field audit against the paper log-sheet + rolling.** Confirm the captured set is complete and correctly split planned vs actual:
   - mother: RM width (plan) vs actual mother width (measured) — ✅ present.
   - line: target/actual width ✅, planned/actual weight ✅, planned thk vs ID/Centre/OD ✅, taper ✅, route ✅ (hard gate), customer/batch ✅.
   - **[dev-decision] gaps to confirm:** per-line **surface finish** and **finish-thickness** show as plan-only (no measured counterpart) — confirm that's correct (HR slitting doesn't change gauge/surface, so they're carried, not re-measured). Edge-trim / actual-slit-width range (`actual_slit_width_from/to_mm`) exists on the pass header but isn't surfaced in the builder — decide whether to expose.
4. **Tolerance source.** Pull bands from the quality spec when present (`/quality/fetch`, already wired for `specVersionId`); fall back to **[dev-decision]** static defaults when `NOT_EVALUATED`.

### B.3 Optional server tie-in (recommended, see brainstorm)
The delta cues are client-side and advisory. For an enforced **per-line HOLD** on out-of-tolerance dimensions, a server HRS quality gate is required (currently only CRS has `validateCrsQuality` in `JourneyAdvanceConsumer`). Tracked in the brainstorm as a recommended fold-in.

---

## WS-C — HRS ↔ PKL Machine-Head desk merge (toggle)

### C.1 Why this is small — the toggle pattern already exists
`MachineHeadNav.tsx` already renders **three** desk variants selected at runtime:
- default `ALL_NAV_ITEMS`, `ANN_NAV_ITEMS` (**ANN MH**), and `PKL_NAV_ITEMS` (**PKL MH**).
- Selection is driven by `useMhDeskFocus` (a zustand store, `sessionStorage` key `mh.deskFocus`) + `syncMhDeskFocus`, which auto-focuses a desk when its line is the *sole* assigned machine (`isPklMhDesk`, `isAnnMhDesk`).

A combined HRS/PKL desk is a **direct extension of this exact mechanism** — no new architecture.

### C.2 The design
1. **Shared desk definition.** Add an `HRS_PKL_NAV_ITEMS` set (or, cleaner, a single desk that shows both lines and swaps only the line-specific item). Common items — Live Dashboard, Crew Management, Shift Review, Import, Export, Traceability — are identical to today's PKL desk. Line-specific item differs:
   - **PKL** → `PKL Specs` (`/admin/pkl-specs`).
   - **HRS** → **no machine-specs** (single station, no eligibility envelope — companion plan §10). So the specs item is **conditional on the active line** and simply absent for HRS.
2. **The toggle.** Reuse `useMhDeskFocus.setFocus('HRS' | 'PKL')`. Render a segmented **HRS | PKL** switch in the desk header (`DeskSideNav` `brandLabel`/`brandSubtitle` already vary per desk — extend with a toggle control). Persist through `sessionStorage` as today.
3. **Auto-focus rules** (extend `syncMhDeskFocus`):
   - sole machine = HRS → focus HRS; sole = PKL → focus PKL (existing).
   - **both** HRS and PKL assigned → show the **combined** desk with the toggle defaulting to **[dev-decision]** (HRS first, since it's upstream, or last-used from `sessionStorage`).
   - neither → unchanged default desk.
4. **Line scope wiring.** The toggle sets the active line for downstream scoping: Live Dashboard filter, Shift Review, Export line pre-selection, and crew/session pinning should follow `focus`. Verify `useOperationalMachineAccess` + the live/reporting services accept a line filter (they already take machine scope).
5. **Access/authorisation.** No new roles. The desk still only surfaces lines in the user's `machine_access`. Toggle options = the intersection of `{HRS, PKL}` with assigned machines (if a head only has PKL, no toggle — it's just the PKL desk, as today).

### C.3 What NOT to merge
- **Operator capture** stays per-line (HRS uses `HrsSlitBuilder`, PKL uses `PklCoilForm`/`PklChartGrid`). This merge is the **Machine-Head desk only** — the supervisory/overview role — not the shopfloor capture role.
- Specs pages stay separate (PKL has one, HRS has none).
- Don't collapse the two lines' shift logs / metrics — the desk *scopes* to one line at a time via the toggle; it never sums them.

### C.4 Files touched
`components/layout/machinehead/MachineHeadNav.tsx` (add combined desk + toggle), `lib/pklMhDesk.ts` / `lib/annMhDesk.ts` (extend focus helpers, add `isHrsPklMhDesk`), `lib/useOperationalMachineAccess.ts` (unchanged, consumed), `DeskSideNav` (toggle control slot). Optional: a small `lib/mhDesk.ts` to hold the shared desk/toggle logic so ANN/PKL/HRS focus rules stop being scattered.

---

## Build order (dependency-aware)

1. **WS-A.2 generalisation** — extract `ProcessPPCCards`, re-point timer/status banner at `processStore`. *(Unblocks A + B; serves HRS and PKL from one set.)*
2. **WS-B.1–B.2** — paired-field styling + delta/tolerance cues in `HrsSlitBuilder` (consumes A's card styling); apply the same to `PklCoilForm` where pairs exist (§A.6).
3. **WS-A.4** — upgrade stoppage to modal parity, **add** Remark, promote shift-metrics to a shared summary panel (HRS + PKL).
4. **WS-A capture-window framing** — wrap `CaptureWorkspace` (HRS builder + PKL coil form/chart) in the workspace-modal styling.
5. **WS-C** — combined HRS/PKL MH desk + toggle (independent of A/B; can run in parallel).
6. **Verification pass** — see Acceptance.

*PKL rides along at each step because the components are shared (§A.6) — it is not a separate phase.*

Suggested first slice: **A.1 PPC cards + B.2 delta cues on HRS capture** (highest operator-visible value, no server change), then WS-C (self-contained), then the stoppage/remark/summary parity.

---

## Acceptance / verification

- **Console parity:** HRS **and PKL** capture show PPC cards, a live net-production timer, a status banner, and a Start/End/Stoppage/Remark/Defect/Crew rail — driven by `processStore`, no `sixHiStore` coupling.
- **PKL parity:** `PklCoilForm` and `PklChartGrid` render inside the same console chrome; the PKL shift-summary panel shows the PKL metric set; sibling-group "Selected N · Σ MT" affordance preserved.
- **No fork:** the ported pieces live under `process/` (or shared), consumed by HRS and PKL; ANN/RWD/CRS/CTL can adopt the same components without change.
- **Planned↔actual:** every pair (width, weight, thk ID/Centre/OD, mother width) renders plan beside actual with a Δ and an in-band/out-of-band colour; amber warns match existing width/mass warns; no regression to `saveHrs` round-trip.
- **Tolerance source:** bands come from the fetched spec when present; `NOT_EVALUATED` falls back to defaults without error.
- **MH toggle:** a head assigned both HRS+PKL sees one desk with an HRS|PKL switch; switching swaps the specs item (PKL Specs ↔ none) and re-scopes Live/Review/Export/Crew to the active line; a head with only one of the two sees that line's desk with no toggle (unchanged behaviour); focus persists across reload via `sessionStorage`.
- **No scope bleed:** the MH desk never sums HRS and PKL metrics; capture flows are untouched.
- Client build green (mind the Windows/UTF-16 `.ts` edit hazard — `zedral-windows-utf16-editing`).

---


- **Crew UX alignment (fold-in, cheap).** Crew capture already works on process lines (`CaptureWorkspace` renders a crew panel and persists crew) — so this is *not* net-new (the companion plan §11 predates it). The only gap is UX consistency: rolling uses a prompt-on-session `CrewCaptureModal`, the process shell uses a slide panel. Since WS-A touches the shell, align the two **[dev-decision]** — adopt the modal + session prompt, or keep the panel and just restyle.
- **Server-side HRS quality/dimensional HOLD gate (fold-in with WS-B).** WS-B's delta cues are advisory; add an HRS analogue of `validateCrsQuality` in `JourneyAdvanceConsumer` so an out-of-tolerance line goes HOLD server-side and writes `qc_measurement`. Makes the tolerance cues *mean* something. **[dev-decision]** whether HRS carries a spec this early (companion plan §12 open item).
- **Promote shift-metrics to a real panel (fold-in, already in WS-A.4).** The `/stations/hrs/shift-metrics` data is computed but only shown as a subtitle. Same for PKL. One shared `ProcessShiftSummaryPanel` serves both.

- **Setting-count auto-derivation.** Companion plan §9 [dev-decision]: increment settings when a pass's slit combination differs from the previous (knife changeover). `setting_count` column already exists.
- **Combination completeness cross-check at queue build.** Parse `HRS Combination` (plan col L, e.g. `483+483+536`) and warn when the rows present for a mother don't match the implied slit count/widths (companion plan §3.1).
- **Manual stoppage (no active coil).** Rolling supports machine-downtime stoppage with no order running; add to the process rail for HRS/PKL.
- **Combined HRS/PKL *operator* toggle.** If any operator physically runs both adjacent lines, mirror the WS-C desk toggle at the operator level too (not just Machine-Head). Confirm staffing reality first — **[dev-decision]**.


---

