# M5 · 06 · KPIs, Analytics & Financial Impact Spec
**Deep-plan:** §9, §12 · **Standards:** ISO 22400-2 · **Decision:** D6 (Standard tier), D7 (rate-as-of)

## 1. KPI registry contributions (reconciled to platform ISO 22400)
| KPI | Formula | Notes |
|---|---|---|
| Material / mass yield | 100·good_mt/input_mt | headline (steel ~92–98% by product) |
| First-Pass Yield (FPY) | 100·good_first_time/started | per step |
| Rolled-Throughput Yield (RTY) | ∏ FPYᵢ | multi-step; exposes compounding |
| Quality Ratio | 100·GQ/PQ | **reconciles to M4 Quality factor** |
| Scrap Ratio | 100·SQ/PQ | bad-product rate |
| Rework Ratio | 100·RQ/PQ | recoverable-loss rate |
| Avoidable yield loss | actual_loss − PSQ | the honest opportunity |
| Reconciliation gap | 100·\|Input−accounted\|/Input | data-trust meter (≤1–2%) |
| Cost of yield loss | Σ(loss_mt·(std_cost−salvage)+rework_cost) | the € the bridge is worth |

## 2. Rollup SQL (SUM-then-divide; never average sub-yields)
```sql
SELECT work_unit_ref, material_ref,
       100.0 * SUM(good_mt) / NULLIF(SUM(input_mt),0) AS material_yield_pct,
       100.0 * SUM(scrap_mt) / NULLIF(SUM(good_mt+scrap_mt+rework_mt),0) AS scrap_ratio_pct,
       SUM(avoidable_loss_mt) AS avoidable_loss_mt
FROM "yield".yield_interval
WHERE bucket_start >= :from AND bucket_start < :to
GROUP BY work_unit_ref, material_ref;
```
RTY is **not** computed this way — it multiplies per-step FPY across the genealogy (rollup job), written to `yield_interval.rty_pct`.

## 3. Financial Impact — the "hits-twice" model (Principle 5)
A lost tonne loses the **sale** *and* the **sunk conversion cost** (material, energy, labour, overhead already spent); the marginal cost of a *recovered* tonne is ~zero, so recovered yield flows almost directly to profit.

```
net_loss_cost = standard_cost            -- lost margin + sunk conversion (hits twice)
              - salvage_value            -- scrap recovery (if net_salvage=TRUE)
              + rework_cost              -- added cost where recoverable
```
- `standard_cost`, `salvage_value`, rework rate come from `canon.cost_rate` (D7, **rate-as-of-event** provenance) — never hard-coded.
- Recoverability drives the formula: PURE_LOSS (no salvage), SALVAGE (net scrap value), RECOVERABLE (rework cost added, material recovered).
- **Scale check (industry):** a 2-pt yield gain on a 500 kt/yr line ≈ €4–7M/yr profit — much of it low/zero-capex (batch sizing, sequencing, crop optimisation). Rank the bridge by **money**, avoidable only.

## 4. Cross-module reconciliation tests (must pass)
| Test | Assertion |
|---|---|
| **M5 ↔ M4** | M5 Quality Ratio (GQ/PQ at a work-unit) == M4 OEE Quality factor on the same ProductionCount, same window (±rounding) |
| **M5 ↔ M6** | Σ M5 loss attributed to defect-driven reasons == Σ material of M6 dispositions (scrap+rework+downgrade) for the same DefectRecords |
| **Mass balance** | input_mt == good+scrap+rework+byproduct+ΔWIP+gap, gap ≤ tolerance for CLOSED |
| **No double-count** | every loss_attribution row maps to exactly one production_count_id |

## 5. Analytics surfaces (D6 Standard tier)
Loss bridge/waterfall; Sankey (input→outputs+losses); yield heatmaps (grade×shift, work-unit×shift); **supplier-lot yield spread**; transition/startup-loss deep-dive (ties to M3 sequencing); avoidable-loss Pareto by €. Yield-by-everything sliced from `loss_attribution` (step/grade/lot/shift/crew/supplier-lot).
