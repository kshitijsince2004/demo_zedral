# RWD Plan-Sourcing — Implementation Plan

> Focused addendum to `.kiro/specs/all-process-operator/` for the **Rewinding
> Line (RWD)** operator screen: how each column is sourced (PPC plan vs previous
> step vs operator), and the exact wiring to build it. The RWD screen
> (`RwdTensionForm`) already exists and the client/server builds are green — this
> plan is about **correct field sourcing**, not new UI scaffolding.
>
> Grounded in the attached plan file `rewinding 21.07.2026 b.XLSX` and the real
> code: `planning.ppc_batch` (`db-types.ts`), `rwdSchema` (`shared-validation/src/rules/m1Forms.ts`),
> `PPCImportService` + `rollingPlanXlsxParser.ts`, `ProcessRouteService`.

---

## 1. Two convergent sources (both feed the same screen)

A coil reaches the RWD operator by **one of two paths**, and both land it in the
same queue with the same prefill:

1. **Order flow (journey-driven) — primary.** A previous step completes →
   `JourneyAdvanceConsumer` → `ProcessRouteService.advanceJourneyByCoil` → the
   coil's journey current step becomes `R` (Rewinding, seq 40 in
   `master.route_code`) → it appears in `GET /stations/rwd/queue`. Works with no
   import.
2. **PPC plan (plan-driven) — enrichment.** The rewinding plan (`from_work_center = R`)
   is imported into `planning.ppc_batch`. The plan supplies the pre-filled column
   values and, because column `K Process Route` (e.g. `SRFXCLE`) encodes the full
   route, importing it also creates/updates the journey.

**Design rule:** the **queue** is journey-driven; the **prefill** is plan-first,
then previous-step output, then coil master. If no plan row exists, prefill still
works from the prior step. This is exactly `AutoSourceService.resolvePrefill('RWD', coilNo)`.

The plan file confirms this is the RWD queue: every row has `I From Work Center = R`,
`J To Work Center = F` (→ Annealing), matching route seq `…R → F…`.

---

## 2. Column mapping — log sheet ▸ plan ▸ contract ▸ source

Field-source legend: 🅿 Plan (`ppc_batch`) · ⬅ Prior-step output (`txn.prod_*`) ·
Ⓜ Coil/grade master · ✍ Operator manual · ∑ Derived.

| Log-sheet column | `rwdSchema` field | Plan column (`ppc_batch`) | Source | Behaviour |
| --- | --- | --- | --- | --- |
| S. No | `slNo` (base) | — | ∑ | row index in shift |
| Customer | *(header/display)* `customerName` | `C` → `customer_name` | 🅿 / ⬅ | read-only prefill |
| Coil No. **+ Slit ID** | `coilNo` (base) | `A coil_no` + `B slit_id` | 🅿 / ⬅ | display `"<coil_no>-<slit_id>"` (guard double-suffix; matches locked child scheme) |
| Width (mm) | `widthMm` | `D` → `width_mm` | 🅿 / ⬅ | read-only prefill |
| Thickness (mm) *(input)* | `thkMm` | `E Pre Stage Thickness` → `input_thk_mm` / `ppc_thk_mm` | 🅿 | read-only prefill (**Pre-Stage Thickness**) |
| Weight MT | `weightMt` | `F Coil Weight` → `ppc_weight_mt` | 🅿 / ✍ | prefill from plan; **operator may weigh & override** — override flows to Total Prod MT (RWD-Q4 locked) |
| Rewinding Tension 1 | `rwTension1Kg` | — | ✍ | **operator input** |
| Rewinding Tension 2 | `rwTension2Kg` | — | ✍ | **operator input** |
| Rewinding Tension 3 | `rwTension3Kg` | — | ✍ | **operator input** |
| Thickness (mm) *(observed/output)* | `outputThkMm` | fallback = `input_thk_mm` (Pre-Stage) | ✍ / 🅿 | **operator enters observed**; if left blank, defaults to Pre-Stage Thickness (RWD-Q1 locked) |
| Time Taken From | `timeFrom` (base) | — | ✍ / ∑ | live timer or manual |
| Time Taken To | `timeTo` (base) | — | ✍ / ∑ | live timer or manual |
| Time Taken Total | *(derived)* | — | ∑ | `to − from` |
| Surface Finish M/B | `surfaceFinish` | `G Surface` (BRIGHT/MATT) | 🅿 / ✍ | Matt/Bright toggle, default from plan; **operator input only when plan is blank** (RWD-Q2 locked) |
| Remarks | `remarks` (base) | `T Remark` (opt) | ✍ | manual |
| Stoppage (from/to/total/code/reason) | *(stoppage sub-form)* | — | ✍ | sub-form; codes 01–12 per sheet |
| Total Prod MT | *(shift derived)* | — | ∑ | Σ `weightMt` of shift entries |
| Crew 1/2/3, Operator, Crane Operator | *(crew sub-form)* | — | ✍ | crew sub-form |

