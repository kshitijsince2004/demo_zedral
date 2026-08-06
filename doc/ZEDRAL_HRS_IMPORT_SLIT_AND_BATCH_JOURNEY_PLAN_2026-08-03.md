# HRS Import — Slit-Aware Dedup, Slit Capture & Batch-Keyed Journey — Implementation Plan

**Date:** 2026-08-03
**Line:** HRS (journey batch-keying is plant-wide, benefits PKL/ANN/RWD too)
**Status:** approved requirements → implementation plan.

---

## 0. Confirmed decisions

- **Unit:** one HRS order (one `ppc_batch`) per **mother coil**.
- **Layer-1 dedup key:** mother coil + slit ID + width. Exact repeat → **keep first**, drop the rest (silent).
- **Slit identity:** Slit ID; when blank → **position in the HRS Combination**.
- **HRS Combination defines the slit set** (count / order / widths); the rows fill in each slit's details.
- **Re-import → merge:** add new slits, update changed ones, keep untouched ones (union — nothing lost).
- **Storage:** dedicated **plan-slit table** (mirroring `txn.prod_hrs_slit`), keyed to the HRS batch.
- **Per-slit fields:** slit ID, position, width, weight, finish thickness, route, SAP/item no, customer.
- **Downstream:** child batch numbers are **SAP-provided later**; capture slits now, link by **SAP order number** when the next line's plan arrives.
- **Scope = both:** slit work **and** the batch-keyed journey change in this pass.
- **Journey key = `batch_id`** (surrogate); batch number + mother coil + slit ID shown to users.
- **Migration additive:** add batch ref to `order_journey`, backfill active journeys, then move the active-unique index coil → batch.

---

## 1. Current state (verified)

- **HRS parser** `hrsPlanXlsxParser.ts` (config over `linePlanXlsxCore.ts`) — parses one row per slit; no dedup; maps `slit id → slitId`, keeps `HRS Combination` in `rawExtras`.
- **Layer-1 in-file dedup keyed on `batch_number`, keep-first** — runs in `previewRollingXlsx` (~L941–952, `duplicate-skipped`) and `commitRollingSession` Phase 1 (~L1220–1232). HRS slits share `batch_number` (= mother coil) → **slits B/C dropped** (6/10 rows on the real file).
- **`ppc_batch.batch_number` is `NOT NULL UNIQUE`** — so slits cannot each be their own batch; HRS must be one batch + a slit table.
- **Journey is coil-keyed** — `order_journey.coil_no`, partial UNIQUE `ux_order_journey_active_coil (coil_no) WHERE ACTIVE`; each `order_journey_step` holds one `queue_batch_id`. No batch column on the journey. `classifyJourneyForLine(coilNo, processCode)`.
- **Slit fan-out exists at production** — `txn.prod_hrs_slit`, `childCoilNo(mother, slot)`, child journeys in `JourneyAdvanceConsumer`.

---

## 2. Target behavior (HRS)

On HRS import, rows sharing a mother coil collapse into **one** `ppc_batch`; every distinct slit (by slit ID / combination position + width) becomes a row in the new **`planning.ppc_hrs_slit`** table. Re-importing merges the slit set. The mother coil's journey is keyed on its `batch_id`. Preview and queues show **mother coil + slit ID**. PKL/ANN/RWD, now batch-keyed, stop dropping their legitimate multi-batch-per-coil rows.

---

## 3. Implementation (phased)

