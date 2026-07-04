# Kiro Agent Prompt (FINAL) — DPR Manager with codebase auto-sourcing

> Paste this into Kiro. Unlike the Lovable version, Kiro has access to my existing codebase, which already contains the DPR logic and many of the values. The new capability: **Kiro must first read my whole codebase, discover which values it can pull automatically, ask me clarifying questions where the source is ambiguous, wire those into the app, and leave the rest as optional manual inputs (default 0).** Everything else (template fidelity, month-awareness, zero-fill) stays as specified.

---

You are building a web app called **DPR Manager** that digitizes a steel-plant "Daily Production Report" Excel workbook. You have access to my existing codebase. Work in two stages: **(Stage 1) Discover & integrate data sources from my code**, then **(Stage 2) build the app**. Produce a spec/design doc and ask me questions before writing code.

## STAGE 0 — The two principles that define the whole app

**Principle A — the template is a blank MOLD, not data.** The Excel workbook I upload is last month's actual report, full of real numbers. Use it ONLY for structure, layout, formatting, fonts, colors, merged cells, column widths, row heights, and formulas. **Discard every daily-input value.** On import, build a "blank master" by setting every daily-input cell to 0, keeping all formulas, config, styles and labels. The template's own production numbers must never appear in any export.

**Principle B — template injection, never rebuild.** Never recreate styles or formulas in code. Load the `.xlsx`, write ONLY into known input/date cells, save. Use **ExcelJS** (`load` → set `cell.value` → `writeBuffer`); never SheetJS for writing (it strips styles). Run import/export server-side. Sanity check: load → zero all inputs → save → open in Excel → identical layout/colors/fonts/merges/formulas, only numbers cleared.

## STAGE 1 — Codebase discovery & auto-sourcing (THE NEW PART)

Before building anything, **read all of my files and code** — backend, DB schema/migrations, models, services, API routes, config, and any DPR-related modules, queries, or exports. Goal: figure out **which of the DPR input values already exist in my system and where**, so the app can fill them automatically instead of asking the operator to type them.

Do this concretely:

