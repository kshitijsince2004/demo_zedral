# ZEDRAL — Pickling Line (PKL) Operator · Implementation Plan

**Hero Steels Limited · Semi-Continuous Pickling · M1 Data Collection**
**Audience:** developers / IDE agent. This is a *logic + data + architecture* plan — **no UI/visual design**. It names the modules that must be touched or created, but does **not** enumerate every file; where a rule can reasonably be a developer's call, it is marked **[dev-decision]**.

> Route position: `P` (seq 20) — the **second** step on the material spine `S→P→4|6→R→F→X|Y|Z→C→LE→PKG`. Pickling consumes the child coils **born at HR Slitting** (`S`) and hands them to the cold-rolling mills (`4|6`). It does **not** create or destroy coils — one coil in, one pickled coil out.
> Extends the All-Process Operator work (`.kiro/specs/…`, `ZEDRAL_ALL_PROCESSES_OPERATOR_DESIGN_SPEC.md` §6). Sibling of the HR Slitter and CR Slitter plans (`ZEDRAL_HRS_OPERATOR_IMPLEMENTATION_PLAN.md`, `ZEDRAL_CRS_OPERATOR_IMPLEMENTATION_PLAN.md`) — but **not** a slit-builder: PKL reuses the *Archetype-A coil workspace* and adds a **second surface**, the hourly Process Record Chart. Reuses the CRM (6HI/4HI/2HI) operator console shell.

> **Decisions locked with the plant owner (2026-07-30):**
> 1. **1-coil-in → 1-coil-out.** Each log row is one incoming (already-slit) coil, pickled and advanced. **No fan-out, no child coils, no combine.** The pickling unit of work = the incoming coil, keyed by its SAP `Batch Number`.
> 2. **Hourly Process Chart is decoupled from coils** and captured on a **CRUD-configurable interval** — *default 2 hours* (1st / 3rd / 5th / 7th hour, as on the paper chart). The reading prompt is a **soft reminder**; it never blocks coil capture or handover.
> 3. **Specification limits** (from the Work Instruction, Rev 04 · 26-02-2026) are seeded into an **editable master** and applied as **advisory warnings** — out-of-range readings highlight but still save (same treatment as the CRS machine-spec envelope).
> 4. **`W/P`** is a literal **two-value selector — `W` or `P`** — stored as-is, no derived semantics.
> 5. Deliverable = this plan document. Implementation follows in a later pass.

---

## 0. Guiding principle — reuse the shell, add a chart

PKL is **~85% a re-use of the existing Archetype-A coil workspace** that HRS/RWD/CRS/CTL share, plus **one genuinely new surface**: the *hourly Process Record Chart*. The station shell, live timers, action rail, stoppage/defect/crew sub-forms, queue engine, journey advance and offline outbox all already exist for the CRM console and are reused as-is or generalised. What is genuinely new for PKL is: the **timed process chart** (a shift-level instrument log that runs on the plant clock independent of any coil), the **specification/standards master** that the chart validates against, and a handful of **coil-log fields** (`repeats`, `W/P`, `end filling`).

Unlike HRS/CRS, PKL has **no slit-combination builder, no child-coil birth, no machine-capability envelope** — pickling is a single station (`master.machine` = `PKL`) that transforms a coil in place.

**Current state (verified against the repo, 2026-07-30).** The backend is already scaffolded and, unlike HRS, is **not** the "legacy minimal" contract — it is largely complete:
- Contracts `PKLEntry` (`txn.prod_pkl`) + `PKLChartRow` (`txn.prod_pkl_chart`) in `packages/shared-validation/src/types/processes.ts`.
- Zod forms `pklSchema` + `pklChartRowSchema` in `packages/shared-validation/src/rules/m1Forms.ts`; validation `PKLSchema` / `PKLChartRowSchema` in `rules/fieldRules.ts`.
- Service `ProductionService.savePkl` (inserts the coil row **and** its `charts[]` in one transaction, then `emitCaptured('PKL', …)`).
- Route `POST /pkl` (`m1-collection/routes/productionRoutes.ts`).
- Tables `txn.prod_pkl` + `txn.prod_pkl_chart` (`db-types.ts`).

