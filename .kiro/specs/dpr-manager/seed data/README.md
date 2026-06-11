# Zedral / FORGE — Demo Data Seed

This bundle populates the Zedral backend (the FORGE cold-rolling platform) with a
realistic, historically-backdated dataset so the application looks actively used
end-to-end — planning board, 6HI/CRM SMED execution, machine live view, shift logs,
and stoppage analytics.

It is built from **your own operational files**: the June 2026 PPC rolling /
skin-pass plans and the DPR June 2026 workbook. Where the source files don't supply
a field (operator names, execution timers, machine-state timelines), the seed
generates **synthetic but clearly-marked** data — never disguised as real.

## Files

| File | Purpose |
|------|---------|
| `extract_data.py` | Parses the 20 PPC plan spreadsheets + the DPR workbook into clean JSON. Header-driven, robust across the 4 PPC layout variants. |
| `extracted_data.json` | The extracted real data (regenerate any time with `extract_data.py`). |
| `seed-zedral-demo.mjs` | Idempotent Node seed that loads the data into Postgres, mirroring the conventions of the existing `scripts/seed-*.mjs`. |
| `master_ref.json` | Master reference rows (line_area, route codes, etc.) the extractor needs to map DPR area labels → system area codes. |

## How to run

From `packages/server` (so `pg` resolves), after migrations have been applied:

```bash
# 1. (re)generate the extract — point it at your source files
python3 extract_data.py /path/to/ppc_xlsx_dir "/path/to/DPR JUNE 2026.xlsx" master_ref.json

# 2. seed the database
DATABASE_URL=postgres://m1_user:m1_password@localhost:5432/m1_db \
  node seed-zedral-demo.mjs "$DATABASE_URL" extracted_data.json
```

The seed is **idempotent** — safe to re-run; it upserts and clears its own prior
synthetic rows first. It was validated end-to-end against a fresh database built
from all 39 migrations (PostgreSQL 17).

## What gets loaded (validated row counts)

| Table | Rows | Provenance |
|-------|------|------------|
| `master.customer` | 107 | **REAL** — distinct customers in the plans |
| `master.grade` | 24 | **REAL** — distinct grades |
| `master.surface_finish` | 3 | **REAL** — MATT / BRIGHT / LOW_MATT |
| `master.operator` | 15 | SYNTHETIC (marked `(SIM)`) |
| `master.stoppage_code` | 8 | reference codes (prefix `SD-`) |
| `coil.coil` | 370 | **REAL** — distinct mother coils |
| `planning.import_batch` | 20 | **REAL** — one per source file |
| `planning.ppc_batch` | 2,532 | **REAL** — every rolling + skin-pass plan row |
| `txn.crm6_order` | 2,532 | real batch refs; SYNTHETIC timing/status |
| `txn.crm6_rolling` | 976 | rolling children |
| `txn.crm6_skinpass` | 1,556 | skin-pass children |
| `txn.crm6_rolling_pass` | 2,197 | SYNTHETIC pass thicknesses |
| `txn.shift_log` | 269 | totals/targets **REAL** from DPR |
| `txn.stoppage_entry` | 343 | **REAL** delay reasons/durations from DPR DELAY sheet |
| `txn.crew_entry` | 60 | SYNTHETIC crew assignments |
| `txn.machine_state_event` | 72 | SYNTHETIC live-view timeline (tagged `[SEED]`) |

## Data provenance & how to tell real from synthetic

**Real** (verbatim from your files): PPC batches, coils, customers, grades, finishes,
per-shift production tonnage and targets (DPR), and stoppage reasons/durations (DPR
DELAY sheet — e.g. "SETTING CHANGED", "W/R CHANGED").

**Synthetic** (generated, always auditable):

- Operators — `full_name` ends in `" (SIM)"`, `emp_code` starts with `SIM9`.
- Machine-state events — `reason` is prefixed with `[SEED]`.
- 6HI shift-log handover notes — prefixed with `[SEED]`.
- Order execution timers/statuses, rolling-pass thicknesses, and crew assignments
  (crew reference the `(SIM)` operators).

To find every synthetic facet in the DB:

```sql
SELECT * FROM master.operator           WHERE emp_code LIKE 'SIM9%';
SELECT * FROM txn.machine_state_event   WHERE reason LIKE '[SEED]%';
SELECT * FROM txn.stoppage_entry        WHERE stoppage_code LIKE 'SD-%';
```

## Timeline

The DPR workbook has full daily logging for 9 contiguous days. The seed anchors those
9 real production days onto **June 1–9, 2026**, overlapping the live PPC plan window
(**June 1–10, 2026**). June 10 is presented as the current/active day — its C shift has
a mix of COMPLETED, one IN_PROGRESS, and PENDING orders so the live SMED view looks
genuinely in-progress. All earlier shift logs are APPROVED.

## Notes on schema mapping

- The PPC files cover the **4HI rolling** plan and **2HI skin-pass** plan (the active
  stage in every `process_route`). Both attach to the process-31 ("6HI"-complex)
  execution layer via `crm6_order`. The 6HI mill — the biggest line in the DPR — is
  given an active machine-state timeline so the hero line isn't empty.
- Source batch numbers repeat across days/shifts; duplicates are de-collided with a
  numeric suffix (`-2`, `-3`) to satisfy the `batch_number` UNIQUE constraint. The
  original value is preserved in `raw_row_json`.
- Demo login users (admin / supervisor / operator / machinehead / planthead) all use
  **PIN 1234**.
