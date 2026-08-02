# ZEDRAL — HRS Operator: Mother-Pick + Multi-Reading Capture · Implementation Plan

**Hero Steels Limited · HR Slitting (HRS) · M1 Data Collection**
**Audience:** developers / IDE agent. *Logic + data + architecture* plan. **[dev-decision]** marks a developer's call. Migrations are called out explicitly.

> Builds on `doc/ZEDRAL_HRS_OPERATOR_IMPLEMENTATION_PLAN.md`. This plan **changes a previously-locked decision**: thickness is **no longer** a per-slit ID/Centre/OD triple — it is now a **single value captured as multiple readings over time**, latest-wins. Taper and the mother's actual width follow the same multi-reading pattern.

## 0. Locked decisions (this pass, from the plant owner)
1. **Operator picks a Mother Coil only.** Everything else auto-populates from the plan per slit (A, B, C, …).
2. **Auto-fetched, display (mother level):** Customer name(s) — *one mother may serve several customers*, RM Width (planned), Mother Coil Weight, RM Thickness, Grade.
3. **Auto-fetched, display (slit level):** slit **Width** (from the `HRS Combination` / plan), plus customer, route, finish-thickness, batch per slit.
4. **Multi-reading capture (the core change):**
   - **Thickness** — per slit, a **single thickness value** per reading, added **time-to-time** (multiple readings). "Add reading" appends `{time, value}`.
   - **Taper** — per slit, same multi-reading pattern (`{time, taper}`).
   - **Actual Mother Width** — mother level, a **planned width** display + **actual width captured as multiple readings** (`{time, value}`).
5. **Latest reading is authoritative** for the child-coil record, quality check and DPR export. Earlier readings are retained for traceability.

> **Supersedes:** the old §1/§2 "Thickness = per-slit ID/Centre/OD (3 points)" decision. ID/Centre/OD is retired (columns kept nullable for back-compat, no longer written).
> **Not changed:** child-coil minting `<mother>-<slot>`, per-slit **Act. Process Route** as the hard gate that spawns each child's journey (row-8 `SZ`/`PPC HOLD` mints but does not advance), hold/for-CTL flags, mother scrap.

---

## 1. Current state (verified in repo)
- `txn.prod_hrs_slit` per-slit: `slot, width_mm, thk_mm, taper, child_coil_no` (base) + migration `1945…` added `target_width_mm, actual_width_mm, planned_weight_mt, actual_weight_mt, planned_thk_mm, thk_id_mm, thk_centre_mm, thk_od_mm, customer, sap_batch_number, surface_finish, finish_thickness_mm, route_raw, resolved_next_step, downstream_crs_combination, hold_flag, for_ctl_flag, qc_measurement_ref`.
- `txn.prod_hrs` pass header: `…, actual_width_mm (mother), mother_coil_weight_mt, nominal_width_mm, nominal_thk_mm, grade_code, …`.
- `HrsSlitBuilder.tsx` today captures **single** values: per-slit Actual Width, Actual Weight, Thk ID/Centre/OD, one Taper; mother single Actual Width.
- `JourneyAdvanceConsumer.spawnChildCoils` sets the child coil's thickness from `slit.thk_id_mm ?? actual_thk_front_mm ?? thk_mm` (line ~279).
- Auto-populate source: `ProcessStationService` reads slit lines from `planning.ppc_batch` into `card.orderLines`; `HrsSlitBuilder` seeds lines from `prefill.orderLines`. **Dependency:** those rows must exist in `ppc_batch` — and there is currently **no importer** for the HRS PPC sheet (rows are seeded). Tracked separately (see §7).

---

## 2. Data model + migration

### 2.1 New reading tables
Create two child tables (readings are append-only, timestamped):