1. **Inventory the data.** For each DPR input field (per machine: production A/B/C; electrical/mechanical/operational stoppage; equipment availability; prev-maint; power failure; R/M shortage; shift-wise scrap/rej/trimm/b.slit; and the DELAY log's time/agency/reason), locate any matching source in my code — DB table + column, API endpoint, computed value, log, or file. Produce a **Source Map** table: `DPR field → machine → source (table.column / endpoint / function) → confidence (high/med/low) → how to query it`.

2. **Classify each field as one of:**
   - **Auto-sourced** — a clear, reliable source exists in my code → wire it up so the value is pulled automatically for a given date + machine + shift.
   - **Needs confirmation** — a plausible source exists but mapping/units/date-grain/shift-grain is ambiguous → **ask me a question** (see below).
   - **Manual** — no source in code → operator enters it (optional; default 0).

3. **Ask me relevant, specific questions** wherever sourcing is uncertain, in batched, multiple-choice form where possible. Examples of what to ask:
   - "Field `production shift A` for machine `6 Hi (R)` — I found `production_log.qty` keyed by `machine_id` and `shift`. Map `6 Hi (R)` → `machine_id = ?`"
   - "Stoppage minutes — your table stores seconds; convert to minutes for the sheet? (y/n)"
   - "Your data is per-event; should I aggregate by `date + machine + shift` (sum) to fill A/B/C?"
   - "Which machines are live for the pilot auto-feed? I see configs for 6 Hi, 4 Hi, 2 Hi — confirm these three."
   - "Date grain: is `production_log.ts` plant-day (06:00–06:00) or calendar day? It affects shift bucketing."
   Do **not** guess silently on anything that affects correctness — surface it as a question and wait.

4. **Output the Source Map + open questions FIRST** (as a markdown doc / Kiro spec), get my answers, then proceed to build. Re-run discovery if I point you at more code.

5. **Auto-fill behavior in the app:**
   - Auto-sourced fields are fetched for the chosen date and shown **pre-filled and visually flagged** (e.g. "from system") in the entry grid; the operator can override.
   - Confirmed-source fields behave the same once I've answered the mapping question.
   - Manual fields are blank/zero and **optional** — if the operator enters a value it's used; if not, it stays **0** (per Principle A). Entering the rest of the machines is **never mandatory**.
   - Keep a clean **integration layer** (one adapter per source) so sources can be added/changed without touching the export engine, and so the field-mapping is editable in the UI.

## STAGE 2 — App structure (build after questions answered)

### Workbook structure (verified — hard-code)

Two sheets: a main sheet (tab like `MARCH26`) that stacks identical **46-row day-blocks**, and `DELAY`.

```
titleRow(1) = 2
titleRow(N) = 49 + (N - 2) * 46          // day2=49 ... day31=1383
absoluteRow(N, offset) = titleRow(N) + offset
```

Machine rows (col-A label → offset):
```
HRS=4 PKLG=5 4 Hi(R)=6 4 Hi(RR)=7 4 Hi(SP)=8 6 Hi (R)=9 6 Hi (RR)=10 6HI SP=11
2 Hi (SP)=12 2HIR/W=13 R/W LINE=14 HPH=15 CRS-1=16 CRS-2=17 CRS-3=18 CRS-4=19
CRS-5=20 CRS-6=21 CTL-1=22 CTL-2=23 CTL-3=24 CTL-4=25 CTL-5=26 PKG=27 WIP=28 O.T=29
```

Column roles (main sheet):
- `A` machine name. `B` monthly target (config). `C,D,E` production A/B/C — **INPUT**. `F=C+D+E`,`G`=cumulative,`H`=avg — formulas.
- `Z,AA,AB` electrical · `AD,AE,AF` mechanical · `AH,AI,AJ` operational stoppage — **INPUT**.
- `AL,AM,AN` availability · `AP` prev-maint · `AR,AS,AT` power failure · `BB,BC,BD` R/M shortage — **INPUT**.
- Shift scrap/trimm/rej/b.slit: `BI,BJ,BK,BL`(A) `BM,BN,BO,BP`(B) `BQ,BR,BS,BT`(C) — **INPUT**.
- `V` prod-rate target (config). `X` day-count divisor (structural — keep, don't zero).
- All else (`F,G,H,I–P,Q–U,AC,AG,AK,AO,AU,BG,BW–CA,CD–CH,CK–CU`, summary/target/scrap/yield rows) = **formulas — never write**.
- Day-number = column `BH` on title row.

`DELAY` sheet: header rows where col A=`"LINE"` (3 shift blocks/day). `A`=machine, `B`=date (header only), `C`=shift A/B/C, `D`=time in min (**INPUT**; number / string like `"210--160"` / `"NIL"`), `E`=agency (**INPUT**), `F`=reason (**INPUT**). Block index `=(dayNumber-1)*3 + shiftIndex`.

**Cumulatives chain to the previous day** (`G53=F53+G6`, etc.); day-1 has no back-ref. So all input cells must hold a real **0**, never blank.

**Month identity is in exactly 3 places** — tab name, date strings, filename. **Zero sheet-qualified formula refs exist**, so renaming the tab is safe.

### Three cell classes
1. **Formula** → keep, recomputes, never written.
2. **Daily input** → 0 on import; filled by auto-source and/or operator; 0 if neither.
3. **Config/targets** (`B`, `V`, target-% rows, `X` seeds) → keep as editable defaults in a **Month Setup** screen; do not zero (would break target formulas / cause div-by-zero).
> Empty future days may show `#DIV/0!` in rate cells (production÷availability = 0÷0) — expected; clears when the day is entered; don't alter formulas.

### Month-awareness & variable length
Month/year come from the entered dates. On export rewrite: **tab** → `<MONTHNAME><YY>` (`JUNE26`); **date strings** → text `dd.mm.yyyy`, keep number-format `mm/dd/yy` (main col `M` title rows; `DELAY` col `B` header rows); **filename** → `DPR <Month> <Year>.xlsx`. Master has 31 blocks; export exactly `daysInMonth` blocks (leap-Feb aware) by **deleting surplus trailing blocks** (and trailing DELAY blocks), bottom-up; never delete from the middle. Cumulatives reset each month (day-1 `G=F`, no carryover).

### Sequential entry & zero-fill export
Enter days in order (day N only after 1…N−1 exist). Export the full month at any time: entered days carry their values (auto + manual), every other day's inputs are **0**, formulas compute on top. Show a day-status strip (✓ entered / ○ zero). "Start new month" creates a fresh dataset; never overwrite the stored mold.

### Architecture
```
FRONTEND: Import (one-time) · Source-Map review · Month Setup · Daily Entry
          (grid with auto-filled+flagged cells, optional manual cells, day-status)
          · Delay Log · Save / Export / Start new month
BACKEND:  DB tables (below) · master .xlsx storage
          · Integration layer = adapters over MY existing sources (from Stage 1)
          · Import-normalize (zero inputs → blank master)
          · Export-build (inject saved days → rewrite tab/dates → trim → ExcelJS writeBuffer)
ENGINE:   ExcelJS only (preserves styles/formulas/merges). Never SheetJS for writing.
```

### Data model
```
templates(id, name, file_blob, blank_blob, main_sheet_code, block_stride=46,
          first_title_row=2, machine_rows jsonb, input_cell_map jsonb,
          config_cell_map jsonb, delay_block_stride)
source_map(id, template_id, dpr_field, machine, source_ref, transform,
           confidence, status)          -- auto / confirmed / manual  (from Stage 1)
months(id, template_id, month, year, sheet_code, days_in_month,
       config_overrides jsonb, status)
daily_entries(id, month_id, date, day_number, values jsonb, delay jsonb,
              source_provenance jsonb,  -- which cells were auto vs manual
              status)
```

### Import flow
1. Upload `.xlsx` once; store blob. 2. Auto-detect block stride (scan main sheet col K=`"DATE"`), machine labels (col A), DELAY stride (col A=`"LINE"`). 3. Classify cells → `input_cell_map`/`config_cell_map`. 4. Build `blank_blob` (all inputs 0, styles/formulas/config intact). 5. Show field-mapping (auto + manual override) **and** the Stage-1 Source Map for review.

### Export flow
Load `blank_blob` → write each saved day's values (auto+manual; others stay 0) → inject DELAY rows → apply month config → rewrite tab + dates → trim to `days_in_month` → `writeBuffer` → download.

### Guardrails
Allow-list writes (input cells + date cells + tab rename + trailing-block delete only). Always write numeric **0** to empty inputs. DELAY col D stores raw strings when non-numeric. Day-count-agnostic (28/29/30/31). Auto-sourced values must be overridable; manual entry always optional.

### Acceptance tests
1. Stage-1 Source Map produced with confidences + open questions, before any build.
2. Auto-sourced machines pre-fill from my code for a chosen date; operator can override; un-entered machines export as 0.
3. Import a filled template → blank master shows 0 in all input cells, identical colors/fonts/merges/spacing/formulas.
4. Enter days 1–6 of May, export → days 1–6 my data, 7–31 zeros, cumulatives correct, tab `MAY26`, dates `0x.05.2026`, file `DPR May 2026.xlsx`, 31 blocks.
5. June → 30 blocks; out-of-order day entry blocked; new month resets cumulatives.
6. Any export opens in Excel indistinguishable from the master except data.
```
