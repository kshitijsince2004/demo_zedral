# HRS (HR Slitting) — Audit & Fix Plan for Cursor

**Module:** M1 HR Slitting (`HRS`) — the slit-combination builder that fans one mother coil out into N child coils (A, B, C, …), each with its own width/weight/route.
**Scope of this audit:** UI slit builder → server `/production/hrs` route → `ProductionService.saveHrs` → `production.captured` event → `JourneyAdvanceConsumer` child-coil spawn → DB (`txn.prod_hrs`, `txn.prod_hrs_slit`, `coil.coil`, journeys) → `HrsOrderService` lifecycle.
**How to use this doc:** each issue has a stable ID, a root cause with exact file/line references, and a *Cursor task* block you can paste directly. Do them in priority order. Nothing here has been changed in the code yet — this is a plan only.

---

## Key files

| Layer | File |
| --- | --- |
| UI builder | `packages/client/src/components/process/bodies/HrsSlitBuilder.tsx` |
| Client submit | `packages/client/src/store/processStore.ts` (`submitProcessCapture`) |
| Route | `packages/server/src/modules/m1-collection/routes/productionRoutes.ts` |
| Persist | `packages/server/src/modules/m1-collection/services/ProductionService.ts` (`saveHrs`) |
| Fan-out / journeys | `packages/server/src/modules/m1-collection/consumers/JourneyAdvanceConsumer.ts` |
| Order lifecycle | `packages/server/src/services/HrsOrderService.ts` |
| Schema | `packages/shared-validation/src/rules/m1Forms.ts` (`hrsSchema`, `hrsSlitSlotSchema`) |
| Migration | `packages/server/migrations/1945000000000_hrs_slit_fanout_fields.js` |
| Scrap calc | `packages/shared-validation/src/utils/calculationEngine.ts` |

---

## Priority summary

| ID | Severity | One-line |
| --- | --- | --- |
| HRS-1 | 🔴 Critical | Every child coil is minted with the **mother's full weight** — planned slit weight is ignored |
| HRS-2 | 🔴 Critical | Child coil **thickness** ignores `planned_thk_mm`; falls back to mother thickness |
| HRS-3 | 🟠 High | **Scrap %** computed on different denominators client vs server → server silently overwrites with a wrong value |
| HRS-4 | 🟠 High | Child-coil spawn is **not transactional / not idempotent** with journey creation — retries can double-spawn journeys |
| HRS-5 | 🟡 Medium | `forCtlFlag` captured on HRS lines is **never used** downstream (no LE/PKG routing at HRS) |
| HRS-6 | 🟡 Medium | `ensureOrder` insert uses `as any` and mixes `production_day`/`prod_date` — type-unsafe, fragile |
| HRS-7 | 🟢 Low | UX: "Add width/thickness reading" pre-fills the **plan** value, so operator confirms plan as if it were measured |
| HRS-8 | 🟢 Low | Dead/retired columns still selected (`thk_mm`, `thk_id_mm`) and written as `null` on every row |

---

## HRS-1 🔴 Child coils get the mother's full weight

**Root cause.** `ProductionService.saveHrs` writes each slit's `planned_weight_mt` and hard-codes `actual_weight_mt: null` (`ProductionService.ts` ~L125–126). The fan-out consumer then computes child weight as:

```ts
// JourneyAdvanceConsumer.ts  ~L282
const wt = slit.actual_weight_mt != null
  ? Number(slit.actual_weight_mt)
  : slit.output_wt_mt != null       // HRS never selects/sets this
    ? Number(slit.output_wt_mt)
    : mother.weight_mt;             // ← HRS always lands here
```

