# ZEDRAL — CR Slitter (CRS) Operator · Implementation Plan

**Hero Steels Limited · Cold Rolling Plant · M1 Data Collection**
**Audience:** developers / IDE agent. This is a *logic + data + architecture* plan — **no UI/visual design**. It names the modules that must be touched or created, but does **not** enumerate every file; where a rule can reasonably be a developer's call, it is marked **[dev-decision]**.

> Route position: `C` (seq 70) on the material spine `S→P→4|6→R→F→X|Y|Z→C→LE→PKG`.
> Extends the All-Process Operator work (`.kiro/specs/all-process-operator/`, `ZEDRAL_ALL_PROCESSES_OPERATOR_DESIGN_SPEC.md`). Consumes the Quality Spec-Sheet module (`ZedralV2.2_QUALITY_SPEC_SHEET_MODULE_SPEC.md`). Reuses the CRM (6HI/4HI/2HI) operator console.

---

## 0. Guiding principle — reuse the CRM shell, replace the body

CRS is **~80% a re-skin of the existing CRM operator console**, not a new subsystem. The station shell, live timers, action rail, stoppage sub-form, queue engine, order-assignment board, journey advance, and offline outbox all already exist for 6HI/4HI/2HI and are reused as-is or generalised. What is genuinely new is the **slit fan-out** (one input coil → many independently-measured output lines) and the **editable machine-capability envelope**.

Do not fork the CRM tree. Generalise the shared pieces into process-agnostic components and give CRS its own capture body.

---

## 1. Domain vocabulary (get these names right in code)

| Term | Meaning | Cardinality |
| --- | --- | --- |
| **Mother coil** | The input coil fed to the slitter (from the prior process). | 1 per pass |
| **Pass / Run** | One physical slitting setup on one machine. The **capture unit** — one run timer, one stoppage log, one crew. | 1 |
| **Order-line / Slit** | One customer order on that coil = `finish_width × no_of_slit` strips, with its own SAP batch number and route. The **traceability + routing + quality-entry unit**. | 1..N per pass (seen up to 5) |
| **Child coil** | A physical output coil, numbered `<motherCoilNo>-<slitId>` (slit id derived, never free-typed). | 1..N per line |

**Critical distinction from CRM.** In CRM a "combined order" collapses N orders into *one* shared coil and one weight that is then *allocated* back out (`combinedWeightAllocation`). **CRS is the opposite:** the N order-lines of a pass are physically separate coils, **each with its own full entry** — own actual width, front/rear thickness, surface quality, output weight, and rejection. Nothing is allocated; the pass total is the **sum** of independently weighed lines. Model CRS on the **HRS slit-builder** (per-slot child entries), not the CRM combined form.

The PPC plan encodes a pass as a **mother-coil group** (the yellow subtotal-separated block in the plan file). The column literally named `Batch Number` is the **per-line SAP batch**, not the pass — keep the two concepts strictly separate in naming (`passId`/`runId` vs `sapBatchNumber`).

---

## 2. Data model

Reuse the existing contracts `CRSEntry` + `CRSSlitSlot[]` (`packages/shared-validation`, `txn.prod_crs` + `txn.prod_crs_slit`) as the base; extend so a slit slot carries a **complete per-line record**, not just dimensions.

**Pass header — `txn.prod_crs` (one per mother-coil pass):**
mother coil no, machine code, input weight (from prior process), shift, plant date, prod start/end, net runtime, setting count, crew ref, pass-level remark, status.

**Per-line entry — `txn.prod_crs_slit` (one per order-line / child coil):**
slit no *(operator-keyed, see §5.4)*, derived child coil no, sale order + item, SAP batch number, customer, finish width, no. of slit, **actual width**, **front thk**, **rear thk**, **output weight**, scrap, **rejection OD**, **rejection ID**, hold flag, **for-CTL flag**, resolved route, and a reference to its quality measurement (§6).

**Quality split (important):** mechanical/metallurgical/chemical results (hardness, UTS, YS, elongation, ECV, grain) are properties of the annealed mother coil → they are **the same across all children** and live at (or are inherited to) the pass level. Only **dimensional/surface** values (actual width, front/rear thk, camber, waviness, burr, Ra/Rz) plus weight/rejection/route are truly per-line.