**So this plan is mostly UI + autofill + the chart surface + master data — not a new subsystem.** The client surface today is only the flat `GenericCapturePage`; the work is to replace it with the PKL Hub (Coils tab + Process Chart tab), wire PPC/prior-process autofill, add the small set of missing columns, and seed the spec/stoppage/defect masters.

---

## 1. Domain vocabulary (get these names right in code)

| Term | Meaning | Cardinality |
| --- | --- | --- |
| **Coil** | The incoming HR **child coil** (already slit at HRS), fed to the pickling line. Identified by its SAP `Batch Number`. The **capture unit** — one coil = one run = one log row. | 1 per entry |
| **Pickling run** | One coil's pass through the acid line. One time-from/to, one line speed, one crew. Synonymous with the coil entry (there is no multi-coil pass — locked decision 1). | 1 = 1 coil |
| **Process Chart reading** | One timed snapshot of the **line's** instruments (tanks, steam, dosage, rinse), logged on the plant clock **regardless of which coil is running**. | N per shift (default 4) |
| **Tank T1 / T2 / T3** | The three acid tanks (Acid Tank No.1/2/3). Level, temperature, acid-strength and iron-strength are read **per tank**. | 3 per reading |
| **Rinse tank** | The post-acid rinse stage (hot rinse water: Cl, pH, flow, temp; plus rinse acid%/iron%). Read **once per reading**, not per acid tank. | 1 per reading |

**Critical distinctions.**
- **From HRS/CRS.** Those fan **out** — one mother coil → many independently-measured child coils, each minting a coil number and spawning a journey. **PKL does neither.** The coil arrives already born (at HRS); PKL measures it, records process conditions, and advances the *same* coil's journey to rolling. There is **no slit builder** and **no `_slit` child table**.
- **From CRM.** A CRM "combined order" collapses N orders into one shared coil. **PKL has no combine/hold-group model** — each coil is independent.
- **The plan key is the child coil, not the mother.** In the PKL PPC the `Batch Number` column is the **per-coil SAP batch** and is **distinct from `Mother Coil`** (verified: Batch ≠ Mother on all 19 coil rows of `PICKLING 21.07.2026 B.XLSX`). `Mother Coil` + `Slit ID` are carried only for **traceability** back to the HRS pass. Keep `coilNo` (the pickling work unit, = SAP batch or the HRS child-coil number) strictly separate from `motherCoilNo`.

**Naming caution.** The paper chart's *"Burr. Meshar Pressure"* maps to the existing `burner_pressure_kgcm2` column — keep the column name, label it "Burr Masher" in the UI. `wip` (existing column) is **not** the `W/P` selector — see §2.

---

## 2. Data model

Reuse the existing contracts as the base. The coil header and the chart table already carry almost everything; **add** a short list of missing coil fields, and add **two small master tables** (spec limits, chart-interval config).

### 2.1 Coil header — `txn.prod_pkl` (one row per coil)

**Existing columns (keep):** `entry_id, shift_log_id, sl_no, coil_no, width_mm, thk_mm, weight_mt, line_speed_mpm, heat_no, source, wip, leader_end, time_from, time_to, remarks, prod_date, shift_code, tenant_id`.

**Add:**
- `repeats` (int, default 0) — operator input; count of re-pickle passes for the coil (a coil sent back through the acid line). **[new]**
- `wp` (enum `'W' | 'P'`) — the literal `W/P` selector (locked decision 4). *Do **not** reuse `wip` for this — `wip` stays as the free/coded WIP text already in the contract.* **[new]**
- `end_filling` (bool, `Yes/No`) — operator toggle from the log's "End Filling" concept. **[new]**
- `ht` (text / enum) — the log's **HT** column. Distinct from `heat_no` (SAP heat) and `source` (HT source). Treat as a short coded flag; **[dev-decision]** on whether it enumerates or stays free-text — clarify with the plant if values are constrained.
- `mother_coil_no`, `slit_id` (text) — traceability carry-forward from the PPC/HRS output (display + trace, not keyed). **[new]**
- `customer`, `grade_code`, `route_raw` (text) — denormalised from the journey/PPC for display and reporting; **[dev-decision]** whether to store or join live at read time.
- `total_time_min` (derived = `time_to − time_from`, minus stoppage) — **derived, never keyed**.
- `status` (enum) + crew ref — align with the shared Archetype-A header (`IN_PROGRESS / COMPLETED / HOLD`).

