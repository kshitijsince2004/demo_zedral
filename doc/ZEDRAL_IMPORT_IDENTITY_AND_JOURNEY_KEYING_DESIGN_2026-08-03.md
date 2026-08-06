# Import Identity & Journey Keying — Design Note

**Date:** 2026-08-03
**Lines:** HRS · PKL · ANN · RWD
**Status:** design note (agreed decisions below) — precedes implementation.
**Why:** the real plan files proved the import identity model is wrong. The journey/dedup key on **mother coil**, but the plans carry many batches/slits per mother coil, so 45–60% of rows are dropped as false duplicates.

---

## 1. Decisions (confirmed)

1. **The journey is keyed on BATCH, always** — for every line. Internally the traveling unit is the plan **batch**, not the mother coil.
2. **The user-facing display shows MOTHER COIL + SLIT ID** as the primary label (batch is the internal key).
3. **Per-line unit of work:**
   - **HRS → mother coil.** One HRS order per mother coil; its slit rows are one slitting job. **But every slit's detail (slit ID + width) must be captured** — each slit maps downstream to its own batch/order.
   - **PKL / ANN / RWD → each plan row (batch number).** Many batches per mother coil are legitimate and must all import.
4. **A single import file may span many plan dates** (this ANN file has 7). Use **each row's own Plan Date** (already the behaviour); fix only the preview header to show the range.

---

## 2. Current state (verified in schema + code)

- `planning.order_journey` is **coil-keyed**: `coil_no NOT NULL REFERENCES coil.coil`, partial UNIQUE `ux_order_journey_active_coil (coil_no) WHERE status='ACTIVE'`. **No batch column on the journey.**
- `planning.order_journey_step` holds one `queue_batch_id → ppc_batch(batch_id)` per step. So a line-step can point at **exactly one** batch.
- `planning.ppc_batch.batch_number` is **NOT NULL UNIQUE**.
- Dedup: `classifyJourneyForLine(coilNo, processCode)` + keep-first-by-`batch_number`.
- **Slit fan-out already exists at production time:** `txn.prod_hrs_slit` / `txn.prod_crs_slit`, `childCoilNo(motherCoilNo, slot)` derives a child coil per slit, and `JourneyAdvanceConsumer` spawns **child journeys** per slit.

**Consequences on the real files (measured):**
| Line | Real shape | Current result |
|---|---|---|
| HRS | 10 slit rows / 4 mother coils; slits A/B/C **share** batch_number (= coil) | keep-first-by-batch drops **6/10** slit rows |
| PKL | 19 batches / 10 mother coils (batch ≠ coil) | coil-keyed skip drops ~**9/19** |
| ANN | 157 batches / 70 mother coils; 44 coils multi-batch | coil-keyed skip drops ~**87/157 (55%)** (+ Height=0 rows) |

Root cause: **journey/dedup keyed on mother coil; the real unit is the batch (HRS: the mother-coil slitting job with per-slit detail).**

---

## 3. Target model

### 3.1 Journey keyed on batch
Re-key the journey engine on the **batch** (the `ppc_batch`), with `coil_no` + `slit_id` retained as **display attributes**, not the identity.
- Add a batch reference to `order_journey` (e.g. `batch_id`/`batch_number`) and move the active-unique constraint onto the batch identity; keep `coil_no`, add `slit_id` for display/grouping.
- `createJourney`, `linkBatchToJourney`, `classifyJourneyForLine`, `advanceJourney`, `QueueTransferService.enqueueNextStep`, and `queue_handoff` all re-key from coil → batch.
- Because `ppc_batch.batch_number` is already unique, batch-keyed dedup is naturally correct: each plan row = one batch = one journey; the `already-in-line` skip fires only when **that batch** is already present, never because a *sibling batch of the same coil* exists.

### 3.2 HRS — mother coil unit, per-slit capture
- One `ppc_batch` + one journey per **mother coil** (HRS `batch_number` = mother coil, unique — so the slit rows can't be separate batches).
- Capture the plan's slit breakdown in a **plan-side slit table** (mirror `prod_hrs_slit`): one row per slit (`slit_id`, `width_mm`, order/route), tied to the HRS batch. This is the data that "maps further to the batch numbers and their respective orders" downstream.
- Fold the slit rows (A/B/C) into that one HRS unit instead of dropping B/C.
- Downstream, each slit fans out to its own child batch/coil (reuse the existing `childCoilNo` / child-journey machinery), inheriting the captured plan-slit detail.

### 3.3 PKL / ANN / RWD — per-batch unit
- Each plan row → its own `ppc_batch` + journey. No coil-based collapse.
- Many batches per mother coil coexist because each is its own batch-keyed journey.

### 3.4 Display
- Lists/queues show **mother coil + slit ID** as the primary label, with the batch number available as detail. No functional dependence on the display fields.

### 3.5 Plan dates
- Keep per-row `plan_date` writes (correct today). Update the **preview header** to show the min–max date range (and shifts) for a multi-date file instead of only the first row's date.

---

## 4. Blast radius & sequencing

This is the **one genuinely cross-cutting change** — the journey engine is coil-keyed throughout, so re-keying it on batch touches creation, link, advance, enqueue, handoff, dedup, and one migration. Phase it:

| Phase | Scope | Risk |
|---|---|:--:|
| **P0** | Parser fixes that don't need re-keying: ANN `Height=0` carry-forward, skip blank spacer rows, preview date-range header | Low |
| **P1** | HRS plan-slit capture table + parser fold (stop dropping B/C); no journey change yet | Low–Med |
| **P2** | Journey **batch-keying**: migration (add batch ref, move active-unique to batch, keep coil_no + add slit_id), re-key `createJourney`/`linkBatchToJourney`/`classifyJourneyForLine` | **High (cross-cutting)** |
| **P3** | Re-key advance/enqueue/handoff to batch; align child-journey fan-out for HRS slits | Med–High |
| **P4** | UI: primary label = mother coil + slit ID across queues/lists; batch as detail | Low |

Recommended: ship **P0** immediately (recovers the ANN rows + cleans preview), then **P1**, then do **P2/P3** together behind tests since they change the order lifecycle.

---

## 5. Open questions before P2/P3

1. **Batch-key identity:** journey keyed on `batch_number` (string, human) or `batch_id` (surrogate)? Recommend `batch_id` FK, with `batch_number` shown.
2. **HRS slit → downstream batch numbering:** how are child batch numbers assigned per slit (existing `childCoilNo` derives child *coil*; do child *batch numbers* come from SAP/PPC or are they generated)?
3. **Existing active journeys:** migration must preserve in-flight coil-keyed journeys (one-time backfill of batch refs) — needs a data audit before the unique-index move.
4. **RWD:** confirmed per-batch like PKL/ANN? (RWD already has its own parser; assuming yes.)

---

## 6. Definition of done
Journey/dedup keyed on batch; PKL/ANN/RWD import every batch even when they share a mother coil (no false-duplicate drops); HRS imports one unit per mother coil with all slit details captured for downstream mapping; multi-date files import per-row dates with an accurate preview header; queues/lists show mother coil + slit ID. The three real files import with expected row counts and no data loss.
