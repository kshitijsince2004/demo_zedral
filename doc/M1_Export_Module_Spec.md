# M1 Export Module — Technical Specification

**Project:** Hero Steels CR Plant — Module M1 (Digital Data Collection Layer)
**Component:** Export / Reporting Engine
**Audience:** Backend developer or coding agent
**Status:** Implementation-ready design (stack-agnostic)
**Companion files:** `M1_Data_Field_Mapping_Register.xlsx`, `M1_Data_Field_Mapping_Report.docx`

---

## 0. How to read this document

This spec is technology-neutral. It defines **what** to build (data model, services, contracts, layout rules, formulas, acceptance tests), not which framework to use. Where a concrete choice helps, a library is suggested per stack in §11, but any equivalent works. A coding agent should be able to scaffold the module directly from §2–§9; §10 is the test suite to verify against.

Four export products are in scope:

| # | Export | Output | Primary consumer |
|---|--------|--------|------------------|
| E1 | **DPR auto-generation** | Monthly DPR workbook (month sheet + DELAY sheet), `.xlsx` | Plant management / MIS |
| E2 | **Line log-sheet export** | One file per process matching the paper format, `.xlsx` / `.pdf` | Line records / audit |
| E3 | **Coil traceability report** | Per-coil cross-process history, `.pdf` / `.xlsx` | Quality / customer |
| E4 | **Raw data / register export** | Filtered flat extract, `.xlsx` / `.csv` | Analysts / BI |

All four read from the **same M1 canonical data store**. None re-key data; every value is either captured in M1 or derived from captured data.

---

## 1. Context & guiding principle

M1 captures, in digital forms, the field set defined in the Data Field Mapping Register: **115 canonical fields across 8 processes** (HR Slitting, Pickling, Cold Rolling Mill, Annealing, Skin Pass, Rewinding, CRS, CTL), with `COIL_NO` as the traceability spine and shared masters for Customer, Grade, Defect, Stoppage, Operator.

The legacy DPR workbook is an **aggregation/rollup layer above the line logs**: operators today re-key shift production, stoppage minutes, and scrap into a calculation spreadsheet. The single most important design principle of this module is:

> **Capture once at the line; derive everything downstream.**
> Every figure in the DPR, every log-sheet cell, every traceability row, and every register row must resolve to data already captured in M1. The export engine aggregates and formats — it never asks a human to type a number twice.

---

## 2. Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│                     M1 Data Collection Layer                    │
│   (digital forms → validated writes → canonical data store)     │
└───────────────────────────┬────────────────────────────────────┘
                            │ read-only
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                       EXPORT MODULE                             │
│                                                                 │
│  ┌────────────┐   ┌──────────────┐   ┌─────────────────────┐    │
│  │  Export    │──▶│  Aggregation │──▶│  Template Binder    │    │
│  │  API /     │   │  & Derivation│   │  (maps data → cells │    │
│  │  Scheduler │   │  Service     │   │   / report regions) │    │
│  └────────────┘   └──────────────┘   └──────────┬──────────┘    │
│        │                                         ▼               │
│        │                              ┌─────────────────────┐    │
│        │                              │  Renderer Adapters  │    │
│        │                              │  xlsx · pdf · csv   │    │
│        │                              └──────────┬──────────┘    │
│        ▼                                         ▼               │
│  ┌────────────┐                       ┌─────────────────────┐    │
│  │ Job Store  │◀──────────────────────│  Artifact Store     │    │
│  │ (status)   │                       │  (generated files)  │    │
│  └────────────┘                       └─────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Components

