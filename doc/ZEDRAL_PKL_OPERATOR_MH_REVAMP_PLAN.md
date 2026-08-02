# ZEDRAL — Pickling (PKL) Operator & Machine-Head Revamp · Implementation Plan

**Hero Steels Limited · Semi-Continuous Pickling · M1 Data Collection**
**Audience:** developers / IDE agent. *Logic + data + architecture + UX-intent* plan. It names the modules to touch/create; where a rule is reasonably a developer's call it is marked **[dev-decision]**. Data-model changes (chart columns, manual form) call out the **migration** explicitly.

> Builds on `doc/ZEDRAL_PKL_OPERATOR_IMPLEMENTATION_PLAN.md` (the original PKL spec — backend largely complete) and `doc/ZEDRAL_HRS_CONSOLE_RESKIN_AND_HRS_PKL_MH_PLAN.md` (the shared console re-skin + HRS↔PKL MH merge). Several items here are the **PKL-specific realisation** of that shared re-skin — where so, this plan references it rather than repeating it.
> Route position: PKL = `P` (seq 20). One coil in → one pickled coil out; the hourly Process Chart runs on the plant clock, decoupled from coils.

**Current PKL surfaces (verified in repo):**
- Operator: `ProcessLayout` → `ProcessHub` (queue + secondary tab bar `Coils | Process Chart` via `config.extraTabs`) → `CaptureWorkspace` → `PklCoilForm` (+ `QcCapturePanel`); `PklChartGrid` on the `chart` route. Side nav = `OperatorNavRail`; top bar = `StatusRail`. Action rail = the compact `process/ProductionActionRail`.
- Handover: `ProcessHandoverPage` just **re-exports the CRM** `CrmOutgoingHandoverPage` (rolling-shaped, coolant/scrap fields — wrong for PKL).
- Machine Head: `MachineHeadDashboard` (CRM/rolling-shaped: ROLLING/SKIN_PASS tabs), `PklSpecAdmin` (minimal param upsert, no edit/delete), `PlantShiftReviewPage` (already per-line aware — has an ANN payload shape; PKL needs one).

---

## PART 1 — OPERATOR

### 1. Move **Process Chart** from the top secondary tab bar → the side nav; remove the secondary bar
**Today:** `PROCESS_CONFIG.PKL.extraTabs = [{ id:'chart', label:'Process Chart', path:'chart' }]`; `ProcessHub` renders these as a secondary top tab row (`Coils | Process Chart`) and the chart lives at `${basePath}/chart`.
**Change:**
- Add a **Process Chart** entry to the operator **side nav** (`OperatorNavRail`), pointing at the existing `${basePath}/chart` route (icon: grid/table). Scope it to PKL only (nav rail already receives `processCode`).
- **Remove the secondary top tab bar** for PKL: drop `extraTabs` from the PKL config (or stop rendering `config.extraTabs` in `ProcessHub` when the item now lives in the side nav). The Hub then shows only the queue; the chart is a peer screen reached from the rail.
- Keep the `chart` route + `PklChartGrid` mount; only the **entry point** moves. **[dev-decision]** whether other archetype-A lines keep their (nonexistent) secondary bar — this only affects PKL today.

### 2. Capture window — adopt the rolling framing (current running order · shift summary · stoppage details)
This is the **PKL realisation of WS-A** in the shared re-skin plan. On the PKL capture screen (`CaptureWorkspace` + `PklCoilForm`), bring in, from the rolling console:
- **Current Running Order** card (PPC/prior-process identity: coil, mother/slit, customer, grade, width, thk, PPC weight, route) — reuse the generalised `ProcessPPCCards` (WS-A.2).
- **Shift summary** strip (from `/stations/pkl/shift-metrics`: Production · Coils · Avg speed · Chart readings/due) — the promoted `ProcessShiftSummaryPanel` (WS-A.4).
- **Stoppage details** — surface active/'this-shift' stoppages inline, using the rolling stoppage presentation.
- Live net-production **timer + status banner** (`ProductionTimerDisplay`/`ProductionStatusBanner` re-pointed at `processStore`).
Net: the PKL capture screen reads like the rolling capture screen. No change to `savePkl`.