### Phase A — HRS parser: slit extraction
In `hrsPlanXlsxParser.ts` / a small HRS post-step:
- Parse the **HRS Combination** string (e.g. `483.000+483.000+536.000`) into an ordered slit set `[{slitNo, width}]` — this **defines the slit set**.
- For each imported row, resolve its slit: by **Slit ID** if present, else by **position** in the combination (match the row's `Width` to the combination slot, disambiguating equal widths by order).
- Emit, per mother coil, one grouped record: coil-level fields + `slits: [{ slitNo, slitLabel, widthMm, weightMt, finishThkMm, route, sapOrderNo, itemNo, customerName }]`.
- Row-level `errors` if a row's width isn't in the combination or the combination is missing.

### Phase B — slit-aware dedup + plan-slit table
- **New table** `planning.ppc_hrs_slit` (migration): `slit_pk BIGSERIAL PK`, `batch_id BIGINT REFERENCES planning.ppc_batch(batch_id) ON DELETE CASCADE`, `slit_no SMALLINT`, `slit_label VARCHAR(8)`, `width_mm NUMERIC`, `weight_mt NUMERIC`, `finish_thk_mm NUMERIC`, `process_route_raw VARCHAR(60)`, `sap_order_no VARCHAR(30)`, `item_no VARCHAR(20)`, `customer_name VARCHAR(120)`, `child_coil_no VARCHAR(30)`, `downstream_batch_number VARCHAR(30) NULL`, `UNIQUE (batch_id, slit_no)`.
- **Scope-aware Layer-1 dedup:** add `dedupKey(row, lineScope)` → `batch_number` normally, `coil|slit|width` for HRS. Apply in both the preview and commit dedup loops so exact-repeat slits keep-first; genuine slits are **not** dropped.
- **Commit grouping:** for HRS scope, group parsed rows by mother coil → **one** `ppc_batch` upsert (aggregate coil-level fields) + upsert each slit into `ppc_hrs_slit`.
- **Merge-on-reimport:** upsert slits by `(batch_id, slit_no)` — insert new, update changed, leave others; never delete on re-import.
- Set `child_coil_no = childCoilNo(motherCoil, slitLabel)` for the downstream link; leave `downstream_batch_number` null until the SAP plan arrives.

### Phase C — journey batch-keying + migration
- **Migration (additive):** add `order_journey.batch_id BIGINT REFERENCES planning.ppc_batch(batch_id)` and `slit_id VARCHAR(8) NULL` (display). Backfill `batch_id` for existing ACTIVE journeys (from the journey's active step `queue_batch_id`, else the `ppc_batch` matching `coil_no`); pre-dedupe, then **add** `ux_order_journey_active_batch (batch_id) WHERE status='ACTIVE'` and **drop** `ux_order_journey_active_coil` (keep `coil_no` column + index for display/query). Build `CONCURRENTLY`, `IF NOT EXISTS`, working `down`.
- **Re-key services:** `createJourney`, `linkBatchToJourney`, `classifyJourneyForLine`, `advanceJourney`, `QueueTransferService.enqueueNextStep`, `queue_handoff` → resolve/guard by **batch_id** (keep coil_no + slit_id as attributes). PKL/ANN/RWD then import every batch (no coil collapse); HRS = one journey per mother-coil batch.
- **Fan-out alignment:** HRS-completion child journeys (per slit) key on the child batch (from `ppc_hrs_slit.child_coil_no` / SAP), reusing existing `childCoilNo` machinery.

### Phase D — UI (mother coil + slit ID)
- **Preview:** group HRS rows under the mother coil; show its slit list + counts (e.g. "Coil 1100038447 — 3 slits: A 498 / B 375 / C 432").
- **Queues/lists:** primary label = **mother coil + slit ID**; batch number as secondary detail. `PpcRollingImportPanel` skip/counter classes unchanged.

### Phase E — tests (the 3 real files as fixtures)
- HRS: `hrs 21.07.2026 B.XLSX` → 4 mother-coil batches, **10 slit rows captured** (no drops); coil `1100038447` → 3 slits A/B/C.
- HRS re-import merge: re-run → slit set unchanged, changed slit updated, none lost.
- Dedup: exact-duplicate slit → kept once.
- Journey batch-keying: PKL (`PICKLING…`) and ANN (`ANNE…`) → every batch imports (no false `already-in-line`); busiest ANN coil keeps all 7 batches.
- Backward-move / advance guards still green.

---

## 4. Files touched
`packages/server/src/utils/hrsPlanXlsxParser.ts` (+ maybe a small `hrsSlitExtract.ts`) · `linePlanXlsxCore.ts` (grouped output hook) · `services/PPCImportService.ts` (scope-aware dedup, HRS grouping, slit upsert, preview grouping) · `services/ProcessRouteService.ts` + `QueueTransferService.ts` (batch-keying) · `migrations/…_ppc_hrs_slit.js` · `migrations/…_order_journey_batch_key.js` · `packages/client/src/components/admin/PpcRollingImportPanel.tsx` + queue/list views · `packages/server/tests/hrsSlitImport.test.ts`, `journeyBatchKey.test.ts`.

---

## 5. Sequencing & effort
| Phase | Item | Est |
|---|---|:--:|
| A | HRS parser slit extraction | 1.0d |
| B | plan-slit table + scope-aware dedup + grouping + merge | 1.5d |
| C | journey batch-keying + migration + backfill | 2.5d |
| D | UI coil+slit display | 1.0d |
| E | tests vs real files | 1.0d |

**≈ 7 days.** A + B are self-contained and reversible (ship first). **C is the high-risk, cross-cutting piece** — land behind the tests in E and the migration guardrails.

---

## 6. Risk / blast radius
- **A/B (HRS-local):** contained to HRS parse + import commit + one new table. No other line affected. **Low.**
- **C (journey batch-keying):** the whole line-to-line engine re-keys coil → batch — touches create/link/classify/advance/enqueue/handoff + a migration on `order_journey`. **High/cross-cutting.** Guardrails: additive migration with pre-dedupe + backfill + `CONCURRENTLY`/`IF NOT EXISTS`/working `down`; keep `coil_no` for display; regression tests for advance/handoff; fail-closed classification. This is also the change that *fixes* PKL/ANN's dropped batches, so it pays for itself.
- **D:** display only. **Low.**

---

## 7. Open items / assumptions (flag to override)
1. Journey key = `batch_id` surrogate (assumed).
2. Active-journey backfill source = active step's `queue_batch_id`, else `ppc_batch` by coil (assumed) — needs a quick prod data audit before the index move.
3. Plan-slit → downstream link by **SAP order number** (assumed); `child_coil_no` stored as a secondary match.
4. `CRS Combination` column handling (a further downstream slitting) — out of scope here; captured to `rawExtras` for now.

---

## 8. Definition of done
HRS imports one unit per mother coil with **all** slits captured in `ppc_hrs_slit` (no B/C loss), merge-safe on re-import; the journey is batch-keyed so PKL/ANN/RWD import every legitimate batch; preview/queues show mother coil + slit ID; the three real files pass as fixtures with expected counts; advance/handoff regressions green; `npm run test -w @m1/server` + `arch:check` pass.