**Machine envelope — `master.machine` + new `master.machine_spec` (versioned):**
per CRS machine (CRS1–CRS6): width band, strip-thickness band, mandrel **ID set** (discrete, e.g. `{400,500,600}`), coil-weight min/max, exit OD, line/threading speed, cutter/arbor diameter, air mode. **Editable + versioned** (REV number, immutable once active, history retained). This is master data owned by the CRS machine head — **not** hardcoded from the 2018 sheet.

**Migrations required** (describe intent, let the developer write DDL): extend `prod_crs_slit` with the per-line quality/weight/rejection/route/hold/for-CTL columns if absent; add `master.machine_spec` (versioned); add any pass-level setting-count / crew columns. Follow the existing migration numbering + the Windows/UTF-16 edit caution (`zedral-windows-utf16-editing`).

---

## 3. Machine assignment & eligibility

Reuse the CRM order-assignment board (`/6hi/order-assignment` + `OrderAssignmentPanel` + `MachineAllocationModal`); generalise the endpoint to be process-agnostic (CRS board).

**Suggested machine.** `suggestedMachine` = the plan's `Prod. Version` (CRS1–6) as the primary hint, validated against the envelope. Operator is bound to one machine (`machineAccess`); the machine head can transfer between machines (audit-logged, as CRM already does).

**Eligibility function** `isEligible(order, machineSpec)` — two tiers:

- **Hard gate — mandrel ID.** The order's required inner diameter must be in the machine's ID set (e.g. ID 600 → CRS2 only; CRS3 is 500-only). Block ineligible.
- **Soft warn — width / thickness / coil-weight / exit-OD.** Out-of-band is **allowed with an override reason**, never blocked. (The live plan runs coils well outside the 2018 ratings; treat the envelope as advisory.)

The envelope only *suggests and warns*; it is never authoritative. Missing/blank envelope → no constraint, not an error.

**[dev-decision]** exact soft-warn thresholds and whether coil-weight `min` demotes small orders off big lines.

---

## 4. Queue & journey fan-out

**Queue** is machine-scoped and fed by (a) the PPC plan and (b) upstream journey completions (`planning.order_journey`). Reuse the CRM queue engine and status filters (Pending / Preparing / In Progress / Hold / Completed).

**One queue card = one pass** = a mother coil plus its order-lines (group the plan rows by mother coil — the yellow-row grouping). The card exposes the line count and the packed combination.

**Fan-out on submit (the core loop).** When a pass is submitted:

1. Server validates (width-combination + mass-balance + quality gate, §5).
2. For **each line independently**, advance its own `order_journey` by its own route code (§8): `…CZ` → PKG (ship as coil), `…CLE` → CTL. A pass may contain a mix.
3. Lines on **HOLD do not advance**; the rest of the pass proceeds.

Reuse the existing `JourneyAdvanceConsumer` pattern: subscribe to the already-emitted `production.captured` event; **per-line**, idempotent, try/catch, **never re-throw** (a throw would 500 a committed capture). CRS is already in the consumer's advance set — extend it to iterate the pass's lines rather than a single coil.

---

## 5. Capture workflow (logic)

Order of the capture, and where each field comes from. Autofill hierarchy: **Plan ▸ prior-process output ▸ coil master / spec ▸ manual** (only what physically changed).

### 5.1 Load
Operator's machine is bound → the pass loads from the plan: mother coil + input weight + all N order-lines pre-filled (finish widths, no. of slit, customer, route). Machine spec loads for reference. Quality spec fetched (§6).

### 5.2 Input weight
= prior process **output weight** (auto). Editable only on correction (flag the edit).

### 5.3 Width-combination validation
For the packed combination: `Σ(finish_width × no_of_slit) + edge_trim ≤ input_width`, and each `finish_width` within its `FIN_WIDTH_TOL` from the spec. Warn (not block) on trim outside expected band. **[dev-decision]** trim tolerance band.

### 5.4 Per-line entry (the fan-out body)
Each line is completed independently:
- **Slit No** — operator-keyed. It is **distinct** from the plan's `Slit ID` and from the combination; treat as a per-child-coil identifier the operator records. **[dev-decision]** exact semantics/format (physical coil serial vs sequence) — confirm with plant.
- **Actual width, front thk, rear thk** — manual (measured).
- **Output weight** — manual, per child coil.
- **Surface/shape quality** (camber, waviness, burr, Ra/Rz) — manual, per line.
- **Mechanical quality** (hardness, UTS, YS, elongation, ECV) — inherited from the spec/pass, **editable** (§6).
- **Rejection OD / ID, hold, for-CTL** — per line.