- **Export API / Scheduler** — accepts on-demand export requests and runs scheduled jobs (e.g. DPR nightly). Long-running exports run **asynchronously**: request returns a `jobId`; client polls or receives a webhook.
- **Aggregation & Derivation Service** — the brain. Pulls captured records for the requested scope, applies the roll-up and KPI formulas (§6), and produces a neutral **Report Data Model (RDM)** — a plain JSON structure independent of output format.
- **Template Binder** — maps the RDM onto a report layout definition (cell coordinates for Excel, sections for PDF). Layouts are **declarative config**, not hard-coded, so the DPR grid can be re-tuned without code changes.
- **Renderer Adapters** — one per output format. They consume `(layout, RDM)` and emit a file. Adding a format = adding an adapter; the RDM and binder are unchanged.
- **Job Store / Artifact Store** — job status + generated files with retention and access control.

### 2.2 Key design rules

1. **RDM is format-agnostic.** Aggregation never knows whether output is xlsx or pdf.
2. **Layouts are data.** Store DPR/log-sheet layouts as versioned JSON/YAML so plant changes (a new line, a renamed column) are config edits.
3. **Derivation is centralized.** All KPI math lives in one service and is unit-tested (§10), so the DPR, traceability report, and dashboards never disagree.
4. **Exports are reproducible & immutable.** A generated artifact is snapshotted with the data-version/timestamp it was built from; re-running for the same scope with unchanged data yields an identical file.

---

## 3. Canonical data model (what the export reads)

The export module depends only on this read model. If M1's internal schema differs, expose these as views or a read API. Names follow the register's naming convention (§8 of the register).

### 3.1 Master tables

| Table | Key | Notable columns |
|-------|-----|-----------------|
| `process` | `process_code` | name, sequence_no (1–8) |
| `line_area` | `area_code` | name, process_code, DPR_area_label, operating_minutes_base (default 1440; HPH 16-charge base — see §6.4), is_dpr_reported |
| `customer` | `customer_code` | name |
| `grade` | `grade_code` | name, spec refs |
| `surface_finish` | `finish_code` | Matt/Bright/... |
| `defect_code` | `defect_code` | description, applicable_processes[] |
| `stoppage_reason` | `reason_code` | description, agency_code (OP/EL/MECH), dpr_category (one of the 8 categories §6.3) |
| `operator` | `operator_code` | name, role |
| `shift` | `shift_code` | A/B/C, start, end |

### 3.2 Transactional tables

```
coil
  coil_no (PK)            -- traceability spine
  source_coil_no (FK)     -- parent (e.g. HR coil → slit children)
  grade_code, customer_code, surface_finish
  nominal_width_mm, nominal_thk_mm, weight_mt
  current_process_code, current_status, for_ctl_flag
  created_at

process_run                -- one row per coil per process pass per shift
  run_id (PK)
  coil_no (FK), process_code (FK), area_code (FK)
  prod_date, shift_code (FK), operator_code
  time_from, time_to, time_total_min   -- total derived
  output_weight_mt, output_thk_mm
  status                                 -- OK / HOLD / REJECT / FOR_CTL
  -- process-specific attributes: see 3.3

process_attr               -- EAV for process-specific fields (or typed columns per process)
  run_id (FK), attr_key, attr_value, unit
  -- e.g. ('pass_thickness_1','0.85','mm'), ('acid_strength_t1','12.4','%')

stoppage_event             -- feeds DPR stoppage + DELAY sheet
  event_id (PK)
  area_code (FK), prod_date, shift_code (FK)
  minutes, agency_code, reason_code (FK), remark

disposition                -- feeds DPR scrap/rejection
  area_code (FK), prod_date, shift_code (FK)
  scrap_mt, internal_rej_mt, b_slit_mt, trim_mt
  -- may be derived per coil from process_run.status instead

production_target          -- feeds DPR TGT columns
  area_code (FK), period (date or month), target_mt, target_rate
```

### 3.3 Process-specific attributes

Each process contributes its unique fields (the 80 process-specific fields in the register). Implement either as typed columns per process table **or** the `process_attr` EAV above. EAV is recommended for M1 flexibility; the export binder reads by `attr_key`. The full key list per process is in register sheet **"05. Process-Specific"** and **"09. M1 Form Inputs"**.

