# ZEDRAL — Annealing (ANN) Operator · Implementation Plan

**Status:** Planning · authored 2026-07-30
**Sibling docs:** `ZEDRAL_HRS_OPERATOR_IMPLEMENTATION_PLAN.md`, `ZEDRAL_PKL_OPERATOR_IMPLEMENTATION_PLAN.md`
**Extends:** All-Process Operator feature (`.kiro/specs/all-process-operator/`)
**Inputs analyzed:** PPC plan `ANNE 21.07.2026.XLSX` (157 coil rows), Base Reading Register `FO/PRD/0904/03` (Base 2 / Batch 10154 / Charge 15357), Work Instruction `WI/PRD/1201/03 Rev 03 (27-09-2025)`.

---

## 0. Guiding principle — ANN is the *fan-in* mill

HRS/CRS fan **out** (one mother → many slits). PKL is **1-in-1-out**. ANN is the only mill that fans **in**: the Machine Head groups N already-processed coils into one **charge**, they share one thermal cycle on one **base**, and on completion they **all advance together** over the coil roster. This matches the already-locked decision that *ANN is excluded from `JourneyAdvanceConsumer` and advances on charge `DONE` fan-out, not per-coil.*

Reuse the operator shell, masters, timers, stoppage model, and journey engine. The genuinely net-new pieces are: the **charge-builder UI**, the **10-stage cycle state machine**, the **periodic reading log**, and the **CRUD spec masters**.

---

## 1. Current-state gap (verified against code, 2026-07-30)

ANN backend is **legacy-minimal** (like HRS was), charge + roster only:

| Exists | Where |
|---|---|
| `txn.ann_charge` (header) | `db-types.ts` `TxnAnnCharge` — base_no, charge_no, furnace_id, grade_code, no_of_coils, charge_wt_mt, status∈{IN_PROCESS,FOR_ANN,RW,DONE}, dew_point_n2/h2, temperature_degc, oxygen_pct, exp_unloading_time, loading_mt/unloading_mt, cumm_loading/unloading_mt, shift_code/shift_log_id, prod_date |
| `txn.ann_charge_coil` (roster) | `TxnAnnChargeCoil` — charge_no, coil_no, **seq_no** (stack position ✓) |
| `master.furnace` | `MasterFurnace` — furnace_id, furnace_type |
| `annSchema`/`ANNSchema`, `M1ANNForm`, `ANNEntry` | `m1Forms.ts`, `fieldRules.ts`, `processes.ts` |
| `ProductionService.saveAnn` | inserts charge + **one** coil per call, `emitCaptured('ANN', …)` |
| `POST /ann` | `productionRoutes.ts` |
| ANN in route engine | `machineRouting.ts` `NON_CRM_MACHINE_CODES`, label `ANN: 'Annealing'` |

**Missing → net-new:**