### 2.2 Hourly chart — `txn.prod_pkl_chart` (one row per time × tank)

**Existing columns (keep, already complete):** `chart_id, shift_log_id, chart_time, tank_no, tank_level, tank_temp_degc, acid_strength_pct, iron_strength_pct, steam_inlet_kgcm2, steam_outlet_kgcm2, burner_pressure_kgcm2, hot_air_temp_degc, dosage_acid, dosage_water, dosage_inhibitor, rinse_cl, rinse_ph, rinse_flow, rinse_temp_degc, rinse_acid_pct, rinse_iron_pct, tenant_id`.

**⚠ Key modeling decision (the one real data-model call).** The current shape is *"one row per (`chart_time`, `tank_no` 1–3)"*. That is correct for the **per-tank** fields (`tank_level`, `tank_temp_degc`, `acid_strength_pct`, `iron_strength_pct`). But the **per-reading singletons** (steam in/out, burner, hot-air, the three dosages, and all rinse fields) are **line-level, not per-tank** — the paper chart records them **once per time row**, not once per tank. If left as-is, three tank rows per time either triplicate those values or leave two-thirds null. Pick one and document it:
- **(Recommended)** Write the line-level singletons **only on the `tank_no = 1` row** for each `chart_time` (or a sentinel `tank_no = 0` "line" row); the UI reads them from there. Cheapest — **no migration**.
- Or split into two tables: `prod_pkl_chart_tank` (time × tank) + `prod_pkl_chart_line` (time only). Cleaner, but a migration and a contract change.

Whichever is chosen, the **client grid** presents the paper layout unchanged: rows = reading times, column groups = `Level | Temp | Acid% | Iron%` (each with T1/T2/T3 sub-cells) then `Steam (in/out) | Burr Masher | Hot Air | Dosage (Acid/Water/Inhibitor) | Hot Rinse (Cl/pH/Flow/Temp)` as single cells, with the footer `Rinse Water Acid% / Iron%` (→ `rinse_acid_pct` / `rinse_iron_pct`).

### 2.3 New master tables

- **`master.pkl_spec_limit`** — the Work-Instruction standards (§7). Columns: `param_key`, `tank_scope` (T1/T2/T3/RINSE/LINE), `min`, `max`, `unit`, `active`. **CRUD-editable** in a PKL machine-head profile; drives advisory range-checks on the chart. Seed from the Work Instruction (Rev 04).
- **`master.pkl_chart_config`** — chart cadence. Columns: `interval_hours` (default `2`), `reading_labels` (`['1st','3rd','5th','7th']` or generated), `reminder_mode` (`soft`), `active`. **CRUD-editable** (locked decision 2). For now seed `interval_hours = 2`.

**Migrations required** (describe intent; let the developer write DDL): extend `prod_pkl` (`repeats`, `wp`, `end_filling`, `ht`, `mother_coil_no`, `slit_id`, `customer`, `grade_code`, `route_raw`, `status`, crew ref, derived time); add `master.pkl_spec_limit` + `master.pkl_chart_config`; the chart singleton decision above (no migration if "tank_no=1 row"). Follow existing migration numbering and the **Windows/UTF-16 edit caution** (`zedral-windows-utf16-editing`: re-save `.ts` as UTF-8/LF if the Vite build throws `Invalid Character`). Extend `pklSchema` + `PKLSchema` to match the new columns.

---

## 3. PPC plan → dashboard field map

The plan file is **one row per incoming coil** (already slit). **No grouping needed** — each row is one queue card = one coil = one entry (contrast HRS, which groups rows by Mother Coil). Yellow rows in the sheet are **subtotals** (per customer/coil) and the final row (`115.36`) is the **grand total** — skip these on import. Verified against `PICKLING 21.07.2026 B.XLSX` (19 coil rows, 10 distinct mothers, grand total 115.36 MT).