---

## 4. Export pipeline (shared by all four products)

```
request(scope, type, format)
  → resolve report definition (E1/E2/E3/E4)
  → build query plan for scope (date range, area, coil, process…)
  → fetch captured rows from canonical model
  → AGGREGATE + DERIVE → Report Data Model (RDM)
  → bind RDM to layout (cells / sections)
  → render(format) → artifact
  → store artifact + job result
```

The only thing that varies between E1–E4 is **(a) the query plan, (b) the aggregation rules, (c) the layout**. Build them as plug-in "report definitions" implementing a common interface:

```
interface ReportDefinition {
  id                       // "DPR" | "LINE_LOG" | "COIL_TRACE" | "RAW"
  validateScope(scope)
  buildQueryPlan(scope) -> QueryPlan
  aggregate(rows) -> RDM
  layoutFor(format) -> Layout
  supportedFormats() -> [..]
}
```

---

## 5. Report Data Model (RDM) shapes

Neutral JSON the renderers consume. Illustrative shapes:

### 5.1 DPR RDM (E1)
```json
{
  "report": "DPR",
  "month": "2026-05",
  "days": [
    {
      "date": "2026-05-01",
      "day_index": 1,
      "areas": [
        {
          "area_code": "4HI_R", "area_label": "4 Hi(R)",
          "target_mt": 260,
          "prod": { "A": 12.22, "B": 13.32, "C": 43.70, "total": 69.24 },
          "cum_mt": 69.24, "avg_mt": 69.24,
          "stoppage_min": {
            "electrical": {"A":15,"B":0,"C":15,"total":30},
            "mechanical": {"A":0,"B":0,"C":0,"total":0},
            "operational": {"A":60,"B":410,"C":255,"total":725},
            "prev_maint":0,"power_failure":0,"no_plan":0,"rm_shortage":685
          },
          "equip_avail_min": {"A":405,"B":70,"C":210,"cum":685},
          "utilisation_pct": {"today":47.57,"cum":47.57},
          "prod_rate": {"A":8.16,"B":11.42,"C":12.49,"today":9.82,"cum":9.82,"target":13.76},
          "scrap": {"A":..,"B":..,"C":..,"total":..,"pct":..},
          "internal_rej": {"A":..,"total":..,"pct":..},
          "b_slit": {...}, "trim": {...}
        }
      ],
      "rollups": { "despatch_mt":171.51, "yield_pct":94.31, "wr_change":{"4hi":{"nos":0,"min":0}, ...} }
    }
  ],
  "delay_log": [
    {"date":"2026-05-01","area_label":"4Hi(R)","shift":"B","minutes":410,"agency":"OP","reason":"RMS"}
  ]
}
```

### 5.2 Coil trace RDM (E3)
```json
{ "report":"COIL_TRACE", "coil_no":"HSL-2026-04471",
  "header": { "grade":"...", "customer":"...", "source_coil_no":"..." },
  "timeline": [
    {"seq":1,"process":"HR Slitting","date":"...","shift":"A","operator":"...",
     "key_values":{"width_mm":..., "thk_mm":..., "weight_mt":...},
     "quality":{"defects":[...]}, "status":"OK"},
    {"seq":2,"process":"Pickling", ...},
    {"seq":4,"process":"Annealing","charge_no":"CH-...","base_no":"..."}
  ]
}
```

---

## 6. DPR aggregation & derivation rules (E1) — the critical logic

These rules are reverse-engineered from the legacy DPR workbooks (Jan–May 2026). Reproduce them exactly so output matches the spreadsheet.

