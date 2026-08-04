# Cursor Prompt — Fix the HRS (HR Slitting) module end-to-end

> Paste everything below into Cursor (Composer / Agent mode, whole-repo context). It is self-contained: context, the exact changes, and acceptance criteria. Work top-to-bottom; each fix has a checkbox. Do **not** change unrelated processes (PKL/CRM/ANN/etc.) except where explicitly noted for shared helpers.

---

## Context you need

This is the ZedralV2 / Hero Steels M1 monorepo (npm workspaces: `@m1/shared-validation`, `@m1/server`, `@m1/client`). **HRS = HR Slitting**: one *mother* coil is slit into N *child* coils (labels A, B, C, …). Each child gets its own width / weight / thickness / route and its own downstream journey.

Runtime path for an HRS capture:

```
HrsSlitBuilder.tsx  (UI)
  → POST /production/hrs                         packages/server/src/modules/m1-collection/routes/productionRoutes.ts
  → ProductionService.saveHrs                    packages/server/src/modules/m1-collection/services/ProductionService.ts
      writes txn.prod_hrs, txn.prod_hrs_slit, txn.prod_hrs_width_reading, txn.prod_hrs_slit_reading
      emits 'production.captured'
  → JourneyAdvanceConsumer.onProductionCaptured  packages/server/src/modules/m1-collection/consumers/JourneyAdvanceConsumer.ts
      loadHrsSlits → spawnChildCoils (insert coil.coil + ProcessRouteService.createJourney) → completeMotherStep
```

Schema: `packages/shared-validation/src/rules/m1Forms.ts` (`hrsSchema`, `hrsSlitSlotSchema`).
DB columns: `packages/server/migrations/1945000000000_hrs_slit_fanout_fields.js` — note `txn.prod_hrs_slit` has `planned_weight_mt`, `actual_weight_mt`, `planned_thk_mm`, `target_width_mm`, `thk_latest_mm`, `hold_flag`, `for_ctl_flag`, `route_raw`.
Order lifecycle: `packages/server/src/services/HrsOrderService.ts`.

Scrap helper: `calculateScrapPct(scrapMt, totalMt) = scrapMt/totalMt*100` in `packages/shared-validation/src/utils/calculationEngine.ts`.

---

## FIX 1 — 🔴 Child coils inherit the mother's FULL weight (data corruption)

**Problem.** `ProductionService.saveHrs` stores each slit's `planned_weight_mt` but always writes `actual_weight_mt: null`. In `JourneyAdvanceConsumer.spawnChildCoils` the weight fallback is:

```ts
const wt = slit.actual_weight_mt != null
  ? Number(slit.actual_weight_mt)
  : slit.output_wt_mt != null ? Number(slit.output_wt_mt)
  : mother.weight_mt;
```

For HRS, `actual_weight_mt` is always null and `output_wt_mt` is never selected in `loadHrsSlits`, so **every child coil is minted with `mother.weight_mt`**. A 20 MT mother slit into 4 children creates 4×20 = 80 MT of stock. Corrupts mass balance, DPR tonnage, and traceability.

**Do this in `packages/server/src/modules/m1-collection/consumers/JourneyAdvanceConsumer.ts`:**

- [ ] Add `planned_weight_mt` and `planned_thk_mm` (needed by FIX 2) to the `.select([...])` in `loadHrsSlits`.
- [ ] Add `planned_weight_mt?: number | string | null;` and `planned_thk_mm?: number | string | null;` to the `SlitSlotRow` interface.
- [ ] In `spawnChildCoils`, before the per-slit loop compute the total planned width for proportional fallback:
  ```ts
  const totalWidth = slits.reduce((s, x) => s + (x.width_mm != null ? Number(x.width_mm) : 0), 0);
  ```