**`txn.prod_hrs_slit_reading`** — per-slit thickness/taper readings.
```
reading_id     BIGSERIAL PK
entry_id       BIGINT  NOT NULL   -- FK txn.prod_hrs(entry_id)
slot           TEXT    NOT NULL   -- the slit label (A/B/C…)
reading_time   TIME/timestamptz NOT NULL   -- plant clock at capture
thk_mm         NUMERIC NULL       -- single thickness value (nullable if this row is a taper-only reading)
taper          TEXT    NULL       -- taper value (nullable if thickness-only)
created_at     timestamptz default now()
tenant_id      …                  -- match existing multi-tenancy pattern
INDEX (entry_id, slot, reading_time)
```
A reading row may carry thickness, taper, or both (if measured together). **[dev-decision]** thickness & taper as one row when co-measured vs always separate rows — recommend allow both nullable so the UI can add either independently.

**`txn.prod_hrs_width_reading`** — mother actual-width readings.
```
reading_id       BIGSERIAL PK
entry_id         BIGINT NOT NULL  -- FK txn.prod_hrs(entry_id)
reading_time     TIME/timestamptz NOT NULL
actual_width_mm  NUMERIC NOT NULL
created_at       timestamptz default now()
tenant_id        …
INDEX (entry_id, reading_time)
```