### 6.1 Structure to emit
- One **month sheet** named like `MAY 2026`, plus a **`DELAY`** sheet.
- The month sheet is a **47-row "daily block" repeated once per calendar day**, anchored by the date. Keep the 47-row stride configurable in the layout (`DPR.block_height = 47`).
- Each block lists the same **ordered area list** down column A (configurable; current set, 26 areas): `HRS, PKLG, 4 Hi(R), 4 Hi(RR), 4 Hi(SP), 6 Hi(R), 6 Hi(RR), 6HI SP, 2 Hi(SP), 2HIR/W, R/W LINE, HPH, CRS-1…6, CTL-1…5, PKG, WIP, O.T`.

### 6.2 Three side-by-side regions per block (column groups)
| Region | Columns (legacy) | Content |
|--------|------------------|---------|
| Production & KPI | A–V | TGT, Shift A/B/C prod, TOTAL, CUM, AVG, stoppage (ELECT/MECH/OPRN today+cum), Utilisation %, Prod Rate (A/B/C/today/cum), rate target |
| Stoppage breakdown | Z–BF | Per-shift minutes in 8 categories (§6.3) |
| Scrap & Rejection | cols 60–99 | Per-area per-shift Scrap / Rej / B.Slit / Trim, today + till-date cumulative, Scrap % & Internal Rej % |

### 6.3 The 8 stoppage categories
`Electrical, Mechanical, Operational, Equipment Availability, Preventive Maintenance, Power Failure, No Plan, R/M Shortage`. Each `stoppage_event` maps to one via `stoppage_reason.dpr_category`. Sum minutes per area × shift × category.

### 6.4 Derived figures (formulas — do NOT capture these)
Let `prod_X` = production in shift X (A/B/C), captured.

- `TOTAL = prod_A + prod_B + prod_C`
- `CUM (day n) = TOTAL(day n) + CUM(day n-1)`  — running total chains down the month
- `AVG = CUM / day_index`
- `equip_avail_min = base_min − Σ(stoppages counted against availability)` where `base_min = 24×60 × operating_flag`. **HPH/annealing uses a 16× charge base** (`16 × 24 × 60`) — read `line_area.operating_minutes_base`.
- `utilisation_pct = equip_avail_min / base_min × 100` (today and cumulative variants)
- `prod_rate_X = prod_X / running_minutes_X × 60` (MT/hr); `prod_rate_today = TOTAL / Σ running_minutes × 60`
- `scrap_pct = scrap_mt / TOTAL × 100`; `internal_rej_pct = internal_rej_mt / TOTAL × 100`
- `yield_pct`, `WR-change counts/time`, `despatch`, `FG balance` — roll-ups from process_run/disposition; formulas in legacy rows 30–43 (replicate per area definitions).
- **Guard division by zero**: when denominator = 0, emit `0` or blank per the layout flag, never `#DIV/0!`. (Legacy sheets leak `#DIV/0!`; the digital export must not.)

### 6.5 Captured inputs (these come straight from M1, no math)
Production per area per shift; stoppage minutes per shift per reason (→ category); scrap / rejection / b-slit / trim per shift per area; daily target. All of these already exist in `process_run`, `stoppage_event`, `disposition`, `production_target`.

### 6.6 DELAY sheet
Per day, two-tier layout (per shift block) listing every line with `LINE | DATE | SHIFT | TIME IN MIN | AGENCY | REASON`. Source = `stoppage_event` filtered to the day. Lines with no stoppage render `NIL / NIL / NIL` (match legacy convention). Agency vocabulary: `OP, EL, MECH`. Reason examples seen: `RMS, W/R CHANGE, LUNCH, SETTING` (combinable, e.g. `30+40 → LUNCH+SETTING`) — these should resolve from the `stoppage_reason` master; preserve composite entries.

### 6.7 Output fidelity
Bind values into the exact legacy cell map (provide as layout config `dpr_layout.json`: per region, the column offsets and the area row offsets within the 47-row block). Optionally write the derived cells as **Excel formulas** (so the file stays "live" like the original) OR as **static values** (recommended for an export artifact). Make this a layout flag `emitFormulas: true|false`.

---

## 7. Line log-sheet export (E2)