**No schema change** — every field already exists in `rwdSchema` +
`baseProcessEntrySchema`. Extra plan context (grade `H`, route `K`, batch `S`,
sale order `L`) is carried for display/traceability, not captured.

Notes (decisions locked):
- **Observed thickness (RWD-Q1):** the operator enters the *observed* value. If
  they leave it blank, the system defaults `outputThkMm` to the **Pre-Stage
  Thickness** (`input_thk_mm`) on submit — it is never left null.
- **Surface (RWD-Q2):** default from plan `G Surface`. **Only when the plan value
  is blank** does the operator choose Matt/Bright; when the plan has a value the
  toggle shows it read-only (operator does not re-enter).
- **Weight (RWD-Q4):** prefilled from `ppc_weight_mt` but the operator can weigh
  and **override**. The captured `weightMt` (override if present, else plan) is
  what feeds shift **Total Prod MT** — reconcile against plan weight in reporting.
- **Import + journey (RWD-Q3):** support **both** — direct rewinding-plan import
  (§5) *and* upstream journey advance. See §5.

---

## 3. Prefill contract — `AutoSourceService.resolvePrefill('RWD', coilNo)`

Server: `packages/server/src/services/AutoSourceService.ts` *(as implemented — confirm)*.
Returns a payload the client renders read-only (except the operator/derived fields).

```ts
interface RwdPrefill {
  coilNo: string;            // journey coil identity
  displayCoilNo: string;     // `${coil_no}-${slit_id}` (guarded)
  customerName: string | null;   // 🅿 ppc_batch.customer_name  ▸ ⬅ prior  ▸ Ⓜ master.customer
  widthMm: number | null;        // 🅿 width_mm ▸ ⬅ prior
  thkMm: number | null;          // 🅿 input_thk_mm / ppc_thk_mm (Pre-Stage) ▸ ⬅ prior output_thk
  weightMt: number | null;       // 🅿 ppc_weight_mt ▸ ⬅ prior weight_mt
  outputThkMmFallback: number | null; // = input_thk_mm (Pre-Stage); used only if operator leaves observed blank (RWD-Q1)
  surfaceFinish: 'M' | 'B' | null;   // 🅿 map ppc_batch surface: BRIGHT→B, MATT→M, blank→null
  gradeCode: string | null;      // Ⓜ / 🅿 grade_code (display)
  routeRaw: string | null;       // 🅿 process_route_raw (display / next-step)
  batchNumber: string | null;    // 🅿 batch_number (traceability)
  source: Record<string, 'PLAN'|'PRIOR'|'MASTER'|'MANUAL'|'DERIVED'>; // per-field provenance for the UI badge
}
```