| Plan column | Level | Maps to | Notes |
| --- | --- | --- | --- |
| `Batch Number` | coil | `coil_no` (the work-unit key) | **per-coil SAP batch; ≠ Mother Coil** |
| `Mother Coil` | coil | `mother_coil_no` | trace back to the HRS pass |
| `Slit ID` | coil | `slit_id` | which slit of the mother this coil is |
| `Customer Name` | coil | `customer` | display / reporting |
| `Width` | coil | `width_mm` | ⬅ prefer prior-process **actual**; PPC validates |
| `Pre Stage Thickness` | coil | `thk_mm` | HR gauge in (pickling preserves gauge) |
| `Coil Weight` | coil | `weight_mt` | **PPC = authoritative order weight** (§3.1) |
| `Grade` | coil | `grade_code` | e.g. `D`, `PT`, `FE360`, `MC-11`, `C-40` |
| `Process Route` | coil | `route_raw` → `resolved_next_step` | drives journey advance (§9); e.g. `SP4RFXCLE`, `SP4FXCZ` |
| `Surface` | coil | surface finish | `HR-BLACK` etc. |
| `Prod. Version` / `PV-Desc` | coil | station hint (`PICK`) | confirms this is a PKL-planned coil |
| `Plan Date` / `Shift` | coil | plant date / shift | queue filter |
| `Heat No` (if present) / `Source` | coil | `heat_no` / `source` | HT source |
| — (auto) | coil | **Serial Number** | auto-increment within the shift |

**Operator input (not from plan):** `line_speed_mpm`, `repeats`, `ht`, `wp` (W/P), `end_filling` (Yes/No), `time_from`/`time_to`, stoppages, defects, crew, remarks. Plus the entire **hourly chart** (§6).

### 3.1 Previous stage vs PPC — the autofill hierarchy

The dashboard **auto-fetches the coil from the previous stage** (HRS output, via `order_journey` step `P` becoming ready) and uses the **PPC as validation/reference**. Apply the platform autofill hierarchy (design spec §13.5):

```
Planning (PPC batch)      ▸ authoritative for ORDER WEIGHT (weight_mt)
   ▸ Prior-process output (HRS actuals via order_journey)   ▸ primary for width/thk/coil identity
      ▸ Coil master / grade / customer spec
         ▸ Manual measure  ◂ operator only enters what changed (line speed, W/P, HT, repeats, end-filling, time)
```

- **Coil Weight must match the order weight defined in the PPC Plan** (locked in the prompt). If the prior-process actual weight and the PPC order weight disagree beyond tolerance, **surface a soft validation flag** — display the PPC value as the reference, keep the actual, warn. **[dev-decision]** tolerance %.
- Everything else (customer, coil no, grade, width, thickness, route) comes **primarily from the prior process**, with the PPC as the cross-check. Missing prior-process record ⇒ fall back to PPC row; missing both ⇒ ad-hoc manual entry (unplanned coil path, §4).

---

## 4. Queue & journey (no fan-out)

