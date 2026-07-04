# M4 · 04 · Loss Taxonomy & Reason Codes
**Deep-plan:** §6 · **Build phase:** M4-2

## 1. The loss tree (the product)
Every lost minute/unit decomposes into exactly one of the **Six Big Losses**, each mapped to one OEE component:
| OEE component | Big Loss (`oee.big_loss`) | Carrier |
|---|---|---|
| Availability | `L1_BREAKDOWN` (unplanned) | `DowntimeEvent` is_planned=false |
| Availability | `L2_SETUP` (changeover/adjust) | `DowntimeEvent` is_planned=true |
| Performance | `L3_MINOR_STOP` (idling/small stops) | `state_interval` is_micro_stop |
| Performance | `L4_REDUCED_SPEED` | count vs ideal-cycle gap |
| Quality | `L5_DEFECT` (steady-state) | `ProductionCount` scrap/rework |
| Quality | `L6_STARTUP_YIELD` | run-up/transition window |

The tree **closes**: Σ Availability-loss minutes = PPT − Operating; Σ Performance loss = Operating − Net; Σ Quality loss = Net − Valuable. A reconciliation test asserts the leaves sum to the factor gaps (spec 06).

## 2. The 3-layer reason hierarchy (operator-first)
- **Layer 1 — category** (6–8 max): Mechanical, Electrical, Material, Changeover, Operator/Process, Utility, Quality, Planned. Selectable in 2–3 s; minimum-viable data even if the shift ends here.
- **Layer 2 — equipment/subsystem** (15–25 per category, filtered by L1): e.g. Mechanical → roll / bearing / drive / hydraulics.
- **Layer 3 — root-cause detail**: optional for stops <15 min, required ≥15 min.
Rules enforced: **no level shows >15–20 options**; reasons describe the **observed symptom, not the diagnosis** (root-cause is M2's job on the same event); **6–12 active reasons per asset** is the target.

## 3. Canonical mapping
Each `canon.reason_code` carries `loss_category_ref` (→ Six Big Losses) and `oee_component` (A/P/Q). Seeded by the **OEE sector template** (Manifold), tunable per tenant. This mapping is what lets a breakdown and a changeover be told apart inside Availability and what makes the tree close.

## 4. "All Other" governance
Exactly **one** unclassified reason exists. A scheduled job checks its share; when it enters the **top-loss Pareto or exceeds ~10%**, M4 raises an **"Other is now a top loss — refine it"** prompt and flags `top_loss.is_other_bucket=true`. The CI engineer then splits it into specific codes with the crew. This keeps the Pareto actionable and prevents the "miscellaneous black hole."

## 5. Pareto (by minutes AND by cost)
`oee.top_loss` is computed per scope (asset/line/plant) and period for **two `rank_basis` values: MINUTES and COST** — because the biggest *time* loss and the most *expensive* loss are often different events, and the executive wants the second. Cost uses `loss_attribution.lost_cost` (priced via `canon.cost_rate`, D7).

## 6. Acceptance (MUST)
- L-01 Every active reason maps to exactly one loss category and one OEE component.
- L-02 Leaf losses reconcile to the A/P/Q factor gaps within rounding (closure test).
- L-03 No reason level presents >20 options; L1 has ≤8 categories.
- L-04 The "All Other" share is monitored; exceeding threshold raises the refine prompt and sets `is_other_bucket`.
- L-05 Pareto exists for both MINUTES and COST and ranks consistently with `loss_attribution`.