Reproduce each process's paper log sheet from `process_run` + `process_attr` for a chosen `(area, date, shift)` or date range.

- One **layout template per process** (8 templates), mirroring the original sheet's columns, headers, code legends (defect/stoppage masters), and the sign-off block. Store as layout config keyed by `process_code`.
- The form/document numbers from the originals should be carried as template metadata (e.g. HR Slitter `PQR/PRD/0901/03`, CRS `FOI/PRD/1302/00`, CTL `FOI/PRD/1303/00`).
- Repeating line items (coils) fill the body rows; stoppage and crew sub-tables fill their regions; defect codes render from the master.
- Formats: `.xlsx` (editable record) and `.pdf` (signed archive). PDF should embed the same header/footer and a "generated from M1 on <timestamp>" watermark for audit.

Field-to-column mapping for each template = register sheet **"03. Process Inventory"** (fields per process) + **"02. Master Register"** (data type/unit/mandatory).

---

## 8. Coil traceability report (E3)

- Input: one `coil_no` (or a batch / customer / date filter).
- Walk the `coil` lineage (`source_coil_no`) and gather every `process_run` for the coil in process-sequence order (1→8).
- For Annealing, resolve via the grouping layer: the coil's `charge_no`/`base_no` and show the charge context.
- Emit the timeline (§5.2): per process — date, shift, operator, key dimensions/quality, defects, status. Highlight the `for_ctl_flag` routing.
- Output: `.pdf` (customer/quality-facing, one coil per page) and `.xlsx` (batch, one row per process step).
- This is the payoff of the `COIL_NO` spine: full genealogy from incoming HR coil to finished CTL/CRS output.

---

## 9. Raw data / register export (E4) & API contract

### 9.1 E4 behaviour
Generic, filterable flat extract for analysts/BI.
- Filters: `date_from, date_to, process_code[], area_code[], coil_no[], shift_code[], customer_code[], status[]`.
- Column set: selectable; default = the canonical register columns (Process, Sheet, Field semantics flattened to one row per `process_run` with attributes pivoted).
- Formats: `.csv` (BI ingestion) and `.xlsx` (with a data-dictionary sheet derived from the register).
- Must stream / paginate for large ranges (a full month can be tens of thousands of coil-process rows).

### 9.2 REST-style API contract (illustrative; adapt to M1's transport)

```
POST /api/exports
  body: {
    "type": "DPR" | "LINE_LOG" | "COIL_TRACE" | "RAW",
    "format": "xlsx" | "pdf" | "csv",
    "scope": {
       // DPR:        { "month": "2026-05" }
       // LINE_LOG:   { "process_code":"CRS", "date_from":"...", "date_to":"...", "shift":"A" }
       // COIL_TRACE: { "coil_no":"..." }  or { "customer_code":"...","date_from":"...","date_to":"..." }
       // RAW:        { "date_from":"...", "date_to":"...", "process_code":["CRM"], "columns":[...] }
    },
    "options": { "emitFormulas": false }
  }
  → 202 { "jobId":"exp_8f1c...", "status":"queued", "statusUrl":"/api/exports/exp_8f1c..." }

GET /api/exports/{jobId}
  → { "status":"queued|running|done|error",
      "progress":0..100,
      "artifact": { "url":"/files/...", "filename":"DPR MAY 2026.xlsx",
                    "bytes":..., "sha256":"...", "dataVersion":"...", "generatedAt":"..." },
      "error": null }

GET /api/exports?type=DPR&from=...&to=...   // history/listing
```

### 9.3 Scheduling
- DPR: nightly job at shift-C close generating/refreshing the current month workbook; month-end finalize-and-lock.
- Allow ad-hoc regeneration for a corrected day (idempotent: regenerating a month overwrites only changed blocks, preserving the artifact hash semantics).