### 3. Remove **Manual Add** from the orders (queue) panel
`ProcessHub` renders a generic **Manual Add** button + modal (fields `coilNo, gradeCode, customerName, widthMm, thicknessMm, weightMt`). **Remove that button/modal from the PKL queue panel** (keep for other lines unless told otherwise — gate on `processCode === 'PKL'`). The manual path moves to a purpose-built form (§4).

### 4. Build the **PKL manual-entry form** (fields per the PKL order)
Replace the generic manual-coil modal with a **PKL-order-shaped manual form** for the unplanned-coil path. Fields mirror the PKL PPC/coil-header contract (plan §3 map), not the generic six:
- Identity: `Batch Number` (=coil no / work-unit key), `Mother Coil`, `Slit ID`, `Customer`, `Grade`, `Surface`.
- Dimensions/weight: `Width`, `Pre-Stage Thickness`, `Coil Weight`.
- Routing: `Process Route` (raw).
- Optional: `Heat No` / `Source`, `Plan Date` / `Shift`.
Submitting creates an ad-hoc PKL coil (existing `createManualCoil` path, extended to carry these fields) that lands in the queue like a planned coil. **[dev-decision]** which fields are mandatory for a manual coil (recommend Batch + Weight + Width + Route). Where to surface it: a **Manual Coil** action on the queue header (distinct from the removed generic one) or inside the capture flow.

### 5. PKL production console — field cleanup (`PklCoilForm`)
Concrete edits to the coil form:
- **Rename** `Line Speed mpm` → **`Line Speed M/min`** (label only; keep `lineSpeedMpm` field key).
- **Rename** `End Filling` → **`Leader End`** (label only; keep the `endFilling` boolean/`end_filling` column — **[dev-decision]** whether to also rename the column/contract key `endFilling`→`leaderEnd`; recommend label-only to avoid a migration, note the mapping in code).
- **Remove `Repeats`** input (drop from the form; keep the column nullable for back-compat — stop writing it). **[dev-decision]** retire `repeats` column later.
- **Remove `Heat Number`** input (`heatNo`) — drop from the form (keep column, stop writing) unless the plant needs it. **[confirm with plant]**
- **Remove `Process Route`** from the operator form — routing comes from PPC/prior-process (`routeRaw` autofilled), not operator-typed; stop showing it as an editable field.
- **Remove repeated/duplicate details** — the form currently shows both `Weight MT (PPC ref)` **and** `PPC Weight`, and both `Coil No`/grade/customer that also appear in the new Current-Order card (§2). Collapse: show identity **once** (in the PPC card), leave only the true operator inputs in the form body (Line Speed, W/P, Leader End, time, remarks).
- **Remove the quality-check block at the bottom** — drop `QcCapturePanel` from the PKL capture (`CaptureWorkspace` renders it after the body; gate it off for PKL). Pickling is pre-cold-roll; no dimensional QC gate here.

Resulting operator inputs for PKL: **Line Speed (M/min) · W/P · Leader End · time from/to · remarks** (+ stoppage/defect/crew via the rail). Everything else is autofilled/reference.

### 6. Side **order status panel** — rolling-style (Start/End together · Stoppage · Remark · Hold)
Replace the compact `process/ProductionActionRail` (Start/Stop/Defect/Crew/End Entry/End Shift) on PKL with the **rolling side production panel** ergonomics (`SixHiGlobalProductionPanel` / `SixHiProductionActionRail`):
- **Start / End** as the primary paired action (start the coil, end the coil), not the current Start + separate Stop-stoppage semantics.
- **Stoppage** as its own action (opens the rolling-grade stoppage modal — WS-A.4).
- **Remark** action (rolling `OrderRemarkModal` — the genuine gap noted in WS-A.4).
- **Hold** action (put the coil/journey on hold → MH review; PKL plan §9 hold-no-advance).
Generalise the rolling panel to be `processStore`-driven (not `sixHiStore`) so PKL (and other process lines) can mount it. This supersedes §A.4's "add Stoppage/Remark to the compact rail" for PKL specifically — PKL adopts the **full** rolling panel.

