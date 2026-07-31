# ZEDRAL — HR Slitter (HRS) Operator · Implementation Plan

**Hero Steels Limited · Hot-Rolled Slitting · M1 Data Collection**
**Audience:** developers / IDE agent. This is a *logic + data + architecture* plan — **no UI/visual design**. It names the modules that must be touched or created, but does **not** enumerate every file; where a rule can reasonably be a developer's call, it is marked **[dev-decision]**.

> Route position: `S` (seq 10) — the **first** step on the material spine `S→P→4|6→R→F→X|Y|Z→C→LE→PKG`. HRS is the **birth point of most coils in the plant**: child coils are minted here and their downstream journeys are spawned here.
> Extends the All-Process Operator work (`.kiro/specs/all-process-operator/`, `ZEDRAL_ALL_PROCESSES_OPERATOR_DESIGN_SPEC.md` §5). Sibling of the CR Slitter plan (`ZEDRAL_CRS_OPERATOR_IMPLEMENTATION_PLAN.md`) — same fan-out engine, one step earlier in the route. Reuses the CRM (6HI/4HI/2HI) operator console.

> **Decisions locked with the plant owner (2026-07-29):**
> 1. **Thickness = per-slit ID / Centre / OD** (3 points per slit). *Not* the paper log-sheet's 4-zone×T/B grid, and *not* the current single `thk_mm`.
> 2. **Full per-slit fan-out + routing** — each slit is an independent line with its own customer, weight, quality and downstream journey advance (CRS-style).
> 3. **Dynamic slit count** — remove the A–D (max 4) cap; support N slits as the PPC combination dictates.
> 4. Deliverable = this plan document. Implementation follows in a later pass.

---

## 0. Guiding principle — reuse the CRM shell, replace the body

HRS is **~80% a re-skin of the existing CRM operator console**, not a new subsystem. The station shell, live timers, action rail, stoppage sub-form, queue engine, journey advance and offline outbox all already exist for 6HI/4HI/2HI and are reused as-is or generalised. What is genuinely new for HRS is: the **slit fan-out** (one mother coil → many independently-measured child coils), the **child-coil birth + journey spawn** (unique to the first process), and the **per-slit ID/Centre/OD thickness capture**.

HRS is the **canonical slit-builder**; the CRS plan explicitly clones this pattern. Build it here cleanly and generically so CRS reuses it rather than forking.

Do not fork the CRM tree. Generalise the shared pieces into process-agnostic components and give HRS its own capture body.

**Current state (verified against the repo, 2026-07-29).** Backend already exists: `HRSEntry` + `HRSSlitSlot` contracts (`packages/shared-validation/src/types/processes.ts`), tables `txn.prod_hrs` + `txn.prod_hrs_slit`, the `POST /hrs` endpoint (`m1-collection/routes/productionRoutes.ts`) and `ProductionService.saveHrs`. **But** the contract is the *legacy minimal* one (one `thk_mm` per slit; slots capped A–D; no per-slit weight/customer/route), and the **only client surface is the flat `GenericCapturePage`** (5 fields, no slit builder, no PPC autofill). This plan upgrades the contract + data + workflow to the rich model, and replaces the flat form with the slit-builder workspace from the design spec §5.

---

## 1. Domain vocabulary (get these names right in code)

| Term | Meaning | Cardinality |
| --- | --- | --- |
| **Mother coil** | The HR input coil fed to the slitter (from HR raw-material receipt). Identified by the plan's `Mother Coil` column. | 1 per pass |
| **Pass / Run** | One physical slitting setup. The **capture unit** — one run timer, one stoppage log, one crew. | 1 |
| **Slit line** | One slit position (`Slit ID` A, B, C, …) on that mother = one customer order, with its own finish thickness, SAP batch and route. The **traceability + routing + quality-entry unit**. | 1..N per pass |
| **Child coil** | The physical output coil of a slit line, numbered `<motherCoilNo>-<slitId>` (derived, never free-typed). Its **journey is born here**. | 1 per line |