### 9.4 Non-functional requirements
- **Async** for E1/E2 batch/E4 large ranges; sync allowed for single-coil E3.
- **AuthZ**: export scoped to the user's permitted areas; PDF archives immutable.
- **Audit**: log who exported what scope when; stamp each artifact with `generatedAt`, `dataVersion`, source record count.
- **Performance target**: a full monthly DPR (31 days × 26 areas) generates in < 10 s; raw month extract streams without loading all rows in memory.
- **i18n**: log sheets are bilingual (English/Hindi) on paper — keep label text in layout config so Hindi labels can be added without code changes.

---

## 10. Acceptance criteria & test suite

Build these as automated tests. The legacy workbooks (Jan–May 2026) are the golden reference for E1.

**Derivation unit tests (E1, §6.4)**
- `TOTAL = A+B+C` for a sampled area/day.
- `CUM(day n) = TOTAL(n) + CUM(n-1)`; verify chaining across a month boundary resets correctly.
- `utilisation_pct` matches legacy for a standard line (1440 base) and for HPH (16× base).
- `prod_rate` and `scrap_pct` match legacy values within rounding tolerance (±0.01).
- Division-by-zero scope yields `0`/blank, never `#DIV/0!`.

**Golden-file test (E1)**
- Generate DPR for May 2026 from equivalent captured data; cell-by-cell diff against `DPR MAY 2026.xlsx` for the production & KPI region and the DELAY sheet (allow tolerance on floats). All 31 day-blocks present at the right stride.

**DELAY sheet test (E1, §6.6)**
- Lines with no event render `NIL/NIL/NIL`; composite reasons (`30+40 / LUNCH+SETTING`) preserved; agency vocabulary constrained to master.

**Line log test (E2)**
- For each of 8 processes, a generated sheet contains every mandatory field from register "03. Process Inventory" and carries the correct form/document number.

**Traceability test (E3)**
- A coil with a known path (HR Slitting→…→CTL) yields a timeline in sequence order with no gaps; annealing step shows charge/base grouping; `for_ctl_flag` surfaced.

**Raw export test (E4)**
- Filters apply correctly; CSV row count = query count; xlsx includes data-dictionary sheet.

**Reproducibility test (all)**
- Same scope + unchanged data ⇒ identical `sha256` (excluding the generatedAt stamp region).

---

## 11. Suggested libraries by stack (pick one; all optional)

| Stack | Excel write | PDF | Notes |
|-------|-------------|-----|-------|
| Node.js | ExcelJS | Puppeteer (HTML→PDF) or pdf-lib | RDM as plain objects; layouts as JSON |
| Python | openpyxl (formatting/formulas) / XlsxWriter (speed) / pandas (raw) | WeasyPrint or ReportLab | recalc via LibreOffice headless if emitting formulas |
| .NET | EPPlus or ClosedXML | QuestPDF | strong typing for RDM |
| Java | Apache POI | OpenPDF / Flying Saucer | enterprise fit |

The **architecture, data model, RDM, formulas, layout-as-config, and API contract are identical regardless of choice.** Only the renderer adapters (§2.1) are stack-specific.

---

## 12. Build order (recommended)

1. Canonical read model / views (§3) + masters seeded (stoppage→category mapping is essential for E1).
2. Aggregation & Derivation service + unit tests (§6, §10) — highest-risk logic first.
3. RDM + Template Binder + first renderer (xlsx).
4. **E1 (DPR)** end-to-end against the golden May-2026 file. This proves the whole pipeline.
5. **E4 (raw)** — cheap once the pipeline exists; unlocks BI early.
6. **E2 (line logs)** — 8 layout templates from the register.
7. **E3 (coil trace)** — depends on lineage walk; PDF adapter.
8. API surface + scheduler + audit + access control.

---

*Everything specified here resolves to data already captured by M1. The export module is pure aggregation + formatting — no new manual entry. Field-level mappings live in the companion register; the DPR roll-up logic in §6 is derived from the Jan–May 2026 legacy workbooks.*