### 2.2 Denormalized "latest" (for quick read: quality + export + journey)
- `txn.prod_hrs_slit`: **add** `thk_latest_mm NUMERIC NULL`, `taper_latest TEXT NULL` — written = the most-recent reading's value on submit.
- `txn.prod_hrs`: **reuse** `actual_width_mm` as the **latest mother width reading** (already exists; now fed from the readings' latest).
- **Deprecate** `thk_id_mm, thk_centre_mm, thk_od_mm` — keep nullable, stop writing (retire later). `width_mm`/`target_width_mm` stay as the plan target (auto).

### 2.3 What the operator no longer keys (per decisions)
Per the answers, the per-slit **Actual Width** and **Actual Weight** single inputs are **removed** from the operator form (width is auto from the plan; child-coil weighing was not requested). **Open item:** production total / mass-balance previously summed per-slit actual weight — with actual weights gone, the pass produced-total falls back to the plan's per-slit `planned_weight_mt` (≈ mother weight). If actual child weighing is later required, re-add `actual_weight_mt` as its own (optionally multi-) reading. Flag to the plant. **[dev-decision]**

**Migration checklist:** create the two reading tables; add `thk_latest_mm`, `taper_latest` to `prod_hrs_slit`; keep triple columns nullable; follow existing migration numbering + the Windows/UTF-16 `.ts` caution.

---

## 3. Contract + validation (`packages/shared-validation`)
`types/processes.ts`:
- **`HRSSlitSlot`** — remove/deprecate `thkIdMm/thkCentreMm/thkOdMm` and the single `taper`; add:
  - `thicknessReadings?: { time: string; thkMm: number }[]`
  - `taperReadings?: { time: string; taper: string }[]`
  - `thkLatestMm?: number`, `taperLatest?: string` (derived, latest)
  - keep `targetWidthMm` (auto), `customer/route/hold/forCtl/childCoilNo/…`.
  - drop `actualWidthMm`, `actualWeightMt` from the operator path (leave optional/back-compat).
- **`HRSEntry`** — add `motherWidthReadings?: { time: string; widthMm: number }[]`; keep `actualWidthMm` (= latest mother width).

`rules/m1Forms.ts` (`hrsSlitSlotSchema`, `hrsSchema`) + `rules/fieldRules.ts` (`HRSSlitSlotSchema`): reflect the arrays; drop the triple; keep the `.max(12)` slit cap and route hard-gate.

---

## 4. Server (`ProductionService.saveHrs` + consumer)
`saveHrs` (same transaction):
1. Insert the pass header (`prod_hrs`) as today; set `actual_width_mm` = **latest** of `motherWidthReadings` (or null).
2. Insert each slit into `prod_hrs_slit`; set `thk_latest_mm` / `taper_latest` = latest of that slit's reading arrays; stop writing `thk_id/centre/od_mm`.
3. **Insert reading rows**: for each slit, one `prod_hrs_slit_reading` per thickness/taper reading; for the mother, one `prod_hrs_width_reading` per width reading.
4. Emit `production.captured` as today.

`JourneyAdvanceConsumer.spawnChildCoils` — change the child-coil thickness source from `slit.thk_id_mm ?? …` to **`slit.thk_latest_mm ?? slit.thk_mm`**. Everything else (mint, route, hold, idempotency) unchanged.

Quality (`SpecFetchService`/`qc_measurement`, if a spec attaches at HRS): evaluate against the **latest** thickness/width — not the retired triple.

---

## 5. Client — `HrsSlitBuilder.tsx`
**Mother section (top):**
- **Mother-coil pick is the entry point** — selecting a mother loads its slit lines (already via `prefill.orderLines`); ensure the flow is "pick mother → auto-fill", not manual add.
- Display (read-only, from plan): **Grade, RM Width (planned), Mother Coil Weight, RM Thickness**, and **Customer(s)** — render the *distinct set* of slit customers (one mother may list several, e.g. Micro Precision / A.V. Industries / Havells).
- **Actual Mother Width — readings list:** show planned RM Width beside it; an **"Add width reading"** control appends `{time = now (editable), widthMm}`; show the list + the **latest** prominently.

**Per-slit card (one per A/B/C…, auto from plan):**
- Read-only: **Slit Width** (target from plan/combination), Customer, Route (auto; still the submit hard-gate), Finish Thk, Batch, Child Coil `<mother>-<slot>`.
- **Thickness — readings list:** "Add thickness reading" appends `{time, thkMm}` (single value). Show readings + latest.
- **Taper — readings list:** "Add taper reading" appends `{time, taper}`. Show readings + latest.
- **Remove** the current single inputs: Actual Width, Actual Weight, Thk ID / Centre / OD, single Taper.
- Keep hold / for-CTL toggles (auto from route).

**Submit payload:** send `motherWidthReadings[]`, and per slit `thicknessReadings[]` + `taperReadings[]` (plus existing slot/route/flags/childCoilNo). Keep the route hard-gate ("Route required for slit X").

UX niceties **[dev-decision]:** reading rows sortable by time; default time = plant clock; optional advisory highlight if a thickness reading is outside a fetched spec tolerance (latest drives the HOLD).

---

## 6. Build order
1. **Migration** — reading tables + `thk_latest_mm`/`taper_latest`; keep triple nullable.
2. **Contract/schema** — arrays + latest; drop triple from the active path.
3. **`saveHrs`** — insert readings, compute + store latest; **consumer** reads `thk_latest_mm`.
4. **`HrsSlitBuilder`** — mother-pick display, mother-width readings, per-slit thickness/taper reading lists; remove retired inputs.
5. **Quality/export** — point at latest; DPR/line-log shows latest (+ optionally the reading series).
6. **Regression** — fan-out/child-mint/journey tests still green with latest-thickness source.

## 7. Dependencies / open items
- **Import gap (blocking for true auto-populate):** the HRS PPC sheet has **no importer** (no `HRS` sheet type/parser; the CRM importer is gated to 6HI/4HI/2HI). Auto-fill works today only off **seeded** `ppc_batch` rows. To go live, build an HRS sheet parser (headers → `ppc_batch`, group by Mother Coil, map `Act. Process Route`→`process_route_raw`, `Width`→per-slit `width_mm`, `Coil Weight`→`ppc_weight_mt`, `M. Coil Weight`→mother weight, `Fin. Surface`→`roll_finish`, tolerances). Separate workstream.
- **Child-coil weight** — not captured per current decisions; production total defaults to plan weight. Confirm with plant whether actual weighing is needed (would add a weight reading).
- **Reading co-capture** — thickness & taper as one timestamped row vs independent rows.
- **DPR/export** — does the daily report need the full reading series or just the latest? (default: latest, series available for trace).

## 8. Acceptance
- Operator picks only a mother coil; slits A/B/C auto-fill (width, customer, route, batch) from the plan; multiple customers render distinctly.
- Thickness and taper each accept **multiple timestamped readings** per slit; mother **actual width** accepts multiple readings against the planned width; all persist to the reading tables and round-trip.
- The **latest** reading is what lands on the child-coil record / quality / export; earlier readings retained.
- Child coils still mint `<mother>-<slot>` and spawn journeys from the per-slit route; `PPC HOLD` line mints but doesn't advance.
- Retired ID/Centre/OD inputs are gone; old columns remain nullable (no data loss); builds green (UTF-16 caution).