- **No stage/timing model** — the 10-stage cycle (Loading→Unloading, start/end/duration) does not exist. Only a single `status` + `temperature_degc`. *This is the biggest build item.*
- **No reading log** — periodic operator readings (charge/gas/F-C temp, N₂/H₂, base press, fan RPM, fuel flow, RCF RPM) are not modeled; only single-point dew-point/temp/O₂ on the header.
- **No stoppage table** for ANN.
- **No cooling-hood** field or master.
- **No spec/limit masters** (WI standards are not in the DB).
- **Client** — only `GenericCapturePage`; no charge-builder, no base grid, no stage control, no reading grid.
- `saveAnn` is one-coil-per-call — must become **charge + roster[] in one transaction** (borrow PKL's `savePkl` charge+children pattern).

---

## 2. Locked decisions (user, 2026-07-30)

1. **Identifiers** — `Charge No` is the technical key (existing `ann_charge.charge_no`). `Annealing Batch No` is a **manual / SAP-allotted, plain-number** business field, **ANN-scoped only** (does not propagate downstream). Register `Batch No` == plan `Annealing Batch` column. v1: **1 charge = 1 batch** (1:1); add `annealing_batch_no` to the header.
2. **Grouping is fully manual** — the Machine Head hand-picks coils into a charge. No enforced grouping key. Mixed grades/cycles allowed.
3. **Clubbing/compatibility specs from the WI are advisory, CRUD-editable** — surface as warnings on the charge-builder, never hard gates.
4. **Base = hint** — plan `Prod. Version` (`AB16`/`AB01` → "Annealing Base 16/01") is a suggested default; the Machine Head decides.
5. **Re-annealing = process-route driven** — a coil that needs another anneal re-enters the ANN queue when its route (`…F4F4…`) says so. No within-charge multi-pass in v1.
6. **No master recipe library** — cycle setpoints come from the per-coil PPC values (reference/display). Spec **limits** (caps/ranges) are CRUD masters (§6).
7. **Stages skippable with authorization** — Machine Head authorizes any skip.
8. **Stage timing = auto-timestamp on operator tap** (swipe advances → system records now). Correction/undo allowed with Machine-Head authorization.
9. **Total Annealing Time = Σ active stage durations.** Idle gaps (bell moved away) are recorded separately for other scopes (utilization), excluded from total.
10. **Completion = fan-out advance** over the roster on **Unloading DONE**; each coil advances per its **process route** (onward, or re-queue to ANN).
11. **Authority on conflict:** the actual sheets + WI (real practice) win over the requirements doc.
12. **Every spec is CRUD** — all WI limits, capacities, intervals, stoppage codes, stage definitions, fuel params live in editable master tables (§6).

---

## 3. Domain vocabulary (get these names right in code)

| Term | Meaning | Key |
|---|---|---|
| **Coil** | one already-slit child coil arriving from upstream (HRS→PKL), carries its order identity | `coil_no` |
| **Charge** | one physical furnace load = stack of coils sharing one thermal cycle on one base | `charge_no` (PK) |
| **Annealing Batch** | manual/SAP business number for the charge, ANN-only | `annealing_batch_no` |
| **Base** | fixed stand holding the charge for the whole cycle (~16 bases) | `base_no` |
| **Furnace / Bell** | movable heating hood placed during Heating | `furnace_id` |
| **Cooling Hood** | movable hood placed during Cooling | `cooling_hood_id` (new) |
| **Cycle** | recipe (soak temp/time steps, cooling caps) carried per-coil from PPC | `ann_cycle` code (ref) |
| **Stage** | one of 10 steps in the cycle | `ann_charge_stage` |
| **Reading** | a periodic instrument snapshot for a base/charge | `ann_charge_reading` |

---

## 4. Data model

### 4.1 Extend `txn.ann_charge` (header)
Add: `annealing_batch_no` (text, manual/SAP), `cooling_hood_id` (FK → master.ann_cooling_hood), `ann_cycle_code` (text, from PPC), `height_mm` (stack height), `tightness_drop_mmwc` (test result), `total_h2_flow_cycle`, `soak_temp_degc`, `soak_time_hr`, `total_active_min` (derived Σ stages), `total_idle_min` (derived), `charged_condition`, `created_by_user_id` (Machine Head).
Keep existing status enum but treat it as the **charge lifecycle** (`IN_PROCESS`/`FOR_ANN`/`RW`/`DONE`); the fine-grained state lives in the stage table.

### 4.2 Extend `txn.ann_charge_coil` (roster) — one row per coil
Add: `stack_position` (rename/alias of `seq_no`, bottom→top), `disposition` (`ADVANCE`/`HOLD`/`REJECT`, default `ADVANCE`), `unload_remark`. Per-coil grade/customer/size/weight are **not duplicated** — read from the coil's journey/master (traceability), matching the sibling model.

### 4.3 NEW `txn.ann_charge_stage` — one row per (charge × stage)
`charge_no`, `stage_code` (LOADING, PURGING, HEATING, SOAKING, FURNACE_COOL, NATURAL_COOL, RAPID_COOL, WATER_COOL, POST_PURGING, UNLOADING), `seq`, `start_at`, `end_at`, `duration_min` (derived), `transition_temp_degc` (auto-pulled from latest reading, overridable), `skipped` (bool), `skip_authorized_by`, `skip_reason`, `started_by_user_id`. **Only one non-terminal stage active per charge** (enforced). Idle gap = `next.start_at − prev.end_at`.

### 4.4 NEW `txn.ann_charge_reading` — periodic log
`reading_id`, `charge_no`, `base_no`, `taken_at`, `stage_code` (tag = current stage), `shift_code`, `operator_user_id`, and the instrument columns from the register: `charge_temp`, `gas_temp`, `fc_temp` (furnace/cooling temp), `n2h2_flow`, `base_press`, `base_fan_rpm`, `fuel_flow`, `rcf_rpm` (recirc cooling fan, cooling-only). Chronological, keyed by base+charge+timestamp — same shape as PKL's `prod_pkl_chart`.

### 4.5 NEW `txn.ann_charge_stoppage`
`stoppage_id`, `charge_no`, `base_no`, `category_code` (FK → master.ann_stoppage_category), `start_at`, `end_at`, `duration_min` (derived), `reason`, `remark`. Seeds the register's example ("CA blower not working 01:00–01:45"). Stoppages are **logged, not netted out** of stage duration (thermal process — metal stays hot).

---

## 5. Spec / standards masters — **ALL CRUD** (seed from WI, editable in Machine-Head/admin)

Per the "keep all specs CRUD" requirement, nothing below is hardcoded. Each is a master table with list/create/edit/deactivate UI; all limits apply as **advisory warnings** (only where a physical safety gate is essential do we consider a hard gate, flagged below).

### 5.1 `master.ann_spec_limit` (grade-family standards — WI p.10)
| Product/family | Soak temp | Soak time |
|---|---|---|
| RR (MC11, MC12, HC14, C40, C45, C55, C62, C80) | 650–710 °C | 8–12 hr |
| D grade | 610–670 °C | 4–8 hr |
Editable rows; used to validate/hint per-coil recipe and clubbing.

### 5.2 `master.ann_clubbing_rule` (WI p.10–11)
Soak-temp spread for clubbing **10–30 °C (pref 10–20)**; matt+bright allowed (same surface preferred); thickness bands **0.30–0.80 / 0.81–1.70 / 1.71–4.00 mm**; soak-time compensation (D/SAPH/MC11/MC12/HC14: −10–20 °C → +1–2 hr; DD/EDD: −10–20 °C → +2–4 hr); width > 700 mm → **step-soak 550 °C / 2 hr**. All values CRUD.

### 5.3 `master.ann_cooling_spec` (WI p.7–8)
Furnace cooling ≥ **2 hr (min, all grades)**; rapid-cool start ≤ **450 °C (max)**; water-cool start ≤ **375 °C (max)**; acceptable ann-temp diff **±10 °C**; acceptable soak-time diff **+1 hr**; ambient < 20 °C → rapid-cool +min 30 °C, unload −5 °C. CRUD.

### 5.4 `master.ann_purge_spec`
N₂ pre-purge ≥ **40 Nm³/hr**, purge 30 min then O₂ **< 0.5 %** to proceed (else re-purge); final purge N₂ ≥ 40 Nm³/hr, **≥ 40 min**; tightness pressure drop ≤ **50 mm WC (max)**. CRUD. *(O₂ < 0.5 % is the one candidate hard-gate on Purging→Heating — default advisory, flag for user.)*

### 5.5 `master.ann_fuel_param` (WI p.7)
C-9/HSD: 3–5 kg/cm², heating 70–110 LPH, soaking 30–50 LPH. LPG: 1–2 kg/cm², heating 30–40 Nm³/hr, soaking 15–30 Nm³/hr. CRUD.

### 5.6 `master.ann_base` (16 bases)
`base_no`, `capacity_max_coils`, `capacity_max_wt_mt`, `capacity_max_height_mm`, `soak_time_adj_hr` (Base 1 & 6 → +1 hr, WI p.8), `active`. Capacity → advisory on charge-builder. CRUD.

### 5.7 `master.furnace` (extend, exists) + `master.ann_cooling_hood` (new)
Both CRUD; assignable to a charge; enforcement advisory in v1 (record which furnace/hood is on which base; future: constrained scheduling).

### 5.8 `master.ann_stage` (stage definitions)
The 10 stages with `seq`, `label`, `is_skippable`, `default_active`. Makes the state machine + skip rules configurable rather than hardcoded. CRUD.

### 5.9 `master.ann_reading_config`
`interval_min` (default operator-driven; optional soft reminder ~2 hr, PKL-style), `reminder_enabled`, required-field set. CRUD.

### 5.10 `master.ann_stoppage_category`
Seed from register fault checkboxes + WI: **Base Fan, Base Seal, Base Clamp, Base Water, Thermocouple**, plus CA Blower, Power, Gas Supply, Crane, Other/Give-Details. CRUD (mirror HRS/PKL code-master pattern).

> Note (Decision 6): cycle **codes** (001–014) from the plan are reference/display only — **not** a recipe master. Only limits/standards above are CRUD masters.

---

## 6. PPC plan → charge-builder field map (`ANNE 21.07.2026.XLSX`)

157 rows = 157 child coils (70 mothers, 84 sale orders, 1 SAP batch each). Flat file, no subtotal rows — all grouping is the Machine Head's.

| Plan column | Use |
|---|---|
| `Batch Number` (T) | coil SAP identity (queue key) |
| `Mother Coil` (D) + `Slit ID` (E) | child-coil derivation `<mother>-<slit>` (traceability) |
| `Prod. Version` (AC) / `PV-Desc` (AD) = `AB16`/`AB01` | **suggested base** (hint, overridable) |
| `Ann Cycle` (BU) + `Grade` (AI) / `RM Grade` (L) | clubbing/compatibility hints (§5.2) |
| `First/Second/Third Ann Temp` + `Soaking time` (J/K, AJ/AK, AL/AM…) | recipe display + soak-spread check |
| `First Furnace Time/Temp`, `Rapid/Water/Unload Cool` (AN–BI) | cooling setpoints (capped by §5.3) |
| `Coil Weight` (H) | roster weight → charge total, capacity check |
| `Process Route` (P), tail `CZ`/`CLE` | journey routing on completion |
| `Charge No` (BR), `Annealing Batch` (BW) | **blank at import** → generated/entered at batching |

---

## 7. Roles & screens

### 7.1 Machine Head
- **Charge Builder** — filter the ANN queue (by base hint / cycle / grade / customer), multi-select coils, set **stack order**, assign **base** (+ furnace + hood), enter **Annealing Batch No** (manual/SAP), review **advisory clubbing/capacity warnings** (§5), create charge → mints `charge_no`, roster written, coils leave the queue.
- **Base-grid dashboard** — one card per base: Base No, Charge/Batch No, current stage, #coils, status, start time, running duration; click → full detail (roster, stage timeline, live readings, stoppages, history).
- **Spec CRUD** — manage all §5 masters. Authorize stage skips and timing corrections.

### 7.2 Operator
- **Base grid** — all bases with base no / charge no / current stage / running timer / status.
- **Base detail** — roster, current stage + stage timer, total running time, previous readings, stoppage history.
- **Reading entry** — the register column set (§4.4), auto-timestamp, stage-tagged, chronological log, soft reminder per `ann_reading_config`.
- **Stage control** — swipe to advance (auto-timestamp; closes prev stage, opens next); skip needs Machine-Head authorization.
- **Stoppage entry**, **complete process**.

Base→operator: any operator may open any base; operator + shift captured per reading/action.

---

## 8. Stage state machine

Order (WI-confirmed): Loading → Purging → Heating → Soaking → Furnace Cool → Natural Cool → Rapid Cool → Water Cool → Post Purging → Unloading.

- Swipe advance = auto-timestamp `end_at` on current + `start_at` on next; exactly one active stage.
- **Skippable stages** (`master.ann_stage.is_skippable`, e.g. Rapid/Water Cool for some grades) require Machine-Head authorization → records `skipped`, `skip_authorized_by`, `skip_reason`.
- Cooling transitions are temperature-threshold-driven **reference** (rapid ≤450, water ≤375, unload per ambient) shown from recipe/§5.3; operator confirms the tap.
- `transition_temp_degc` auto-fills from latest reading, overridable.
- **Total Annealing Time = Σ `duration_min` of non-skipped active stages.** Idle gaps stored for utilization, excluded from total.
- Correction/undo of a transition = Machine-Head authorized edit (audited).

---

## 9. Completion & journey (fan-out)

On **Unloading DONE**: set charge `status='DONE'`, then **fan out over the roster** — for each coil with `disposition='ADVANCE'`, advance its `planning.order_journey` per the coil's **process route** (onward to CRS/CTL/ship, or re-queue to ANN if the route has another anneal). Coils flagged `HOLD`/`REJECT` at unloading do **not** advance (held/scrapped per existing hold mechanism). This is the **ANN-specific advance** (ANN stays excluded from the per-coil `JourneyAdvanceConsumer`); implement as a charge-completion handler — idempotent, try/catch, never re-throw.

---

## 10. Live sync
Reuse the existing operator dashboard refresh mechanism (React-Query polling / query invalidation used by the 6HI/all-process hubs) — no new websocket infrastructure in v1. Verify the exact hook during build and match it so Machine-Head and Operator views stay consistent.

---

## 11. Reuse map

- **Server:** `savePkl` (charge + children in one txn) as the template for the new `saveAnn`; `emitCaptured('ANN', …)` already fires; add the charge-completion fan-out handler alongside `JourneyAdvanceConsumer`.
- **Client:** operator shell / hub / action-rail from the 6HI + all-process operator; PKL Hub tab pattern (Coils tab + Process Chart tab) maps to **Roster tab + Reading Log tab + Stage Timeline**; CRS machine-allocation board pattern for base assignment; stoppage sub-form pattern.
- **Masters:** the PKL/CRS spec-limit + stoppage-code master pattern for all §5 tables.

---

## 12. Build order (dependency-ordered)

1. **Migrations** — extend `ann_charge`/`ann_charge_coil`; create `ann_charge_stage`, `ann_charge_reading`, `ann_charge_stoppage`; create the §5 masters (+ `ann_cooling_hood`).
2. **Schemas/types** — extend `annSchema`/`ANNSchema`/`ANNEntry`; add stage/reading/stoppage/roster schemas; update DDL-reconciliation tests.
3. **Server services** — rewrite `saveAnn` (charge + roster[]); stage-advance, reading-append, stoppage, complete-charge (+ fan-out) endpoints; spec-master CRUD routes.
4. **Seeds** — §5 masters from WI + register.
5. **Client — Machine Head** — Charge Builder, base-grid dashboard, spec CRUD.
6. **Client — Operator** — base grid, base detail, reading grid, stage control, stoppage form, complete.
7. **Live sync** wiring + retire `GenericCapturePage` for ANN.
8. **Tests** — stage single-active invariant, total-time = Σ active, fan-out advance idempotency, capacity/clubbing advisories, spec-CRUD round-trip.

---

## 13. Open decisions left to the developer / user

- **O₂ < 0.5 % on Purging→Heating** — advisory (default) or the one hard gate? (§5.4)
- **Charge ↔ Batch cardinality** — confirmed 1:1 for v1; revisit if a batch may span charges.
- **Add-coils-after-create** — can a charge be edited (add/remove coils) before Loading starts? (default: editable until Loading `start_at`.)
- **Furnace/hood** — record-only in v1; when to promote to constrained scheduling.
- **Windows/UTF-16** editing caution applies to `.ts` edits (see `[[zedral-windows-utf16-editing]]`).

---

## 14. Acceptance / verification
- One active stage per charge at all times; skips audited.
- Total time equals Σ active stage durations; idle tracked separately.
- Completing Unloading advances every `ADVANCE` coil per its route exactly once (idempotent); held/rejected coils don't advance.
- Every WI spec/limit is editable via CRUD and applied as advisory (no hardcoded constants).
- Reading log matches the register columns and is stage-tagged and chronological.