For HRS, `actual_weight_mt` is always `null` and `output_wt_mt` is never selected (`loadHrsSlits` at ~L81–97 doesn't select it), so **every** child coil is inserted with `weight_mt = mother.weight_mt`. A 20 MT mother slit into 4 children yields 4× 20 MT = 80 MT of child stock. This corrupts all downstream mass balance, DPR tonnage, and traceability.

**Fix direction.**
1. In `loadHrsSlits`, also select `planned_weight_mt` (and `planned_thk_mm`, `target_width_mm` — see HRS-2).
2. In `spawnChildCoils`, add `planned_weight_mt` to the fallback chain *before* `mother.weight_mt`:
   `actual_weight_mt ?? output_wt_mt ?? planned_weight_mt ?? mother.weight_mt`.
3. Decide the correct default: a child should generally never inherit the whole mother weight; if no per-line weight exists, prefer a proportional split by width (`slit.width_mm / Σ width_mm × mother.weight_mt`) or leave `null` rather than duplicating mother weight. Confirm the desired rule with the plant team.

> **Cursor task — HRS-1**
> In `packages/server/src/modules/m1-collection/consumers/JourneyAdvanceConsumer.ts`:
> (a) Add `planned_weight_mt` to the `.select([...])` in `loadHrsSlits`, and add `planned_weight_mt?: number | string | null` to the `SlitSlotRow` interface.
> (b) In `spawnChildCoils`, change the `wt` fallback to use `planned_weight_mt` before `mother.weight_mt`. If neither a measured nor planned weight exists, set `weight_mt` to a width-proportional share of the mother weight (compute Σ of `width_mm` across the passed `slits` once, guard divide-by-zero) instead of the full mother weight.
> Add/extend a unit test asserting that slitting a mother into N lines produces child weights summing to ≈ mother weight (not N× mother weight).

---

## HRS-2 🔴 Child thickness ignores planned thickness

**Root cause.** In `spawnChildCoils` (~L281):

```ts
const thk = slit.thk_latest_mm ?? slit.thk_id_mm ?? slit.actual_thk_front_mm ?? slit.thk_mm;
```

`loadHrsSlits` never selects `planned_thk_mm`, and `saveHrs` writes `thk_mm: null` and `thk_id_mm: null` (retired columns). So unless the operator entered a live thickness reading (`thk_latest_mm`), `thk` resolves to `undefined` and the child inherits `mother.coil_thk_mm` — wrong for a slitting step where the plan carries the intended output thickness.

**Fix direction.** Select `planned_thk_mm` in `loadHrsSlits` and insert it into the fallback chain: `thk_latest_mm ?? planned_thk_mm ?? mother.coil_thk_mm`.

> **Cursor task — HRS-2**
> In `JourneyAdvanceConsumer.ts`: add `planned_thk_mm` to `loadHrsSlits` select and to `SlitSlotRow`; update the `thk` fallback in `spawnChildCoils` to `slit.thk_latest_mm ?? slit.planned_thk_mm ?? slit.thk_id_mm ?? slit.actual_thk_front_mm ?? slit.thk_mm ?? mother.coil_thk_mm`. Remove the now-dead `thk_mm`/`thk_id_mm` selects only after confirming no other consumer relies on them (see HRS-8).

---

## HRS-3 🟠 Scrap % denominator mismatch (client vs server)

**Root cause.**
- Client (`HrsSlitBuilder.tsx` ~L148): `calculateScrapPct(scrapMt, motherWt || producedMt)` → denominator = **mother input weight**.
- Server (`JourneyAdvanceConsumer.ts` ~L458): recomputes `calculateScrapPct(scrap_mt, weight_mt)` where `weight_mt` = **produced Σ plan output**, then overwrites `txn.prod_hrs.scrap_pct`.

`calculateScrapPct(scrap, total) = scrap/total×100` (`calculationEngine.ts` L7). Output < input, so the server's denominator is smaller → it stores a **higher** scrap % than the operator saw, and silently overwrites the submitted value. Two sources of truth disagree.

**Fix direction.** Pick one denominator (mass-balance convention is usually `scrap / mother_input × 100`) and use it in **both** places. Recommended: server recompute uses `mother_coil_weight_mt` as the base; client already uses mother weight — align both to mother weight and keep the server recompute as the authority.

> **Cursor task — HRS-3**
> In `JourneyAdvanceConsumer.ts` `handleCaptured` HRS branch (~L456–464), change the scrap recompute base from `entry.weight_mt` to `entry.mother_coil_weight_mt` (fall back to `weight_mt` only if mother weight is null). Confirm `HrsSlitBuilder.tsx` uses the same base (it already does via `motherWt`). Add a test locking the denominator.

---

## HRS-4 🟠 Fan-out + journey creation is not atomic or idempotent

**Root cause.** `handleSlittingAdvance` → `spawnChildCoils` (inserts into `coil.coil` and calls `ProcessRouteService.createJourney` per line) → `completeMotherStep`, all as **separate, non-transactional** `db` calls (`JourneyAdvanceConsumer.ts` L328–345). The top-level `isStepCompleted` guard only protects *after* `completeMotherStep` succeeds. If the process crashes or `scheduleRetry` (L477) re-fires between child insert and mother-step completion, `coil.coil` insert is guarded by an existence check but `createJourney` is **not** — a retry can create duplicate journeys for the same child coil.

**Fix direction.**
1. Wrap child-coil insert + journey creation + mother-step completion in a single `db.transaction()`.
2. Make `createJourney` idempotent (skip if an ACTIVE/COMPLETED journey already exists for that child `coil_no`), or guard it with an existence check like the `coil.coil` insert.

> **Cursor task — HRS-4**
> Refactor `handleSlittingAdvance`/`spawnChildCoils`/`completeMotherStep` in `JourneyAdvanceConsumer.ts` to run inside one `db.transaction().execute(trx => …)` and pass `trx` through. Before `ProcessRouteService.createJourney(coilNo, childRoute)`, check for an existing non-terminal journey on that `coil_no` and skip if present. Add a test that fires the same `production.captured` payload twice and asserts exactly one journey and one child coil per slit.

---

## HRS-5 🟡 `forCtlFlag` on HRS lines is dead

**Root cause.** The builder captures `forCtlFlag` per line and `saveHrs` persists `for_ctl_flag` (`ProductionService.ts` ~L138), but the HRS branch of `spawnChildCoils` uses plain `routeAfterStep` and never consults `for_ctl_flag` (only the CRS branch does LE/PKG skipping). So the flag is stored and ignored at HRS.

**Fix direction.** Decide intent: if For-CTL routing is only meaningful at CRS (likely, per the process map), keep the flag as metadata but **document** that it's informational at HRS, and remove the checkbox from the HRS UI to avoid operator confusion — OR wire HRS child-route selection to honor it like CRS. Confirm with plant process owners before changing routing.

> **Cursor task — HRS-5**
> Confirm the intended behavior. If informational-only: add a code comment in `spawnChildCoils` HRS branch stating `for_ctl_flag` is not used for HRS routing, and hide/disable the For-CTL checkbox in `HrsSlitBuilder.tsx`. If it should route: mirror the CRS LE/PKG `SKIPPED`-step logic for HRS child journeys.

---

## HRS-6 🟡 `ensureOrder` insert is type-unsafe

**Root cause.** `HrsOrderService.ensureOrder` (~L198–216) inserts with `as any` and sets both `production_day` and `prod_date` to the same value. The `as any` bypasses Kysely's generated types, so a column rename/drop won't be caught at compile time.

**Fix direction.** Remove `as any`; ensure `db-types.ts` reflects `txn.hrs_order` columns; if both `production_day` and `prod_date` genuinely exist, add a comment on why, otherwise collapse to one.

> **Cursor task — HRS-6**
> Regenerate/verify `packages/server/src/db-types.ts` for `txn.hrs_order`, drop the `as any` in `ensureOrder`, and reconcile `production_day` vs `prod_date` (keep one or document both). Fix any resulting type errors.

---

## HRS-7 🟢 Reading inputs pre-fill the plan value as if measured

**Root cause.** `onAdd` for width and thickness readings seeds the new row with the plan value (`HrsSlitBuilder.tsx` L292, L379: `positiveOrUndef(motherWidth)` / `positiveOrUndef(line.plannedThkMm)`). An operator who taps "Add" and moves on records the plan as a measurement.

**Fix direction.** Seed new reading rows empty (`widthMm: undefined`) so the operator must key an actual value; keep the plan visible as the "Plan …" hint only.

> **Cursor task — HRS-7**
> In `HrsSlitBuilder.tsx`, change the two `onAdd` handlers to push `{ time: formatPlantTime() }` with no numeric value. Verify `buildSlitSlot`/submit still filter empty readings (they do).

---

## HRS-8 🟢 Retired columns still read/written

**Root cause.** `saveHrs` writes `thk_id_mm/thk_centre_mm/thk_od_mm` and per-row `thk_mm` as `null` on every insert; `loadHrsSlits` still selects `thk_mm`/`thk_id_mm`. Harmless but misleading and adds noise.

**Fix direction.** After HRS-1/HRS-2 land, stop selecting the retired columns and drop the `null` writes (leave columns in place / nullable per the migration comment). Low priority; do last.

---

## Suggested order of work

1. HRS-1 and HRS-2 together (same functions, same test) — these are the data-corruption fixes.
2. HRS-3 (scrap denominator) — one-line change plus test.
3. HRS-4 (transaction + idempotency) — structural but important before pilot volume.
4. HRS-6 (type safety) — reduces future breakage.
5. HRS-5, HRS-7, HRS-8 — confirm intent / polish.

## Verification checklist (add to the PR)

- Unit test: N-line slit → Σ child `weight_mt` ≈ mother `weight_mt` (HRS-1).
- Unit test: child `coil_thk_mm` = `planned_thk_mm` when no live reading (HRS-2).
- Unit test: scrap % base is mother weight on both client and server (HRS-3).
- Idempotency test: duplicate `production.captured` → one journey + one child per slit (HRS-4).
- Run: `npm run test -w @m1/server` and `-w @m1/shared-validation`; `npm run lint`; typecheck server after removing `as any` (HRS-6).
- Manual: seed a mother with a multi-line PPC batch, submit HRS, inspect `coil.coil` child rows for correct per-line width/weight/thickness and one journey each.

---

*Audit covers the live `process/`-based HRS implementation. Note: `PROJECT_STRUCTURE.md` describes an older `forms/HRSForm` layout that no longer matches the code — worth updating separately.*