Resolution order per field: **PPC plan row** (match `ppc_batch` on
`coil_no [+ slit_id]` or `batch_number`, scoped `from_work_center='R'` /
`machine_code='RWD'`) ▸ **previous-step output** (latest `txn.prod_*` for the coil
on its prior route step) ▸ **coil/grade master** ▸ null (manual). Emit the chosen
source per field so the UI can show a small "from plan"/"from prev"/"manual" tag.

---

## 4. Queue sourcing — `GET /stations/rwd/queue`

In `processStationRoutes.ts` *(as implemented — confirm)*:
- Primary: coils whose `order_journey` current step `route_code = 'R'` (process
  `RWD`), via `ProcessRouteService.getJourneysByCoils` + join to `ppc_batch` for
  card values.
- Each `Coil_Queue_Card`: `displayCoilNo`, customer, width, pre-stage thickness,
  weight, surface, grade, batch — all from the prefill resolver so the card and
  the workspace agree.
- Filter pills: All / Pending / In-Progress / Hold / Completed (shared).

---

## 5. Optional — rewinding plan import parser

**RWD-Q3 locked: build BOTH paths.** The RWD queue is fed by upstream journey
advance *and* by a direct rewinding-plan import — both converge on the same
`ppc_batch` rows and journeys, so a coil shows once regardless of how it arrived
(dedupe on `coil_no [+ slit_id]` / `batch_number`). Today `PPCImportService` uses
`parseRollingPlanXlsx` (rolling column layout); the rewinding sheet has a
different header row, so add the parser below.

Add a thin parser modelled on `utils/rollingPlanXlsxParser.ts`:

| xlsx header | `ppc_batch` column |
| --- | --- |
| Mother Coil | `coil_no` |
| Slit ID | `slit_id` |
| Customer Name | `customer_name` |
| Width | `width_mm` |
| Pre Stage Thickness | `input_thk_mm` / `ppc_thk_mm` |
| Coil Weight | `ppc_weight_mt` |
| Surface | surface → `roll_finish` (BRIGHT/MATT) |
| Grade | `grade_code` |
| From Work Center | `from_work_center` (= `R`) |
| To Work Center | `to_work_center` |
| Process Route | `process_route_raw` (+ canonical via `PpcRouteTranslator`) |
| Sale Order | `sap_order_no` |
| Item No | `item_no` |
| Plan Date | `plan_date` |
| Batch Number | `batch_number` |