- [ ] Replace the `wt` derivation with (measured → planned → width-proportional share of mother; never the whole mother weight):
  ```ts
  const measuredWt = slit.actual_weight_mt != null ? Number(slit.actual_weight_mt)
    : slit.output_wt_mt != null ? Number(slit.output_wt_mt)
    : null;
  const plannedWt = slit.planned_weight_mt != null ? Number(slit.planned_weight_mt) : null;
  const shareWt = (totalWidth > 0 && slit.width_mm != null && mother.weight_mt != null)
    ? (Number(slit.width_mm) / totalWidth) * Number(mother.weight_mt)
    : null;
  const wt = measuredWt ?? plannedWt ?? shareWt ?? null;
  ```
  (If your `coil.coil.weight_mt` is NOT NULL, fall back to `mother.weight_mt` only as the last resort and add a `// TODO` comment; otherwise leave `null`.)

**Acceptance:** slitting a 20 MT mother into 4 lines of 5 MT each ⇒ four child coils whose `weight_mt` sum ≈ 20 (not 80).

---

## FIX 2 — 🔴 Child thickness ignores planned thickness

**Problem.** In `spawnChildCoils`: `const thk = slit.thk_latest_mm ?? slit.thk_id_mm ?? slit.actual_thk_front_mm ?? slit.thk_mm;`. `loadHrsSlits` never selects `planned_thk_mm`, and `saveHrs` writes `thk_mm`/`thk_id_mm` as null. So without a live reading the child inherits `mother.coil_thk_mm` instead of the plan's intended output thickness.

**Do this (same file):**

- [ ] `planned_thk_mm` is already added to the select/interface in FIX 1.
- [ ] Change the `thk` chain to:
  ```ts
  const thk = slit.thk_latest_mm ?? slit.planned_thk_mm ?? slit.thk_id_mm ?? slit.actual_thk_front_mm ?? slit.thk_mm;
  ```
  (The insert already does `coil_thk_mm: thk ?? mother.coil_thk_mm`, so mother stays the last resort.)

**Acceptance:** with no live thickness reading but `planned_thk_mm = 2.5`, the child coil `coil_thk_mm = 2.5`.

---

## FIX 3 — 🟠 Scrap % denominator mismatch (client vs server)

**Problem.** Client (`HrsSlitBuilder.tsx`) computes `calculateScrapPct(scrapMt, motherWt || producedMt)` — base = **mother weight**. The consumer (`JourneyAdvanceConsumer.handleCaptured` HRS branch) recomputes `calculateScrapPct(scrap_mt, weight_mt)` where `weight_mt` = produced Σ output, then **overwrites** `txn.prod_hrs.scrap_pct`. Output < input ⇒ server stores a higher, inconsistent scrap %.

**Do this in `JourneyAdvanceConsumer.ts`, HRS branch of `handleCaptured`:**

- [ ] Change the recompute base to the mother weight:
  ```ts
  if (code === 'HRS') {
    const entry = await loadHrsEntry(entryId);
    const base = entry?.mother_coil_weight_mt != null ? Number(entry.mother_coil_weight_mt)
      : entry?.weight_mt != null ? Number(entry.weight_mt) : null;
    if (entry?.scrap_mt != null && base != null && base > 0) {
      const derived = calculateScrapPct(Number(entry.scrap_mt), base);
      await db.updateTable('txn.prod_hrs').set({ scrap_pct: derived }).where('entry_id', '=', entryId).execute();
    }
    await handleSlittingAdvance(coilNo, 'HRS', entryId);
    return;
  }
  ```
- [ ] Confirm `HrsSlitBuilder.tsx` keeps `motherWt` as the denominator (it does) so client and server agree.

**Acceptance:** for mother 20 MT, scrap 1 MT ⇒ `scrap_pct = 5.00` on both client display and stored row.

---

## FIX 4 — 🟠 Fan-out + journey creation is not atomic or idempotent

