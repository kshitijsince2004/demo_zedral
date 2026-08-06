# PKL Import — Per-Batch Unit & Batch-Keyed Order — Implementation Plan

**Date:** 2026-08-03
**Line:** PKL (Pickling)
**Depends on:** HRS pass **Phase C** (journey batch-keying) landing first — PKL reuses it.
**Status:** approved requirements → implementation plan.

---

## 0. Confirmed decisions

- **Unit = each plan row (batch).** Every pickling batch imports on its own.
- **Dedup = batch number only.** Two rows with the same coil + slit + width but **different batch numbers are both kept** (real, separate jobs). PKL must **never** use HRS's `coil+slit+width` key.
- **Re-key PKL to the batch in TWO places:** the **journey** (shared Phase C) **and** the **pickling order** (`txn.pkl_order` / `PklOrderService`, today keyed by mother `coil_no`).
- **Display:** mother coil + slit ID as the primary label; batch number as detail.
- **Summary/subtotal rows:** left **as-is** — they remain non-importable (fail required-field validation) and simply don't import. No special skip.
- **Timing:** a **separate pass after HRS**.

---

## 1. Current state (verified)

- **Parser** `pklPlanXlsxParser.ts` (config over `linePlanXlsxCore.ts`): own column map, **no finish thickness** (`ppc_thk := input_thk`), signature `first anl tmp` (fallback PV-Desc `PICKL`), captures `slit id` and extras (`First ANL TMP`, `First SOAK TIME`) → `rawExtras`. **Correct.**
- **In-file dedup** `dedupKeyForRow(row, lineScope)` returns **`batchNumber`** for PKL (only HRS uses `coil|slit|width`). **Correct — no false collapse.**
- **Journey classification** `classifyJourneyForLine(trx, coil_no, 'PKL')` is **coil-keyed** → 2nd+ batch of a mother coil returns `already-in-line` → **skipped**.
- **Pickling order** `PklOrderService.ensureOrder(coilNo)` (commit ~L1343) — header: *"keyed by mother coil_no — single line, no order-lines."* Inserts **one `txn.pkl_order` per mother coil**.
- **Real file** `PICKLING 21.07.2026 B.XLSX`: 19 batches / 10 mother coils; coils with 5/4/3 batches; slit IDs A/B/C; identical-spec repeats (two 556 mm slit-A batches); 11 summary rows; 3 plan dates.

**Consequence:** the coil-keyed journey **and** coil-keyed `pkl_order` collapse multi-batch coils → ~**9 of 19** batches dropped as false duplicates.

---

## 2. Target behavior

Each PKL plan row imports as its own batch; a mother coil with 5 batches yields 5 pickling units. The journey and the `pkl_order` both key on the batch. Operators see mother coil + slit ID (batch as detail). Summary rows stay non-importable. Identical-spec repeats with distinct batch numbers both import.

---

## 3. Implementation (phased)

### PKL-1 — Confirm parser + capture (light)
No column changes. Verify `slitId` is captured for display and `First ANL TMP` / `First SOAK TIME` land in `rawExtras` (next-stage setpoints). Confirm summary rows fail required-field validation (batch/coil/width missing) and therefore don't import — matches "as-is".

### PKL-2 — Batch-key the pickling order (core)
Move `pkl_order` off the mother coil onto the batch:
- **Migration (additive):** add `txn.pkl_order.batch_id BIGINT REFERENCES planning.ppc_batch(batch_id)` (+ `slit_id VARCHAR(8)` for display); backfill `batch_id` for existing rows from the coil's active PKL journey step `queue_batch_id`; move the "one active per…" uniqueness from `coil_no` → **`batch_id`** (partial unique WHERE active/open). Keep `coil_no` + `mother_coil_no` as **display attributes**. `IF NOT EXISTS`, working `down`, pre-dedupe.
- **Service:** `PklOrderService.ensureOrder(batchId /*or batchNumber*/, userId)` — look up / create by **batch**, not coil. Keep `coil_no`, `mother_coil_no`, `slit_id` populated for display. The reads (`getOrder`, queue/live views) resolve by batch, group/label by mother coil + slit.
- **Caller:** commit branch `if (lineScope === 'PKL' …)` passes the row's **batch** to `ensureOrder`.

### PKL-3 — Wire PKL through the batch-keyed journey (shared)
Once Phase C makes `classifyJourneyForLine` / the journey batch-keyed, PKL commit flows through it by **batch** — so every batch of a mother coil is classified independently (`new`), not `already-in-line`. Verify no PKL path still passes `coil_no` as the dedup key.

### PKL-4 — UI (mother coil + slit ID)
PKL preview and queues/live show **mother coil + slit ID** as the primary label, batch number as secondary. Group the preview by mother coil where helpful (e.g. "Coil 1100038675 — 5 batches: A×2, B×2, C").

### PKL-5 — Tests (real file as fixture)
- All **19 batches import** — coils with 5/4/3 batches keep every batch (no `already-in-line` drops).
- Identical-spec repeats (two 556 mm slit-A) **both import**.
- Summary rows **don't import** (non-importable, no crash).
- 3 plan dates → per-row dates preserved.
- One mother coil → multiple `pkl_order` rows (one per batch), each labelled mother coil + slit ID.

---

## 4. Files touched
`packages/server/src/services/PklOrderService.ts` (batch-key ensureOrder + reads) · `services/PPCImportService.ts` (PKL commit passes batch) · `migrations/…_pkl_order_batch_key.js` · PKL queue/live/preview views in `packages/client/src` (label = coil + slit) · `packages/server/tests/pklBatchImport.test.ts`.

---

## 5. Sequencing & effort
| Step | Item | Est |
|---|---|:--:|
| PKL-1 | Parser confirm | 0.25d |
| PKL-2 | pkl_order batch-key + migration + backfill | 1.5d |
| PKL-3 | Wire through batch-keyed journey | 0.5d |
| PKL-4 | UI coil + slit label | 0.75d |
| PKL-5 | Tests vs real file | 0.5d |

**≈ 3.5 days**, and **must follow HRS Phase C** (journey batch-keying migration).

---

## 6. Risk / blast radius
- **PKL-2** changes `pkl_order` identity — touches the pickling order lifecycle (create/read/queue/live). **Medium.** Guardrails: additive migration + backfill from the active journey step; keep `coil_no`/`mother_coil_no` for display; regression the PKL start/stop/complete flow.
- **PKL-3/4** ride on Phase C + display only. **Low.**
- **Not touched:** HRS, ANN, RWD, CRM rolling; the PKL parser (already correct).

---

## 7. Open items (flag to override)
1. **Child-coil identity:** `pkl_order.coil_no` currently references a physical coil. Per-batch keying — keep `coil_no` = mother (display) with batch as the real key, or mint a child coil (`mother-slit`) per batch? Recommend **keep mother coil for display, key on batch** (no new coil rows at import).
2. **Downstream link:** PKL batch number = the SAP batch that an HRS slit maps to → link `ppc_hrs_slit.downstream_batch_number` ↔ PKL `batch_number` when both exist (future cross-line mapping).
3. **Summary-row cleanup:** left as-is now; revisit if the operator finds the non-importable rows noisy.

---

## 8. Definition of done
Every PKL plan row imports as its own batch (multi-batch mother coils no longer collapse); `pkl_order` and the journey are batch-keyed; identical-spec repeats both import; summary rows stay non-importable without error noise; PKL screens show mother coil + slit ID; the real PKL file passes as a fixture with all 19 batches; PKL start/stop/complete regressions green.