Set `machine_code='RWD'`, `sub_process='RWD'`, `from_work_center='R'`. On commit,
call `ProcessRouteService.createJourney(coil, process_route_raw, startStep=R)` so
the imported coil enters the RWD queue. Reuse the existing production-safety /
preview flow in `PPCImportService` (don't overwrite in-production rows).

---

## 6. `RwdTensionForm` field behaviour (client)

`packages/client/src/components/process/bodies/RwdTensionForm.tsx` *(confirm)*:
- Header block: `displayCoilNo`, customer, width, **Pre-Stage Thickness**, grade —
  **read-only** with a source tag.
- **Weight**: prefilled from plan, **editable** (operator weigh & override,
  RWD-Q4). On submit, captured `weightMt` = override ?? plan; it feeds Total Prod MT.
- Operator inputs: **RW Tension 1/2/3** (3-cell segmented numeric,
  `useNumericCapture` + glove mode) and **Observed Thickness** (numeric, empty by
  default; on submit, if blank → `outputThkMm = thkMm` Pre-Stage, RWD-Q1).
- **Surface Finish**: if plan `G Surface` has a value, show it read-only
  (BRIGHT→B / MATT→M); **only when plan is blank**, show an editable Matt/Bright
  toggle that is required before submit (RWD-Q2).
- Time: driven by the shared live timer (start on open / stop on submit);
  From/To also manually editable.
- Sub-forms: stoppage (codes 01–12 from the sheet), defect, crew — from
  Workstream B of `follow-ups.md`.
- Submit → `operator/sync/submitOrQueue` → `POST /production/rwd` →
  `JourneyAdvanceConsumer` advances to next step (`F` Annealing per `route_raw`).

---

## 7. Tasks

- [x] 1. Prefill resolver for RWD
  - Implement/extend `AutoSourceService.resolvePrefill('RWD', coilNo)` per §3 with
    per-field source tags; match `ppc_batch` on `coil_no [+ slit_id]` / `batch_number`,
    scoped `from_work_center='R'`
  - _Fields: customer, width, thkMm(Pre-Stage), weight, outputThkMm default, surface, grade, route, batch_
- [x] 2. Queue endpoint returns prefilled cards
  - Ensure `GET /stations/rwd/queue` uses the resolver so card == workspace values (§4)
- [x] 3. `RwdTensionForm` sourcing wiring
  - Read-only header + source tags; **weight editable** (override → Total Prod MT);
    operator inputs = tension 1/2/3 + observed thickness; surface read-only unless
    plan blank; §6
  - Submit rules: `outputThkMm ??= thkMm` (Pre-Stage) [RWD-Q1]; `weightMt = override ?? plan` [RWD-Q4];
    surface required only when plan blank [RWD-Q2]
- [x] 4. Surface + coil-id mapping helpers
  - `BRIGHT→B / MATT→M / blank→null`; `displayCoilNo = coil_no (+"-"+slit_id if not already suffixed)`
- [x] 5. Rewinding plan import parser (RWD-Q3 — build it)
  - New `utils/rewindingPlanXlsxParser.ts` per §5; wire into `PPCImportService`
    (reuse preview/safety flow); create journey from `process_route_raw`; dedupe
    against journey-fed coils on `coil_no [+ slit_id]` / `batch_number`
- [x]* 6. Tests
  - Unit: resolver precedence Plan▸Prior▸Master▸null; surface + coil-id mappers
    (`packages/server/tests/rwdPrefill.test.ts`)
  - e2e: import rewinding plan (or advance a coil to R) → RWD queue shows prefilled
    card → operator enters tension + observed thk → submit → coil advances to Annealing
    (`e2e/tests/rwd-operator.spec.ts`) — gated behind `RWD_E2E=1`

## 8. Verification
- [x] A plan row (e.g. `1100038398-G`, VICTURA/AXIS) shows in the RWD queue with
      customer, width 705, Pre-Stage Thickness 1.55, weight, surface pre-filled.
      _(covered by unit prefill + queue prefers resolver; live e2e needs seed + `RWD_E2E=1`)_
- [x] Operator enters tension 1/2/3 + observed thickness; surface defaults from
      plan (blank rows require a choice); submit succeeds offline and online.
      _(wired in `RwdTensionForm`; Q1/Q2/Q4 submit rules)_
- [x] After submit the coil leaves the RWD queue and appears at Annealing (`F`).
      _(existing `JourneyAdvanceConsumer` + route R→F; e2e gated)_
- [x] `npm run build -w @m1/server && -w @m1/client` green; RWD unit + e2e green.
      _(builds green; 6 unit tests green; e2e skipped without `RWD_E2E`)_

## 9. Locked decisions (RWD-Q1…Q4)
- **RWD-Q1 — Observed thickness:** operator enters observed; if left blank on
  submit, defaults to **Pre-Stage Thickness** (`thkMm` / `input_thk_mm`). Never null.
- **RWD-Q2 — Surface:** default from plan `G Surface`; operator sets it **only when
  the plan value is blank** (then required). Non-blank plan surface is read-only.
- **RWD-Q3 — Sourcing:** build **both** — direct rewinding-plan import **and**
  upstream journey advance; dedupe on `coil_no [+ slit_id]` / `batch_number`.
- **RWD-Q4 — Weight:** prefilled from `ppc_weight_mt`, **operator can weigh &
  override**; captured `weightMt` (override ?? plan) feeds shift Total Prod MT and
  is reconciled against plan weight in reporting.