**Critical distinctions.**
- **From CRM.** A CRM "combined order" collapses N orders into *one* shared coil whose weight is then *allocated* back out. **HRS is the opposite:** the N slit lines are physically separate child coils, **each with its own full entry** — own actual width, own ID/Centre/OD thickness, own output weight, own customer, own route. Nothing is allocated; the pass total is the **sum** of independently weighed lines.
- **From CRS.** Structurally identical fan-out, but (a) HRS is the *first* route step, so child coils are **born** here (CRS re-slits already-born coils); (b) the HRS combination is a plain width sum (`483+483+536` — one slit per width), whereas CRS packs `width×count`; (c) HRS has no multi-machine capability envelope — it is a single station (`master.machine` = `HRS`), so there is **no eligibility gate / machine-spec CRUD** (a whole CRS section that HRS simply omits).

**Naming caution.** The plan column literally named `Batch Number` is the **per-line SAP batch**, not the pass. Keep `passId`/`runId` strictly separate from `sapBatchNumber`. Also note a pre-existing inconsistency to reconcile: the DB + `m1Forms.ts` schema call the slot field `slot`, while `types/processes.ts` + `fieldRules.ts` call it `label` — pick one (`slot`) during the migration.

---

## 2. Data model

Reuse the existing contracts `HRSEntry` + `HRSSlitSlot[]` (`packages/shared-validation`, `txn.prod_hrs` + `txn.prod_hrs_slit`) as the base; **extend** so a slit slot carries a **complete per-line record**, and **relax** the A–D cap to dynamic N.

**Pass header — `txn.prod_hrs` (one per mother-coil pass).** Existing: `shift_log_id, sl_no, coil_no (=mother), nominal_width_mm, actual_width_mm, nominal_thk_mm, weight_mt, actual_slit_width_from_mm, actual_slit_width_to_mm, scrap_mt, scrap_pct, time_from, time_to, remarks`. **Add:**
- `mother_coil_weight_mt` — from the plan's `M. Coil Weight` (the input mass; today's ambiguous `weight_mt` is retained as *produced* total or deprecated — **[dev-decision]**).
- `source`, `grade_code` — pass-level, from plan/coil master.
- `net_runtime_min` (derived = wall − stoppage), `status`, crew ref (see §5.7).