### 7. Shift **handover console** — PKL-specific
`ProcessHandoverPage` currently re-exports the **rolling** handover (coolant temp/pressure, scrap-kg, rolling/skin-pass MT — all wrong for PKL). Build a **PKL handover** (fork the `CrmOutgoingHandoverPage` structure, swap the sections):
- **Production Summary** — PKL metrics (Total pickled MT · coils pickled · avg line speed · total stoppage · repeats/W-P split) from `/stations/pkl/shift-metrics` + shift log.
- **Crew details** — session crew (Operator / Asst / Helper 1-3 / Line Incharge), reuse the roster/selected-crew mechanism.
- **Stoppages** — open + this-shift PKL stoppages (locked section).
- **Next order in queue** — upcoming PKL coils (from the PKL queue, not the rolling queue snapshot).
- **Outgoing operator notes** — mandatory free-text (keep the min-length gate).
- **Readings (Process Chart)** — a **PKL-only section** summarising the shift's chart readings (count logged vs due, last reading time, any out-of-spec highlights) with a link to the chart. This is the pickling-specific addition rolling doesn't have.
Remove the rolling-only fields (coolant, rolling/skin MT, pass-number order snapshot). **[dev-decision]** whether to keep the machine-condition/priority sections (useful) or trim.

### 8. Process Chart (readings) — align to the PKL log sheet + better UX
Rework `PklChartGrid` so the grid **matches the paper Process Record Chart column-for-column**, with time-interval **rows**. Target structure (from the log sheet):

```
TIME  (row = reading; interval labels 1st / 3rd / 5th / 7th Hour)
  LEVEL (mm)            → T1 · T2 · T3
  TEMP (°C)             → T1 · T2 · T3
  ACID STRENGTH (%)     → T1 · T2 · T3
  IRON STRENGTH (%)     → T1 · T2 · T3
  STEAM PRESSURE (kg/cm²)→ Inlet below PRV · Outlet of PRV · Outlet of Burner · Burner Masha Pressure (kg/cm²) · Hot Air Temp.
  DOSAGE (L/min)        → Acid · Water · Inhibitor
  HOT RINSE WATER       → Cl · pH · Flow · Temp
BOTTOM FIELDS           → Rinse Water Acid % · Iron % · Line Incharge
```

**Grid/UX changes:**
- Rows are **reading times** (the interval labels), so a shift shows all readings stacked (current grid captures a single reading at a time) — render the day's readings as rows, add-a-reading appends the next interval. Keep the soft "reading due" nudge.
- Group the columns exactly as above with sub-headers (T1/T2/T3 under each tank metric), matching the sheet so operators read it 1:1.
- Advisory spec highlighting stays (out-of-range = amber, still saves), sourced from `master.pkl_spec_limit`.
- Touch-friendly cells, sticky first column (time), horizontal scroll for the wide tank/steam groups; per-group visual separation.

**Data-model deltas vs the current chart (migration `txn.prod_pkl_chart`):**
| Log-sheet field | Current column | Action |
| --- | --- | --- |
| Steam Inlet below PRV | `steam_inlet_kgcm2` | keep (relabel "Inlet below PRV") |
| Steam Outlet of PRV | `steam_outlet_kgcm2` | keep (relabel "Outlet of PRV") |
| **Steam Outlet of Burner** | — (missing) | **add `steam_outlet_burner_kgcm2`** |
| Burner Masha Pressure | `burner_pressure_kgcm2` | keep (relabel "Burner Masha") |
| Hot Air Temp | `hot_air_temp_degc` | keep |
| Dosage Acid/Water/Inhibitor | `dosage_*` | keep |
| Hot Rinse Cl/pH/Flow/Temp | `rinse_cl/ph/flow/temp` | keep |
| Rinse Water Acid % / Iron % | `rinse_acid_pct/iron_pct` | keep |
| **Line Incharge** | — (missing) | **add `line_incharge` (text)** on the reading (or line row) |
| Level/Temp/Acid/Iron per T1-T3 | per-tank rows | keep (§2.2 singleton rule from PKL plan) |

So the chart needs a **small migration**: add `steam_outlet_burner_kgcm2` and `line_incharge`, extend `pklChartRowSchema`/`PKLChartRowSchema` and the `/stations/pkl/chart` write to accept them, and update `PklChartGrid` + the spec-limit seed (add a `steam_outlet_burner` LINE limit if the WI specifies one — **[confirm]**).

---

## PART 2 — MACHINE HEAD (PKL)