- **Queue build.** Read `order_journey` steps where `current_step = P` and `status = READY` into PKL Hub queue cards (generalise `SixHiQueue`/`sixHiStore`). Each card = one coil, pre-loaded with its PPC + HRS-output autofill. Machine-scoped to the single `PKL` station.
- **Pick → capture → submit → advance.** On submit, `savePkl` fires `emitCaptured('PKL', …)` (`production.captured`). The captured-event → journey-advance path (marks the coil's `P` step `COMPLETED`, sets `current_step = 4|6` per `route_raw`) already exists — `order_journey` advancement lives in `QueueTransferService` / `ProcessRouteService`. **[verify]** confirm the exact subscriber wiring for `production.captured` (memory names a `JourneyAdvanceConsumer` pattern — idempotent, never re-throws; the in-process bus awaits handlers so a throw would 500 a committed capture). PKL only **advances** — it must not fan out.
- **No coil birth, no split.** PKL never mints coil numbers or spawns journeys; it only **advances** existing ones.
- **Edge cases:** unplanned coil (scan a coil with no `P` journey step → ad-hoc blank entry, manual identity); hold/reject (pause journey → MACHINE_HEAD review, does not advance); re-pickle (`repeats > 0`, same coil, does not double-advance).

---

## 5. Capture workflow — the Operator window (Coils tab)

Resembles the existing **Daily Production & Quality Report (Semi-Continuous Pickling)** log sheet, with manual entry minimised. Preserve the current logbook flow so operators work unchanged.

### 5.1 Load
Pick a queue card → workspace pre-fills all auto fields (§3 map): customer, coil no, mother/slit, grade, width, thickness, **weight (PPC-authoritative)**, route, heat/source, serial number.

### 5.2 Operator inputs (the only manual fields)
`Line Speed (m/min)` · `Repeats` · `HT` · `W/P` (selector, **W or P only**) · `End Filling` (toggle, **Yes / No**) · `Remarks` (free text, as in the current logbook). All autofilled fields remain **editable-on-override** but default from the source.

### 5.3 Timing
`Time from` / `Time to` (HH:mm) → `Total` derived. Reuse the button-driven net-production timer (`useNetProductionTimer` = wall − stoppage); Start/End taps record the times.

### 5.4 Stoppage / defect / crew sub-forms
Reuse the shared capture sub-forms, seeded with the **PKL** code sets (§8). Crew = Operator / Asst. Opt / Helper 1 / Helper 2 / Helper 3.

### 5.5 Submit & advance
Validate required fields (coil no, weight, line speed present; W/P chosen; End Filling chosen). Advisory weight/PPC cross-check (§3.1). Submit → `POST /pkl` → journey advance (§4). Offline → outbox, replays on reconnect.

---

## 6. Hourly Process Chart — the Reading window (Process Chart tab)

A **separate screen** replicating the paper **Process Record Chart** exactly, so operators stay familiar. It writes `txn.prod_pkl_chart` on a timer and is **decoupled from coil capture** — logging a reading never blocks the queue, and picking a coil never forces a reading.

### 6.1 Grid structure (identical to the paper sheet)
- **Rows** = reading times. Default cadence **2 hours** → labelled `1st Hour / 3rd Hour / 5th Hour / 7th Hour` (from `master.pkl_chart_config`; CRUD-configurable). Each label may hold the shift-relative timestamp (`chart_time` HH:mm).
- **Column groups** (matching the sheet, left→right):
  - `Level in mm` — **T1 · T2 · T3**
  - `Temp in °C` — **T1 · T2 · T3**
  - `Acid Strength %` — **T1 · T2 · T3**
  - `Iron Strength %` — **T1 · T2 · T3**
  - `Steam Pressure kg/cm²` — **Inlet (before PRV) · Outlet (after PRV)**
  - `Burr Masher (kg/cm²)` · `Hot Air Temp °C`
  - `Dosage L/min` — **Acid · Water · Inhibitor**
  - `Hot Rinse Water` — **Cl · pH · Flow · Temp**
  - Footer: **Rinse Water Acid %** · **Iron %** (`rinse_acid_pct` / `rinse_iron_pct`)
- The T1/T2/T3 sub-cells write **per-tank rows** (`tank_no` 1–3); the single-cell groups write the **line-level singletons** per the §2.2 decision.

### 6.2 Specification section (the Work Instruction standards)
Render the **complete specification/standards block exactly as the Work Instruction** (§7) — either as a fixed reference header above the grid **or** inline min/max hints on each cell. Values come from `master.pkl_spec_limit` (editable). A reading outside its standard **highlights (advisory warn)** but saves (locked decision 3).

### 6.3 Cadence & reminder
A **soft** "reading due" nudge fires from the plant clock at each configured interval (default 2 h). It is a reminder only — no hard gate on handover (locked decision 2). Interval and labels are CRUD-editable.

### 6.4 Persistence
Chart rows attach to the **shift** (`shift_log_id`), not to a coil. `savePkl` already accepts `charts[]`, but the chart tab should also support **independent save** (a reading logged when no coil form is open) — **[dev-decision]** add a `POST /pkl/chart` endpoint or allow `savePkl` with an empty coil + charts only; recommend a dedicated chart endpoint so the two surfaces are truly independent.

---

## 7. Specification / standards master (seed from Work Instruction, Rev 04 · 26-02-2026)

Seed `master.pkl_spec_limit` with these standards; editable thereafter. Applied as **advisory** range-checks on §6.

| # | Parameter | Scope | Standard |
| --- | --- | --- | --- |
| 1 | Rinse water flow | RINSE | 20–45 L/min |
| 2 | Temp. Acid Tank No.1 | T1 | 65–80 °C |
| 3 | Temp. Acid Tank No.2 | T2 | 65–80 °C |
| 4 | Temp. Acid Tank No.3 | T3 | 50–70 °C |
| 5 | Temp. Rinse Tank | RINSE | 65–85 °C |
| 6 | Temp. Hot Air | LINE | 110–140 °C |
| 7 | Steam pressure Inlet / Outlet | LINE | 4–6 / 2–3 kg/cm² |
| 8 | Acid strength — T1 / T2 / T3 / Rinse | T1/T2/T3/RINSE | ≤4 % / 4–7 % / 7–12 % / ≤0.10 % |
| 9 | Iron strength — T1 / T2 / T3 / Rinse | T1/T2/T3/RINSE | ≤17 % / ≤11 % / ≤6 % / ≤0.15 % |
| 10 | Burr masher pressure | LINE | 5–6 kg/cm² |
| 11 | Hot rinse pH / Chloride | RINSE | ≥6 / ≤100 PPM |
| 12 | Acid level auxiliary tanks 1,2,3 | T1/T2/T3 | ≤115 mm |

---

## 8. Master data — stoppage & defect codes (seed from the log sheet)

Seed `master.stoppage_code` / `master.defect_code` scoped `PKL` from the Daily Production & Quality Report:

- **Stoppage codes (15):** 01 Mechanical · 02 Electrical · 03 Crane · 04 Work Roll Change · 05 H.V/L.V · 06 B.U. Roll Change · 07 Raw Material · 08 Services · 09 Preventive Maint. · 10 Short of Man · 11 Power Failure · 12 Operational · 13 No Planning · 14 Hydraulic · 15 Mtl. short due to Crane B/D.
- **Defect codes (18, keyed by the sheet's numeric code):** 02 Edge Cut · 03 Slivers · 05 Seamline · 06 Scratches · 07 Rusty · 09 Holes · 11 Black Patches · 16 Waviness · 17 Lamination · 18 Pitting · 20 Rolled-in-Scale · 21 Width Variation · 23 Buckling · 32 Folding Marks · 39 Hump · 42 Cutter Mark · 43 Under Pickled · 44 Yellow Stain.
- **Crew roles (`CrewRole`):** OPERATOR · ASST (Asst. Opt) · HELPER (Helper 1/2/3) · SHIFT_INCHARGE (Line Incharge) · SHIFT_MANAGER.

---

## 9. Routing (per coil, plan-driven)

- One coil, one route. On submit, the coil's `P` step completes and the journey advances to the next step in its `route_raw` (typically `4|6` cold-rolling), via the existing captured-event → journey-advance path (§4, `QueueTransferService`/`ProcessRouteService`; idempotent, never re-throws).
- **Hold / reject** pauses the journey (no advance) → MACHINE_HEAD review. **Re-pickle** (`repeats > 0`) is an in-place rework, not a new journey.
- No For-CTL / split / combine logic exists at PKL (those are CRS/CTL concerns).

---

## 10. Dashboard / shift summary (metrics only — no layout here)

PKL Hub shift panel (generalise `SixHiShiftSummaryPanel`):
- **Total Production MT** (Σ pickled coil weight) · **No. of coils pickled** · **Avg line speed** · **Total stoppage time** · **Repeats count** · **Defect tally** (by code).
- **Chart compliance** — readings logged vs due this shift (soft indicator).
- **W/P split** and **End-Filling Yes/No** counts if useful for reporting.
Two Hub tabs: `Coils` (queue) and `Process Chart` (hourly). Two-tile top-line: Total Production / Coils.

---

## 11. Reuse map (packages/client/src)

| Need | Reuse | New for PKL |
| --- | --- | --- |
| Station shell / header / action rail | `SixHiLayout`, `ProductionHeader`, `SixHiProductionActionRail` (→ generalise to `ProcessLayout`) | — |
| Live timers | `hooks/useNetProductionTimer` | — |
| Queue engine | `SixHiQueue` / `sixHiStore` (journey step `P`) | queue card = single coil |
| Coil capture body | Archetype-A workspace (shared with HRS/RWD/CRS/CTL) | `repeats`, `W/P`, `End Filling`, `HT` fields |
| Stoppage / defect / crew sub-forms | shared capture sub-forms | seed PKL code sets (§8) |
| Journey advance | existing `production.captured` path (`QueueTransferService`/`ProcessRouteService`) | verify subscriber wiring |
| Offline outbox | existing | — |
| **Hourly Process Chart grid** | — | **net-new** (grid, cadence timer, spec hints) |
| **Spec-limit master CRUD** | pattern of CRS machine-spec envelope CRUD | **net-new** (`pkl_spec_limit`) |
| **Chart-interval config CRUD** | master-CRUD pattern | **net-new** (`pkl_chart_config`) |

---

## 12. Build order (dependency-ordered backlog)

1. **Extend `prod_pkl`** (`repeats`, `wp`, `end_filling`, `ht`, trace/denorm cols, status) + update `pklSchema`/`PKLSchema`. *(unblocks capture)*
2. **PKL Hub** shell with two tabs (`Coils`, `Process Chart`), machine-scoped to `PKL`.
3. **Coils tab** — queue binding (journey step `P`) + Archetype-A capture with PPC/prior-process autofill (§3, §3.1) + operator fields (§5).
4. **Process Chart tab** — grid (§6), the §2.2 singleton decision, independent save endpoint.
5. **Masters** — seed `pkl_spec_limit` (§7) + `pkl_chart_config` (2 h) + PKL stoppage/defect codes (§8); wire advisory validation.
6. **Journey advance** verification (P → 4|6) + hold/reject + re-pickle.
7. **Shift summary panel** (§10).
8. **Retire `GenericCapturePage`** for PKL once the Hub ships.

**Suggested first vertical slice:** the **Coils tab** end-to-end (queue → autofill → capture → advance), since the backend already supports it; then layer the Process Chart tab.

---

## 13. Left to the developer / open decisions

- **Chart singleton storage** (§2.2) — `tank_no=1` row vs split tables. *(recommend `tank_no=1`, no migration)*
- **`HT` field domain** — enum vs free-text; confirm the plant's allowed values.
- **Weight/PPC tolerance %** for the advisory cross-check (§3.1).
- **Independent chart endpoint** vs reuse `savePkl` with empty coil (§6.4). *(recommend a dedicated `POST /pkl/chart`)*
- **`customer`/`grade`/`route` denorm** — store on `prod_pkl` vs join live at read.
- Confirm whether any **PKL quality-spec (QSS)** attaches this early (pickling is pre-cold-roll; likely inherits mother-coil spec only for surface).

---

## 14. Acceptance / verification

- A PPC-planned coil appears in the PKL queue with weight = **PPC order weight**; width/thk/customer pre-filled from HRS output; operator enters only line speed / repeats / HT / W/P / End Filling / time; submit advances the journey to `4|6` and the coil leaves the PKL queue.
- Chart readings log independently on the 2-hour prompt; a value outside the Work-Instruction standard highlights but still saves; changing the interval in the master changes the reading rows.
- Spec-limit and chart-interval masters are CRUD-editable and re-seed correctly.
- Stoppage/defect/crew sub-forms show the PKL code sets; shift summary totals match Σ coil weights.
- Offline capture replays; journey advance is idempotent (no double-advance on retry).
- Server + client builds green; UTF-16 caution observed on `.ts` edits.

---

## 15. Required modules (not exhaustive)

- **Shared/validation:** `packages/shared-validation/src/types/processes.ts` (`PKLEntry`, `PKLChartRow`), `rules/m1Forms.ts` (`pklSchema`, `pklChartRowSchema`), `rules/fieldRules.ts` (`PKLSchema`, `PKLChartRowSchema`).
- **Server:** `m1-collection/services/ProductionService.ts` (`savePkl` + optional chart endpoint), `m1-collection/routes/productionRoutes.ts` (`POST /pkl`, `+ /pkl/chart`), `db-types.ts` (`TxnProdPkl`, `TxnProdPklChart`), migrations (extend `prod_pkl`, add `master.pkl_spec_limit`, `master.pkl_chart_config`), `JourneyAdvanceConsumer`.
- **Client:** new PKL Hub (Coils tab, Process Chart tab) reusing the generalised `ProcessLayout`/queue/timers/sub-forms; master-CRUD screens for spec limits + chart config.
- **Master data seeds:** PKL stoppage (15) + defect (18) codes; spec limits (§7); chart interval (2 h).