### 5.5 Weights & mass balance
Line output weights are entered per child; **pass total = Σ lines** (derived, not allocated). Validate `Σ line output + scrap + rejection ≈ input weight` — warn beyond tolerance. **[dev-decision]** tolerance.

### 5.6 Timing
Button-driven (reuse the action rail + `useNetProductionTimer`). **Start**/**End** stamp the times; **net runtime = wall − stoppage**; total auto-computed. Not PLC-driven — "auto start/stop" means auto-*stamped* on the operator's tap.

### 5.7 Stoppage / defect / crew
Reuse the shared sub-forms. Stoppage codes are DB-driven (`/6hi/master/stoppage-categories`) → **seed the CRS code list** (the 16 log-sheet codes, 01 Mechanical … 16 Setting Adjustment). Defects: per-CRS catalogue. **Crew capture does not exist in the client yet** — see §11/§12.

### 5.8 Quality gate & submit
A line goes **HOLD** if an inherited mechanical result fails spec **or** a measured dimension/surface value fails spec. Hold is **per line** (opposite of the CRM combined-hold rule — do not copy that). Passing lines still submit and advance. Missing spec → `NOT_EVALUATED`, never blocks submit.

---

## 6. Quality integration (QSS)

Consume the Quality Spec-Sheet module through its single read surface — `SpecFetchService.fetch(...)` / `GET /quality/fetch`.

- **On load:** fetch by the coil's identity (grade + material + surface finish + width + finish-thk + length + customer), groups `MECH / SURF / DIM_TOL`. Prefill the capture; values are **editable**.
- **On submit:** measured values → the coil-keyed `txn.qc_measurement`, validated against the fetched spec → pass/fail → drives the HOLD decision.
- **Version honesty:** snapshot the resolved spec version onto the pass so later spec edits don't retro-change a captured record.
- **Safety:** missing spec ⇒ `NOT_EVALUATED`; never 500 a capture on a spec miss.

The CRS-relevant spec parameters that also drive validation: `FIN_WIDTH_TOL` (each slit's finish width, §5.3) and `COIL_OD_MM` (output coil OD — jointly bounded with the machine's exit-OD envelope).

---

## 7. Machine-spec (envelope) CRUD

A machine-head-owned screen to author/edit `master.machine_spec` per CRS machine, versioned (DRAFT → ACTIVE → SUPERSEDED, immutable once active). Fields per §2. Seed once from the Annexure-IX sheet **but flag the seed as reference only** — in particular the CRS6 row is known to be wrong (the sheet rates it as the smallest line; the plant runs it as a large one). The envelope feeds §3 eligibility; it never hard-blocks except on mandrel ID.

**[dev-decision]** whether spec versioning reuses the QSS versioning primitives or a lighter machine-local version table.

---

## 8. Routing (per-line, plan-driven)

Routing is **not** an operator choice and **not** pass-level — it is decided per line by the route code carried on the plan:

- route tail `…C**Z**` → ship as coil → advance to `PKG`.
- route tail `…C**LE**` → For-CTL → advance to `CTL` queue.

For-CTL / Hold / Rejection are per-line allocations of the pass output. The journey engine reads each line's resolved route and advances it (§4). A CTL-bound line lands in the CTL queue, where CTL's own machine envelope (the CTL sheet: length/width/thickness/weight bands) selects the CTL machine — same eligibility function, different envelope table.

---

## 9. Dashboard / shift summary (metrics only — no layout here)

Reuse the shift-summary panel; replace the metric set with the CRS log-sheet footer:
**Total Production MT · For-CTL MT · Hold MT · Coil (ship) MT · Rejection OD/ID MT · No. of Settings · Scrap %.**

`No. of Settings` can be **derived**: increment whenever a pass's slit combination differs from the previous pass on that machine (a knife changeover). **[dev-decision]** "different" = exact-layout vs near-layout threshold; and whether settings count is auto or operator-confirmed.

---

## 10. Reuse map

| Concern | Reuse (CRM/existing) | CRS change |
| --- | --- | --- |
| Station shell / header / live timers | `SixHiLayout`, `ProductionHeader`, action rail | generalise to process-agnostic; single-process (no rolling/skin tabs) |
| Order → machine assignment | `/6hi/order-assignment`, `MachineAllocationModal` | eligibility = editable envelope; `suggestedMachine` = plan `Prod. Version` |
| Queue + journey | queue engine, `order_journey`, `JourneyAdvanceConsumer` | queue card = pass; advance **per line** |
| Timing | `useNetProductionTimer`, Start/End rail | none |
| Stoppage | stoppage modal + `/6hi/master/stoppage-categories` | seed CRS codes |
| Quality | `SpecFetchService`, `qc_measurement` (QSS) | fetch on load, per-line HOLD |
| Offline | operator sync outbox / IndexedDB | none |
| **Slit fan-out** | **HRS slit-builder pattern** | per-line entry grid (net-new for CRS body) |
| **Machine envelope CRUD** | — | net-new master + screen |
| **Crew capture** | — | net-new (also backfills CRM) |

---

## 11. Build order (dependency-ordered backlog)

1. **Migrations** — extend `prod_crs_slit` (per-line quality/weight/rejection/route/hold/for-CTL); add `master.machine_spec` (versioned); pass-level setting/crew columns.
2. **Machine-spec master + CRUD** (§7) — unblocks eligibility.
3. **Process-agnostic assignment board + eligibility** (§3).
4. **CRS queue binding** (§4) — pass grouping by mother coil.
5. **Capture body — slit fan-out** (§5), cloned from the HRS slit-builder: per-line entry, width-combination + mass-balance validation.
6. **Quality wiring** (§6) — spec fetch on load, `qc_measurement` on submit, per-line HOLD.
7. **Journey fan-out** (§4/§8) — per-line advance in the consumer.
8. **Stoppage/defect seed + crew capture** (§5.7) — crew is net-new.
9. **Shift dashboard metrics** (§9).
10. Retire `GenericCapturePage` for CRS.

Suggested first vertical slice: **queue → pass capture (single-line) → journey advance**, then add multi-line fan-out, then quality, then dashboard.

---

## 12. Left to the developer / open decisions

- **Crew capture** — build now for CRS (and retrofit CRM) or defer to v2. Only workflow item with zero existing scaffolding.
- **Slit No semantics** (§5.4) — confirm the exact identifier with the plant.
- **Run-sequencing / campaign** — whether the machine head reorders the machine queue to minimise knife changeovers in v1, or it's left as plain queue order.
- **Setting-count derivation** (§9) — exact-layout vs near-layout; auto vs confirmed.
- **Mass-balance & trim tolerances** (§5.3, §5.5).
- **Eligibility soft thresholds & min-weight demotion** (§3).
- **Machine-spec versioning** — QSS primitives vs machine-local (§7).

---

## 13. Acceptance / verification

- Server + client builds green (mind the Windows/UTF-16 edit hazard).
- **Fan-out test:** a 3-line pass with mixed routes (`…CZ` + `…CLE`) advances each line to the correct next queue; a HELD line stays put while others advance.
- **Mass-balance test:** `Σ line output + scrap + rejection ≈ input` within tolerance; violation warns.
- **Eligibility test:** ID mismatch hard-blocks; width/thickness out-of-band warns + allows with reason.
- **Quality safety:** missing spec ⇒ `NOT_EVALUATED`, capture still commits (no 500); captured record snapshots its spec version.
- **Idempotency:** replayed `production.captured` does not double-advance.
- **Offline:** capture queues and replays without data loss.

For high-value paths (journey fan-out, quality safety), add backbone tests mirroring the CRM P-series.

---

## 14. Required modules (not exhaustive)

Touch/generalise: the CRM operator shell + action rail; the order-assignment endpoint + modal; the queue engine; `JourneyAdvanceConsumer`; stoppage master; `SpecFetchService` / `qc_measurement`; `shared-validation` `CRSEntry`/`CRSSlitSlot`; the migration set.
Create: `master.machine_spec` + its CRUD; the CRS capture body (slit fan-out) cloned from HRS; crew capture; CRS stoppage/defect seeds; CRS dashboard metrics.