### 1. Live Dashboard — PKL-specific
The current `MachineHeadDashboard` is rolling-shaped (ROLLING/SKIN_PASS tabs, order queue tables). For the **PKL MH desk** (which already exists — `pklMhDesk`), build a **PKL live view** (a PKL branch of the dashboard, or a dedicated `MhPklLive` page reached from the PKL desk's Live Dashboard nav item). Layout top→bottom:
1. **Order status card (live)** on top — the currently-running PKL coil (batch, customer, grade, width/thk, start time, runtime timer, produced/target, status). Reuse the live snapshot + `useLiveTimer`.
2. **Tank cards T1 · T2 · T3** — one card per acid tank showing its **basic latest reading** (level, temp, acid%, iron%) with in-spec/out-of-spec colour. Data = latest `prod_pkl_chart` rows for the shift.
3. **Tank drill-in** — clicking a tank card opens the **exact reading detail from the process page** (all that tank's captured values for the reading, with spec limits) — a modal reusing the chart cell/spec rendering.
4. **Trend cards / charts** — line/area charts of the chart readings over the shift (e.g. tank temps, acid strength, rinse pH) from the logged `prod_pkl_chart` series. **`recharts` (^3.8.1) is already a client dependency** — use it. Shows drift across the 1st/3rd/5th/7th readings.

**Read endpoint already exists:** `GET /stations/pkl/chart/:shiftLogId` (`processStationRoutes.ts`) returns the shift's chart rows — the live tank cards, drill-in, and trends all read from it. **[verify]** only its return **shape** covers per-tank rows + line singletons over time (extend the query if it currently returns a flat/single-reading shape).

### 2. PKL Specs — full CRUD redesign (with Update)
`PklSpecAdmin` today is a bare "upsert one param row" form with raw `param_key`/`tank_scope` strings and **no edit or delete**. Redesign:
- **Full CRUD**: Create, Read (table), **Update**, Delete. **Verified routes:** `GET /stations/pkl/spec-limits` + `POST /stations/pkl/spec-limits` (upsert keyed by `param_key`+`tank_scope`) exist — so Create **and** Update are both served by the existing upsert (edit-in-place re-POSTs the same key). **Delete has no route — add `DELETE /stations/pkl/spec-limits`** (or a soft `active=false` via the upsert, which avoids a new route — **[dev-decision]**).
- **Friendly UI**: group by scope (T1/T2/T3/RINSE/LINE), human labels for each `param_key` (map the internal keys to log-sheet names: `tank_temp`→"Tank Temp °C", `acid_strength`→"Acid Strength %", `steam_inlet`→"Steam Inlet", `steam_outlet_burner`→"Steam Outlet of Burner", etc.), unit column, min/max with validation (min ≤ max), active toggle.
- **Chart-interval config** stays here (interval hours, reading labels) with the same edit affordance.
- Seed/pre-populate from the Work Instruction (PKL plan §7) so the table is never empty; "reset to WI defaults" action **[dev-decision]**.

### 3. Shift Review — PKL, sourced from the operator handover console
`PlantShiftReviewPage` is already per-line aware (it carries an `AnnShiftReviewPayload`). Add a **PKL shift-review payload/branch** that surfaces the **shift details captured at the operator's handover console** (§Operator-7) plus PKL production:
- **Shift details** from the submitted handover: outgoing/incoming shift, operator, outgoing notes, machine condition/priority, crew.
- **Production**: pickled coils + Σ MT this shift, avg line speed, repeats/W-P split.
- **Stoppages**: this-shift PKL stoppages with durations.
- **Process-chart readings**: readings logged vs due, out-of-spec count, `line_incharge` per reading.
- Reuse the ANN pattern (a `PklShiftReviewPayload` + a `GET /…/shift-review?shiftLogId=` PKL branch, or extend the existing endpoint to return PKL shape). Approve/lock flow same as ANN/CRM.

---

## Data-model / migration summary (what needs DDL or contract change)
1. **`txn.prod_pkl_chart`** — add `steam_outlet_burner_kgcm2` (numeric), `line_incharge` (text). Extend `pklChartRowSchema`/`PKLChartRowSchema` + `/stations/pkl/chart` write. *(migration)*
2. **`master.pkl_spec_limit`** — add `steam_outlet_burner` LINE limit to the seed **[confirm WI value]**. Create/Update served by existing `POST` upsert; **add a `DELETE` route** (or soft-delete via `active=false`). *(seed + delete route)*
3. **Chart read endpoint** — **already exists** (`GET /stations/pkl/chart/:shiftLogId`); only **verify/extend its return shape** for the MH trends (per-tank + line over time). *(no new route, maybe query change)*
4. **PKL shift-review** — `PklShiftReviewPayload` + endpoint branch. *(route/contract)*
5. **Manual PKL coil** — extend `createManualCoil` payload with the PKL order fields (§Operator-4). *(contract)*
6. Label-only changes (Line Speed M/min, Leader End) and field removals (Repeats, Heat No, Process Route, QC panel) are **client-only** — no migration; keep columns nullable for back-compat.

---

## Build order (dependency-aware)
1. **Shared re-skin prerequisites** (from the other plan): generalised `ProcessPPCCards`, timer/status banner on `processStore`, `processStore`-driven side production panel. *(unblocks Operator §2, §6)*
2. **Operator console cleanup** — §5 field renames/removals + §2 card framing + §3 remove Manual Add + §1 nav move. *(all client-only, ship together)*
3. **PKL manual form** (§4) + `createManualCoil` extension.
4. **Chart redesign** (§8) — migration (2 cols) + grid rebuild + spec seed.
5. **Side production panel** (§6) — generalise rolling panel, wire Start/End/Stoppage/Remark/Hold.
6. **PKL handover console** (§7).
7. **MH: chart read endpoint** → **Live Dashboard** (order card + tank cards + drill-in + trends) (§MH-1).
8. **MH: PKL Specs CRUD** (§MH-2).
9. **MH: PKL Shift Review** (§MH-3).

Suggested first slice: **Operator §1+§5+§3 (nav + field cleanup + remove manual add)** — pure client, immediately visible, no migration — then the chart redesign, then the MH surfaces.

---

## Open decisions
- `endFilling`→`leaderEnd` and `lineSpeedMpm` label vs key rename (recommend label-only, no migration).
- Keep or retire `repeats` / `heatNo` columns after removing from the UI (**confirm with plant** whether ever needed at PKL).
- `steam_outlet_burner` — confirm it's a distinct instrument from Burner Masha pressure (the sheet lists both) and whether the WI gives it a spec limit.
- `line_incharge` — per-reading vs per-shift (recommend per-reading to match the sheet's bottom row).
- MH Live trends — which series to chart by default (`recharts` is available — confirmed).
- PKL Specs — Create/Update served by existing upsert; decide **hard `DELETE` route vs soft `active=false`**.
- Whether the machine-condition/priority handover sections stay for PKL.

---

## Acceptance / verification
- **Nav:** PKL operator reaches the Process Chart from the **side nav**; the secondary `Coils | Process Chart` top bar is gone; the queue is the only Hub content.
- **Capture:** PKL capture shows a Current-Running-Order card, shift-summary strip, stoppage details, live timer — rolling-grade — and the form body holds only Line Speed (M/min) / W/P / Leader End / time / remarks; no Repeats, Heat No, Process Route, duplicate identity, or bottom QC panel.
- **Manual:** the generic Manual Add is gone from the PKL queue; the new PKL manual form creates an ad-hoc coil with the PKL order fields.
- **Side panel:** Start/End paired, Stoppage, Remark, Hold all work, `processStore`-driven.
- **Chart:** grid matches the log sheet (all listed columns incl. Outlet-of-Burner + Line Incharge); readings stack by interval; out-of-spec highlights and still saves; new columns persist and round-trip.
- **Handover:** PKL handover shows PKL production summary, crew, stoppages, next PKL coils, outgoing notes, and a chart-readings section — no rolling coolant/pass fields.
- **MH Live:** order status card on top, T1/T2/T3 tank cards with latest readings, tank click → full reading detail, trend charts from the shift's readings.
- **MH Specs:** create/read/update/delete spec limits + interval; friendly labels; seeded from WI.
- **MH Shift Review:** PKL shift details pulled from the operator handover + PKL production/stoppage/chart data; approve/lock works.
- Client + server builds green; UTF-16 caution on `.ts` edits.