**Problem.** `handleSlittingAdvance → spawnChildCoils (insert coil + createJourney per line) → completeMotherStep` are separate non-transactional calls. The `coil.coil` insert is guarded by an existence check, but `ProcessRouteService.createJourney` is **not** — a `scheduleRetry` re-fire between spawn and mother-step completion can create duplicate journeys for the same child coil.

**Do this in `JourneyAdvanceConsumer.ts`:**

- [ ] Wrap `spawnChildCoils` + `completeMotherStep` for the slitting path in a single `db.transaction().execute(async (trx) => { … })` and thread `trx` through both functions (replace `db.` with the passed `trx.` inside them).
- [ ] Before calling `ProcessRouteService.createJourney(coilNo, childRoute)`, check for an existing non-terminal journey and skip if present:
  ```ts
  const existingJourney = await trx.selectFrom('planning.order_journey')
    .select('journey_id').where('coil_no', '=', coilNo)
    .where('status', 'in', ['ACTIVE', 'HOLD', 'COMPLETED'])
    .executeTakeFirst();
  if (!existingJourney) await ProcessRouteService.createJourney(coilNo, childRoute /*, trx if supported */);
  ```
  If `createJourney` can accept a transaction, pass it; if not, note it and keep the guard.

**Acceptance:** firing the same `production.captured` payload twice yields exactly one child coil and one journey per slit (see TEST 2).

---

## FIX 5 — 🟡 `forCtlFlag` on HRS lines is captured but never used

**Problem.** The builder captures and `saveHrs` persists `for_ctl_flag`, but the HRS branch of `spawnChildCoils` uses plain `routeAfterStep` and never consults it (only CRS does LE/PKG routing). For-CTL is only meaningful at CRS in this plant's process map.

**Do this (choose the documented default — informational at HRS):**

- [ ] In `spawnChildCoils`, HRS branch, add a comment: `// for_ctl_flag is informational at HRS; For-CTL routing is decided at CRS.`
- [ ] In `packages/client/src/components/process/bodies/HrsSlitBuilder.tsx`, remove the per-line **For-CTL** checkbox (keep HOLD). Keep the `forCtlFlag` field in the payload defaulting to `false` so the schema/DB are unaffected.

**Acceptance:** HRS capture UI shows HOLD only; submitting still succeeds; `for_ctl_flag` defaults false.

---

## FIX 6 — 🟡 `HrsOrderService.ensureOrder` is type-unsafe

**Problem.** The insert into `txn.hrs_order` uses `as any` and sets both `production_day` and `prod_date`. `as any` hides column drift from the compiler.

**Do this in `packages/server/src/services/HrsOrderService.ts`:**

