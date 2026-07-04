# M5 · 04 · Loss Taxonomy & Reason Codes Spec
**Deep-plan:** §2, §6 · **Standards:** ISO 22400 quantity classes, TPM Six Big Losses (L5/L6), steel yield-loss anatomy

## 1. Three-layer reason hierarchy (operator-first, mirrors M4)
```
Layer 1 · Loss category (fast tap; 6–8 max):
  Crop · Scale · Trim · Transition · Cobble · Dimensional · Rework · Sampling/Other
Layer 2 · Sub-cause (filtered by parent; 15–25):
  e.g. Dimensional → off-gauge / off-profile / surface / edge-crack
Layer 3 · Root-cause detail (optional small loss, required large loss):
  e.g. surface → roll-mark / scale-pit / scratch
```
- 6–8 top categories; ≤15–20 options per level, parent-filtered; **6–12 active reasons per work-unit** is the sweet spot.
- **Capture the symptom, not the diagnosis** (defect root-cause is M6's job on the same record).
- Layer-1 alone = minimum-viable data even if detail is never entered.

## 2. Canonical mapping (the bit that makes losses add up)
Every leaf reason carries four canonical attributes:

| Attribute | Values | Purpose |
|---|---|---|
| `loss_category_ref` | yield-loss category | the bridge bucket |
| `quantity_class` | GOOD / SCRAP / PLANNED_SCRAP / REWORK / BYPRODUCT | ISO 22400 quantity it feeds |
| `recoverability` | PURE_LOSS / SALVAGE / RECOVERABLE | the economics (spec 06) |
| `big_loss` | L5_DEFECT / L6_STARTUP_YIELD / L1_BREAKDOWN_LINKED | TPM split + M4 handoff |

This closes the books: Σ(scrap by reason) + Σ(rework) + by-product + ΔWIP + gap = Input − Good, **and** lets M5's Quality-loss reconcile to M4's Quality factor (same units, one mapping).

## 3. Steel yield-loss anatomy (seed for the sector template)
Indicative share of total yield loss (bar/long-product; cold-rolling adds trim/transition):

| Category | Typical share | Quantity class | Big loss | Recoverability |
|---|---|---|---|---|
| Crop (head/tail) | 40–50% | PLANNED_SCRAP (std) / SCRAP (excess) | L6 | SALVAGE |
| Cobbles & stoppages | 15–25% | SCRAP | L1/L5 | SALVAGE |
| Dimensional/quality | 10–20% | SCRAP / REWORK | L5 | SALVAGE/RECOVERABLE |
| Scale & oxidation | 8–12% | SCRAP | L6 | PURE_LOSS |
| Scarfing/conditioning | 5–10% | PLANNED_SCRAP | L6 | SALVAGE |
| Sampling/test | 2–4% | PLANNED_SCRAP | L6 | PURE_LOSS |
| Side trim / edge (cold) | varies | PLANNED_SCRAP | L6 | SALVAGE |
| Transition / grade-change (cold) | varies | SCRAP | L6 startup | SALVAGE/downgrade |

## 4. "Other / unclassified" governance
Exactly **one** Other reason exists. When it climbs into the loss-bridge top-3 or above ~10% of loss, M5 emits an `m5.other_bucket_now_top_loss` event → UI prompt *"split your Other bucket."* This is the primary defence against an unactionable Pareto.

## 5. Pareto / loss bridge ranking
Rank losses **by mass, by units, and by cost** (`top_loss.rank_basis`) — they rank differently (a high-tonnage crop may cost less than a small transition of premium grade). The executive view defaults to **cost**, with **avoidable** loss only (PSQ excluded) when `yield_config.report_avoidable_only = TRUE`.