**Per-line entry — `txn.prod_hrs_slit` (one per slit line / child coil).** Existing: `entry_id, slot, width_mm, thk_mm, taper, child_coil_no`. **Restructure** so every dimension carries a **planned (PPC) ↔ actual (measured)** pair:
- `slot` — the slit label. **Change from `enum('A'..'D')` to a variable label/index** (string label derived from an ordinal, no fixed max). Remove the `.max(4)` rule in `fieldRules.ts` and the `z.enum(['A','B','C','D'])` in both schema files.
- **Width:** `target_width_mm` (PPC `Width`) ↔ `actual_width_mm` (measured). *Repurpose the current `width_mm` as the target; add actual, to avoid a silent semantic change.*
- **Weight:** `planned_weight_mt` (PPC `Coil Weight`) ↔ `actual_weight_mt` (measured per child coil). **[both new]**
- **Thickness:** `planned_thk_mm` (PPC — the mother `RM Thickness`; HR slitting does not change gauge, so the planned slit thickness *is* the mother's) ↔ `thk_id_mm` / `thk_centre_mm` / `thk_od_mm` (three measured points). **[new]** Deprecate the single `thk_mm` (keep nullable for back-compat, stop writing it — **[dev-decision]**).
- `taper` — existing.
- **`route_raw`, `resolved_next_step`** — per line, from PPC `Act. Process Route`. **First-class and required for every non-hold line.** HRS is the *first* step, so this route is what spawns the child coil's journey and lets it enter the plant flow (§7/§8); an unresolved route ⇒ the coil is stranded. Validate present before submit (§5.7).
- `child_coil_no` — existing; **auto-minted** `<motherCoilNo>-<slot>` (§7).
- `customer`, `sap_batch_number`, `surface_finish` — per line, from plan.
- `finish_thickness_mm` (PPC `Finish Thickness`) — the *downstream/final* target, carried for traceability. Distinct from `planned_thk_mm` above (which is the gauge at HRS).
- `downstream_crs_combination` — carry-forward of the plan's `CRS Combination` (informational; seeds the later CRS pass). **[new]**
- `hold_flag`, `for_ctl_flag` — per line.
- `qc_measurement_ref` — link to §6.

**Quality split.** HR slitting does not change metallurgy — mechanical/metallurgical values (if any spec is attached this early) are mother-coil properties, shared across children. Only **dimensional/surface** values (actual width, ID/Centre/OD thk, taper, edge/burr defects) plus weight/route are per-line.

**Migrations required** (describe intent; let the developer write DDL): extend `prod_hrs` (mother weight, source, grade, runtime, status, crew); extend `prod_hrs_slit` (target vs actual width, actual weight, three thickness columns, customer/finish-thk/batch/surface, route, downstream-CRS, hold, for-CTL, qc ref); **drop the A–D slot enum → dynamic label**. Follow existing migration numbering and the Windows/UTF-16 edit caution (`zedral-windows-utf16-editing`: re-save `.ts` as UTF-8/LF if the Vite build throws `Invalid Character`).

---

## 3. PPC plan → dashboard field map

The plan file is per-**slit-row** already: each row is one slit line, repeated per mother. **Group rows by `Mother Coil` → one queue card = one pass**; the grouped rows are the pass's slit lines. Verified against `hrs 21.07.2026 B.XLSX` (10 slit rows across 4 mothers; note a mother may have fewer rows in a given file than its full combination implies, e.g. `1100038465` shows one line but a 3-slit combination — the missing lines fall in another shift/date).

| Plan column | Level | Maps to | Notes |
| --- | --- | --- | --- |
| `Mother Coil` (D) | pass | `coil_no` (mother) — **group key** | |
| `Plan Date` (A) | pass | plant date | |
| `Shift` (B) | pass | shift | |
| `RM Width` (F) | pass | `nominal_width_mm` | mother width |
| `RM Thickness` (I) | pass + line | `nominal_thk_mm` (pass); seeds each line's `planned_thk_mm` | slitting preserves gauge, so the slit's planned thk = mother's |
| `M. Coil Weight` (G) | pass | `mother_coil_weight_mt` | input mass |
| `Grade` (K) | pass | `grade_code` | |
| `HRS Combination` (L) | pass | combination **display** `A+B+C` | e.g. `483.000+483.000+536.000`; validate it equals the ordered per-line `target_width_mm` |
| `Slit ID` (E) | line | `slot` | A, B, C, … (dynamic) |
| `Width` (H) | line | `target_width_mm` | **this** slit's planned width |
| `Coil Weight` (J) | line | `planned_weight_mt` (↔ measured `actual_weight_mt`) | plan `Σ J ≈ M. Coil Weight` (mass-balances in-plan) |
| `Customer Name` (O) | line | `customer` | **per-slit** — one mother can serve many customers |
| `Finish Thickness` (P) | line | `finish_thickness_mm` | |
| `Fin. Surface` (C) | line | `surface_finish` | MATT / BRIGHT |
| `Batch Number` (Q) | line | `sap_batch_number` | **At HRS this equals `Mother Coil`** (§3.1) — the incoming batch *is* the mother; per-customer batches are born downstream |
| `Act. Process Route` (N) | line | `route_raw` → `resolved_next_step` | **required** — drives child-coil journey spawn (§7/§8); critical at the first step (e.g. `SP4RFXCLE`, `SP4RFXCCZ`, `SZ`) |
| `CRS Combination` (R) | line | `downstream_crs_combination` | carry-forward; seeds the future CRS pass |
| `From/To Work Center` (S/T) | line | routing hint | `T=Z` typically = hold/ship |
| `Comp date` (M), `Ageing` (U), `Surface` (V), `Remark` (W) | line | metadata | |
| — (auto) | line | **Serial Number** | auto-increment within the shift/pass |
| — (auto) | line | **child coil no** | minted `<mother>-<slot>` (§7) |

**Operator input (not from plan):** mother `actual_width_mm`; per slit `actual_width_mm`, `actual_weight_mt`, `thk_id/centre/od_mm`, `taper`; production time from/to; scrap; stoppages; defects; crew; remarks.

**Worked example (mother `1100038447`, 3 lines):** A → 498 mm → Micro Precision (route `SP4RFXCLE` → to CTL), B → 375 mm → A.V. Industries (`SP4RFXCLE`), C → 432 mm → Havells (`SP4RFXCCZ` → ship as coil). Plan weights `8.86+6.67+7.69 = 23.22` = mother `M. Coil Weight`. One card, three independently-measured child coils, two distinct downstream routes.

### 3.1 Order-wise plan → mother-coil execution (the pivot)

The PPC is authored **order-wise** (each row = one customer's demand allocation), but the operator works **mother-coil-wise** (one physical coil in, many slits out). The plan already carries the bridge: **at HRS the `Batch Number` column equals the `Mother Coil` number on every row** (verified across the file). That is not a coincidence — HRS is the *first* step, so the incoming SAP batch *is* the mother coil; the per-customer order-batches are only **born downstream** when the child coils are created. Within a mother, the order-wise-ness survives as the per-slit lines (`Slit ID + Width + Customer + Route + downstream CRS combination`).

So the reconciliation is a **pivot performed at import / queue-build time**: `GROUP BY Mother Coil` turns N order-rows into one **pass** (= one physical coil = the operator's work unit). Demand (orders) is bound to supply (the coil).

**Operator flow is mother-first.** The queue card is a mother coil; picking it pre-loads its planned slit lines; the operator confirms the physical coil, measures actuals, submits; each child coil born inherits its slit line's customer/route and takes its own batch identity onward.

**Edge cases the pivot must handle:**
- **Unplanned coil** — HRS is fed from raw material, so a physical coil may have no plan row → ad-hoc path: start a blank pass on the scanned coil, add slit lines manually.
- **Planned ≠ physical coil** (substitution) — operator overrides the mother number; the slit-line demand re-binds to the actual coil.
- **One customer across many mothers** — the same customer appears under several mother groups; each mother stays its own pass; aggregate only at reporting, never merge passes.
- **Partial plan / completeness** — a given plan file may not contain *all* of a mother's slit lines (e.g. `1100038465` shows one line but its `HRS Combination` is `483+483+536` = 3 slits). **Parse the combination (col L) as the expected slit-count/width cross-check** and gather all rows for the mother across the full plan before building the pass; warn if the rows present don't match what the combination implies.
- **Leftover / skeleton** — a mother not fully consumed spawns a remainder coil that re-enters the queue.

---

## 4. Queue & journey fan-out

**Queue** is HRS-station-scoped. Because HRS is the **first** route step, its queue is fed primarily by the **PPC plan** (and HR raw-material receipts), *not* by upstream journey completions. Reuse the CRM queue engine and status pills (Pending / Preparing / In Progress / Hold / Completed).

**One queue card = one pass** = a mother coil plus its slit lines (group the plan rows by `Mother Coil`). The card shows the line count and the packed combination (`483+483+536`).

**Fan-out on submit (the core loop).** When a pass is submitted:

1. Server validates (width-combination + mass-balance + quality gate, §5).
2. For **each line independently**, **mint the child coil** `<mother>-<slot>` and **spawn a new `order_journey`** starting at that child's next route step from its own `route_raw` (§7/§8). The mother's HRS step is marked `COMPLETED`.
3. Route tails resolve per line: intermediate (`…P…`) → next process (pickling, etc.); `…CZ` → ship as coil → `PKG`; `…CLE` → CTL. A pass may mix routes.
4. Lines flagged **HOLD** / `PPC HOLD` (e.g. route `SZ`, `To Work Center = Z`) **do not advance**; the rest of the pass proceeds.

Reuse the existing `JourneyAdvanceConsumer` pattern: subscribe to the already-emitted `production.captured` event; **per-line**, idempotent, try/catch, **never re-throw** (a throw would 500 a committed capture — in-process bus awaits handlers). HRS is already in the consumer's advance set — extend it to **iterate the pass's lines and spawn** rather than advance a single pre-existing coil.

---

## 5. Capture workflow (logic)

Order of capture, and where each field comes from. Autofill hierarchy: **Plan ▸ coil / grade master ▸ manual** (only what physically changed).

### 5.1 Load
Operator's station is `HRS` → the pass loads from the plan: mother coil + input weight + all N slit lines pre-filled (target widths, customer, finish-thk, route). Grade/source from coil master. Quality spec fetched if present (§6).

### 5.2 Slit-combination validation
For the packed combination: `Σ(target_width) + edge_trim ≈ mother RM width` — warn (not block) on trim outside the expected band. Confirm the plan's `HRS Combination` display string equals the ordered per-line target widths. **[dev-decision]** edge-trim tolerance band.

### 5.3 Per-line entry (the fan-out body — the slit builder)
Dynamic list; **add slot** appends the next label (A, B, C, D, E, …) and mints its child coil. The plan's **target width / planned weight / planned thk** show as read-only references beside the inputs so the operator measures against them. Each line completed independently:
- **Actual width** — measured (vs `target_width_mm`).
- **Actual weight** — measured, per child coil (vs `planned_weight_mt`).
- **Thickness ID / Centre / OD** — three measured points, per slit (vs `planned_thk_mm`). Warn if a produced line has none.
- **Taper** — text/coded.
- **Process route** — pre-filled from plan, editable; **required** before the line can submit (it spawns the journey — §5.7).
- **Customer / finish-thk / batch** — from plan, editable.
- **Hold / for-CTL** — per line (from route or operator).

### 5.4 Mother actuals & mass balance
Mother `actual_width_mm` measured. Line output weights entered per child; **pass produced total = Σ lines** (derived, not allocated). Validate `Σ line actual_weight + scrap ≈ mother_coil_weight` — warn beyond tolerance. `scrap_pct = scrap_mt / mother_coil_weight_mt`, **derived, never keyed**. **[dev-decision]** mass-balance tolerance.

### 5.5 Timing
Button-driven (reuse the action rail + `useNetProductionTimer`). **Start**/**End** stamp `time_from`/`time_to`; **net runtime = wall − stoppage**; total auto-computed. Not PLC-driven — "auto start/stop" = auto-*stamped* on the operator's tap.

### 5.6 Stoppage / defect / crew
Reuse the shared sub-forms. **Seed the HRS master data from the log sheet PQR/PRD/0901/03** (§6). Crew for HRS = Crew 1/2/3 + Crane Operator (log-sheet footer). **Crew capture does not exist in the client yet** — net-new (would also backfill CRM); see §11.

### 5.7 Quality gate & submit
**Route guard (first-step-critical):** every non-hold line must carry a resolved process route before submit — without it the child coil cannot spawn a journey and would be stranded outside the plant flow. Block submit on a missing/unresolvable route (a **hard gate**, unlike the soft dimensional warns).
A line goes **HOLD** if a measured dimension (actual width vs target/tolerance, ID/Centre/OD vs finish-thk spec) fails, or `PPC HOLD` route. Hold is **per line**; passing lines still submit, mint their child coil and advance. Missing spec ⇒ `NOT_EVALUATED`, never blocks submit.

---

## 6. Master data — stoppage & defect codes (seed from the log sheet)

Stoppage codes are DB-driven (`/6hi/master/stoppage-categories`, `SixHiStoppageCodes.ts`) and defects per-process. Seed HRS from the physical form footer:

**Stoppage codes (13):** `01` Mechanical · `02` Electrical · `03` Crane · `04` Raw Material · `05` Opt. Service · `06` Preventive Maintenance · `07` Man Power Shortage · `08` Power failure · `09` Operational · `10` No Planning · `11` Mtl. Short due to crane under b/d · `12` Setting Adjustment · `13` Give Details.

**Defect codes (16) — S.No · Defect · Symbol:** `01` Over thickness `OG` · `02` Under thickness `UG` · `03` Scrap not cut `SNC` · `04` Edge bend `EB` · `05` Silver `S` · `06` Holes `H` · `07` Fire Cracks `C` · `08` Cutter mark `F` · `09` Edge cut `EC` · `10` Weaving `W` · `11` Taper `T` · `12` Rolled in Scale `R` · `13` Seamlines `S` · `14` Pitting `E` · `15` Burr `BIR` · `16` Scratches `SC`.

(Two symbols collide as `S` — Silver `05` and Seamlines `13` — key defects by numeric code, not symbol.)

**Quality integration (QSS).** If a spec sheet is attached this early, consume it through the single read surface `SpecFetchService.fetch(...)` / `GET /quality/fetch`: prefill (editable) on load, write measured values to coil-keyed `txn.qc_measurement` on submit, snapshot the resolved spec version onto the line, and treat a missing spec as `NOT_EVALUATED` (never 500). HRS-relevant spec params: `FIN_WIDTH_TOL` (per-slit width) and finish-thickness tolerance (ID/Centre/OD gate).

---

## 7. Child-coil birth & numbering (HRS-specific)

HRS is the **birth point** of most plant coils, so the mint + journey-spawn logic lives here (CRS later only re-slits existing coils).

- **Number:** `<motherCoilNo>-<slot>` (e.g. `1100038447-A`), derived, never free-typed — same convention as CRS.
- **Inherit:** grade + surface from the mother; **customer/finish-thk/route from the plan line** (per slit).
- **Spawn:** on submit, each child gets a **new `order_journey`** whose start step is the next step of its own `route_raw` (usually `P` pickling). Mother's `S` (HRS) step → `COMPLETED`.
- Idempotent: a replayed `production.captured` must not double-mint or double-spawn.

---

## 8. Routing (per-line, plan-driven)

Routing is **not** an operator choice and **not** pass-level — it is decided per line by the `Act. Process Route` code on the plan:

- Intermediate route (has downstream processes, e.g. `SP4RFXCLE`) → advance the child to its next step (`P` pickling …).
- Tail `…C**Z**` → ship as coil → `PKG`.
- Tail `…C**LE**` → For-CTL → `CTL` queue.
- `SZ` / `To Work Center = Z` / `PPC HOLD` → held, no advance.

For-CTL / Hold are per-line allocations of the pass output. The journey engine reads each line's resolved route and advances it (§4). Lines carrying a `CRS Combination` will be re-slit at CRS downstream — that combination is carried forward (§2) to seed the CRS pass, but HRS does not act on it.

---

## 9. Dashboard / shift summary (metrics only — no layout here)

Reuse the shift-summary panel; metric set from the HRS log-sheet footer:
**Target (MT) · Total Production (MT) · Scrap (MT) · Scrap (%) · Coils done · No. of Settings · per-defect counts · stoppage minutes by code.**

Header/footer fields to surface: `From No. PQR/PRD/0901/03`, Date, Shift, Operator + Code No., Crew 1/2/3 + Code No., Crane Operator + Code No., Line Incharge & Area Manager sign-off.

`No. of Settings` can be **derived**: increment whenever a pass's slit combination differs from the previous pass on the line (a knife changeover). **[dev-decision]** exact-layout vs near-layout threshold; auto vs operator-confirmed.

---

## 10. Reuse map

| Concern | Reuse (CRM/existing) | HRS change |
| --- | --- | --- |
| Station shell / header / live timers | `SixHiLayout`, `ProductionHeader`, action rail | generalise to process-agnostic; single-process (no rolling/skin tabs) |
| Queue + status pills | queue engine, `ZFilterPills` | queue card = pass; **plan-fed** (first step) |
| Timing | `useNetProductionTimer`, Start/End rail | none |
| Journey | `order_journey`, `JourneyAdvanceConsumer` | **mint child + spawn journey per line** (birth point) |
| Stoppage | stoppage modal + `/6hi/master/stoppage-categories` | seed 13 HRS codes |
| Defects | defect capture + `master.defect_code` | seed 16 HRS codes |
| Quality | `SpecFetchService`, `qc_measurement` (QSS) | fetch on load (if spec present), per-line HOLD |
| Offline | operator sync outbox / IndexedDB | none |
| **Slit fan-out (slit builder)** | — (design spec §5) | **the canonical implementation** — CRS clones it |
| **Per-slit ID/Centre/OD thickness** | — | net-new columns + entry grid |
| **Crew capture** | — | net-new (also backfills CRM) |
| Machine-capability envelope | *(CRS only)* | **N/A — HRS is a single station, no envelope/eligibility** |

---

## 11. Build order (dependency-ordered backlog)

1. **Migrations** — extend `prod_hrs` (mother weight, source, grade, runtime, status, crew); restructure `prod_hrs_slit` (target vs actual width, actual weight, ID/Centre/OD thk, customer/finish-thk/batch/surface, route, downstream-CRS, hold, for-CTL, qc ref); **drop A–D enum → dynamic slot**.
2. **Contract + schema** — update `HRSEntry`/`HRSSlitSlot` (`types/processes.ts`), `hrsSchema`/`hrsSlitSlotSchema` (`m1Forms.ts`), `fieldRules.ts` (remove `.max(4)`, reconcile `slot` vs `label`); update `saveHrs` insert.
3. **HRS queue binding** (§4) — pass grouping by mother coil from the plan.
4. **Capture body — slit builder** (§5), dynamic slots: per-line entry grid, slit-combination + mass-balance validation. *(This is the component CRS will reuse.)*
5. **Child-coil mint + journey spawn** (§7) — extend `JourneyAdvanceConsumer` to iterate lines and spawn.
6. **Routing fan-out** (§8) — per-line resolve + advance/hold.
7. **Stoppage/defect seed + crew capture** (§6/§5.6) — crew is net-new.
8. **Quality wiring** (§6) — spec fetch on load, `qc_measurement` on submit, per-line HOLD (if spec attached at HRS).
9. **Shift dashboard metrics** (§9).
10. Retire `GenericCapturePage` for HRS.

Suggested first vertical slice: **plan → queue → single-line pass capture → child mint + journey spawn**, then add multi-line fan-out, then thickness/quality, then dashboard.

---

## 12. Left to the developer / open decisions

- **`weight_mt` semantics** — keep as produced-total, or deprecate in favour of `mother_coil_weight_mt` + `Σ actual_weight` (§2).
- **`thk_mm` deprecation** — retire the single thickness once ID/Centre/OD ship, or retain for back-compat (§2).
- **`slot` vs `label`** — reconcile the two schema files onto one name during the migration (§1).
- **Slit-combination & mass-balance tolerances** (§5.2, §5.4).
- **Setting-count derivation** (§9) — exact-layout vs near-layout; auto vs confirmed.
- **Crew capture** — build now for HRS (and retrofit CRM) or defer to v2. Only workflow item with zero existing scaffolding.
- **Quality at HRS** — confirm whether a spec sheet is attached this early or quality is dimensional-only until later processes.
- **Dynamic slot upper bound** — practical UI cap (HR slitting is typically 2–5 wide slits) even though the model is unbounded.
- **Pass grouping key** (§3.1) — Mother Coil alone (one physical coil = one pass) vs Mother Coil + Plan Date + Shift; and how to gather a mother's slit lines when they're split across plan files (use the `HRS Combination` completeness cross-check).
- **Ad-hoc / substitution paths** (§3.1) — support unplanned coils and planned≠physical override in v1, or defer to v2.

---

## 13. Acceptance / verification

- Server + client builds green (mind the Windows/UTF-16 edit hazard, `zedral-windows-utf16-editing`).
- **Fan-out + birth test:** a 3-line pass with mixed routes (`…CLE` + `…CZ`) mints three child coils `<mother>-A/B/C` and spawns a journey per child to the correct next queue; a `PPC HOLD` line mints but does not advance.
- **Dynamic-slot test:** a pass with >4 slits saves and renders (proves the A–D cap is gone).
- **Route-capture test:** a non-hold line with no resolved route is **blocked at submit**; every produced child coil carries the exact plan `route_raw` into its spawned journey.
- **Planned↔actual test:** each slit persists both the PPC values (`target_width_mm` / `planned_weight_mt` / `planned_thk_mm`) and the measured actuals (`actual_width_mm` / `actual_weight_mt` / ID·Centre·OD), and both round-trip to the dashboard/export.
- **Thickness test:** ID/Centre/OD persist per slit and round-trip to the dashboard/export.
- **Mass-balance test:** `Σ line actual_weight + scrap ≈ mother_coil_weight` within tolerance; violation warns (not blocks).
- **Quality safety:** missing spec ⇒ `NOT_EVALUATED`, capture still commits (no 500); captured record snapshots its spec version.
- **Idempotency:** replayed `production.captured` does not double-mint / double-advance.
- **Offline:** capture queues and replays without data loss.

For high-value paths (child-coil spawn, journey fan-out, quality safety), add backbone tests mirroring the CRM P-series.

---

## 14. Required modules (not exhaustive)

Touch/generalise: the CRM operator shell + action rail; the queue engine; `JourneyAdvanceConsumer` (mint+spawn per line); stoppage master (`SixHiStoppageCodes.ts`) + `master.defect_code`; `SpecFetchService` / `qc_measurement`; `shared-validation` `HRSEntry`/`HRSSlitSlot` + `hrsSchema` + `fieldRules.ts`; `ProductionService.saveHrs`; the migration set.
Create: the HRS slit-builder capture body (dynamic slots, ID/Centre/OD grid — the canonical component CRS reuses); crew capture; HRS stoppage/defect seeds; HRS dashboard metrics.