- [ ] Ensure `packages/server/src/db-types.ts` has correct `txn.hrs_order` columns (regenerate with the repo's kysely-codegen script if present).
- [ ] Remove the `as any` on the `ensureOrder` insert. Reconcile `production_day` vs `prod_date`: keep the one the schema actually has; if both exist, add a one-line comment explaining why. Fix any resulting type errors without `as any`.

**Acceptance:** `HrsOrderService.ts` compiles with no `as any` on the insert; `npm run build -w @m1/server` (or typecheck) is clean.

---

## FIX 7 — 🟢 Reading rows pre-fill the plan value as a "measurement"

**Problem.** In `HrsSlitBuilder.tsx` the "Add width reading" / "Add thickness reading" handlers seed the new row with the plan value (`positiveOrUndef(motherWidth)` / `positiveOrUndef(line.plannedThkMm)`), so an operator can record the plan as an actual.

**Do this in `HrsSlitBuilder.tsx`:**

- [ ] Change both `onAdd` handlers to push a row with only the time and no numeric value, e.g. `{ time: formatPlantTime() }` (width/thk left `undefined`). The plan stays visible via the existing "Plan …" hint. `buildSlitSlot`/submit already drop empty readings.

**Acceptance:** tapping "Add …" produces an empty value field; submitting without keying a value does not persist a reading.

---

## FIX 8 — 🟢 Retired columns still read/written (cleanup — do last)

**Problem.** `saveHrs` writes `thk_id_mm/thk_centre_mm/thk_od_mm` and per-row `thk_mm` as `null` every insert; `loadHrsSlits` still selects `thk_mm`/`thk_id_mm`.

**Do this only after FIX 1–2 are green:**

- [ ] Stop selecting `thk_mm`/`thk_id_mm` in `loadHrsSlits` (they're superseded by `thk_latest_mm`/`planned_thk_mm`). Leave the columns in the DB (nullable). Remove the constant `null` writes in `saveHrs` for the retired triple only if nothing else references them (grep first).

**Acceptance:** no behavior change; fewer dead fields.

---

## FIX 9 — 🟡 Duplicate HRS schemas (drift) + weak test coverage

**Problem.** Two parallel HRS schemas exist: `HRSSchema`/`SlitSlotSchema` in `fieldRules.ts` (legacy A–D, what the property tests import) and `hrsSchema`/`hrsSlitSlotSchema` in `m1Forms.ts` (dynamic 12-slot, what the `/production/hrs` route uses). The tests validate the schema the runtime does **not** use, and nothing tests the fan-out.

**Do this:**

- [ ] Add a short comment at the top of the legacy `HRSSchema` in `fieldRules.ts` marking it deprecated and pointing to `m1Forms.ts hrsSchema` as the runtime schema. (Do not delete yet — other tests import it.)
- [ ] Add the two tests below.

### TEST 1 — child weights sum to the mother (proves FIX 1/2)
Add `packages/server/tests/hrsFanOut.integration.test.ts` (mirror the style of existing server integration tests / use the same test DB harness):
- Seed a mother coil `weight_mt = 20`, `coil_thk_mm = 3.0`, an ACTIVE journey, and 4 slit rows with `planned_weight_mt = 5`, `planned_thk_mm = 2.5`, distinct `slot` A–D, `width_mm` equal.
- Invoke the HRS capture path (`ProductionService.saveHrs` then drive `JourneyAdvanceConsumer` on the emitted event, or call the exported handler directly).
- Assert: 4 child `coil.coil` rows exist with `parent_coil_no = mother`; `Σ weight_mt ≈ 20`; each `coil_thk_mm = 2.5`; one journey per child.

### TEST 2 — idempotent re-fire (proves FIX 4)
- Fire the same `production.captured` payload twice; assert exactly one child coil and one journey per slit.

### TEST 3 — real `flagsFromRoute` import (hardening)
- `server/tests/hrsRouteFlags.unit.test.ts` currently re-implements `flagsFromRoute` locally. Export the real `flagsFromRoute` from `HrsSlitBuilder.tsx` (or extract it to a shared util) and import it in the test so the test guards the actual code.

---

## Global acceptance / run before you finish

- [ ] `npm run lint`
- [ ] `npm run test -w @m1/shared-validation`
- [ ] `npm run test -w @m1/server` (all HRS tests incl. the 3 new ones green)
- [ ] Typecheck/build server clean (no new `as any`): `npm run build -w @m1/server`
- [ ] Manual smoke: seed a mother with a multi-line PPC batch → submit HRS in the UI → inspect `coil.coil` children for correct per-line width, weight, thickness, and one journey each; confirm `scrap_pct` matches the operator's displayed value.

## Constraints

- Keep child coil numbers **derived** (`${motherCoilNo}-${slot}`) — never trust a free-typed value (existing code already warns on mismatch; preserve that).
- Preserve HOLD behavior: a held slit mints a `coil.coil` row with status `HOLD` and does **not** spawn a journey.
- Do not alter PKL/CRM/ANN/SKP/RWD/CRS/CTL save logic except the shared `spawnChildCoils`/`loadHrsSlits` changes, and there only in ways that keep CRS behavior identical.
- Make the smallest change that satisfies each acceptance check; add tests alongside each fix.
