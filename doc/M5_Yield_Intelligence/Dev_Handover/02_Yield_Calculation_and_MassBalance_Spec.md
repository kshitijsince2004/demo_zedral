# M5 · 02 · Yield Calculation & Mass Balance Spec
**Deep-plan:** §2, §4, §7 · **Standards:** ISO 22400-2 (quantities & ratios), Lean (FPY→RTY), conservation of mass

## 1. Quantities (ISO 22400-2, the platform's ratified definitions)
Every quantity is tagged with **basis** (MASS in MT / COUNT in units) and **disposition**:

| Symbol | Quantity | Source |
|---|---|---|
| IQ | Input Quantity (raw issued − returns ± ΔRaw) | M1 charge/coil weight, ERP issues |
| PQ | Produced Quantity (good + scrap + rework) | `canon.production_count.total` / weight |
| GQ | Good Quantity (meets spec first time) | `production_count.good` |
| SQ | Scrap Quantity | `production_count.scrap` |
| PSQ | Planned Scrap Quantity (expected) | `expected_yield_factor.planned_scrap_pct` |
| RQ | Rework Quantity (recoverable) | `production_count.rework` |
| BP | By-product / co-product (salvage value) | weight + cost-rate |

## 2. Dual-basis yield formulas (both computed; user scoping = equal weight)

```
material_yield_pct = 100 * good_mt / input_mt
fpy_pct            = 100 * good_units_first_time / started_units      -- per step
rty_pct            = PRODUCT( fpy_step_i )  over genealogy steps      -- multi-step
quality_ratio_pct  = 100 * GQ / PQ          -- reconciles to M4 Quality factor
scrap_ratio_pct    = 100 * SQ / PQ
rework_ratio_pct   = 100 * RQ / PQ
avoidable_loss     = actual_loss - planned_scrap(PSQ)
```

**Critical: two roll-up algebras, never confused.**
- **Material yield / ratios roll up by SUM-then-divide** — sum input/good/scrap quantities to the target grain, then divide (view `v_yield_rollup`). Never average sub-yields (Simpson's paradox).
- **RTY rolls up by PRODUCT of per-step FPY** — that is its definition. Computed by the rollup job over the genealogy chain, written to `yield_interval.rty_pct`.

**Why both bases (deep-plan Principle 3):** a coil can pass as one good unit (FPY≈100%) while losing 4% of mass to crop/scale (material yield 96%); a batch can hold mass while a third of pieces are reworked. Compute and store both; never let one stand in for the other.

## 3. Mass balance — the close (Mass-Balance Resolver)
For every lot and window:

```
input_mt = good_mt + scrap_mt + rework_mt + byproduct_mt + dwip_mt + gap_mt
gap_pct  = 100 * abs(gap_mt) / input_mt
status   = CLOSED      if gap_pct <= recon_tolerance_pct      (default 2%)
           PROVISIONAL if gap_pct  > tolerance (await more data)
           DEVIATION   if gap_pct  > 2x tolerance OR drifting  (data-quality)
```

**Gate (Principle 4):** only a `CLOSED` balance produces a *trusted* yield interval. A `DEVIATION` window is published as provisional and its gap is routed to data-quality (scale drift / unrecorded movement / wet-dry basis mismatch) — **it is never poured into the loss bridge as if it were yield loss.** This is what lets finance trust yield against material purchased.

## 4. Expected yield (avoidable-loss reference)
`expected_yield_factor` keyed by route×grade×work-unit, versioned, `is_calibrated` flag. Three population paths: (a) METALLURGICAL_STD, (b) DEMONSTRATED_BEST (e.g. 90th-percentile sustained), (c) M3_PLAN_FACTOR. `avoidable_loss = actual_loss − planned_scrap`. Any work-unit whose avoidable loss rests on an **uncalibrated** factor is flagged in the Fidelity gate (spec 03/09) so yield is never judged against a guess.

## 5. Worked example (Hero Steels cold mill, one shift, grade X)
```
input_mt = 500.00 (incoming HR coil)
good_mt  = 480.00 ; scrap_mt = 14.00 ; rework_mt = 4.00 ; byproduct_mt = 1.50 ; dwip_mt = 0.00
gap_mt   = 500.00 - (480 + 14 + 4 + 1.5 + 0) = 0.50  → gap_pct = 0.10%  → CLOSED
material_yield = 100*480/500 = 96.000%
planned_scrap (PSQ standard crop+trim) = 2.5% of 500 = 12.50 mt
actual_loss = 500-480 = 20.00 mt ; avoidable_loss = 20.00 - 12.50 = 7.50 mt
```
The 7.50 mt avoidable is the Pareto/Financial target — the 12.50 mt PSQ is reported but not flagged as an opportunity.

## 6. Recompute & determinism
All intervals/balances are **replayable** from canonical events: a corrected scrap reason or weight re-derives affected balances, intervals, attributions and bridges with no manual patching (spec 05).
