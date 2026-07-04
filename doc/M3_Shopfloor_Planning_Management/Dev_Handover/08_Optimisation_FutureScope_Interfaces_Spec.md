# M3 · 08 — Optimisation / AI — Future-Scope Interfaces Spec
**Deep-plan ref:** §8. **Status:** interfaces & data hooks only — **no v1 build** (D9; operating-model post-6-month → prescriptive horizon, gated on data). This mirrors M2's predictive spec: future-proof now, build later, no re-model.

## 1. What is deferred
| Capability | v1 (built) | Future (this spec) |
|---|---|---|
| Sequencing | deterministic rules + manual resequence (spec 03) | **mathematical optimisation**: minimise setup+tardiness+WIP (MILP / metaheuristics, e.g. OR-Tools) |
| Demand | ingest / simple consumption | **ML demand forecasting** (seasonality/trend) → MPS |
| Re-scheduling | planner re-runs on disruption | **automated reactive re-schedule** within guardrails |
| Decision support | KPIs + alerts (descriptive/diagnostic) | **prescriptive** ("run this sequence; expedite order X"), 2–3 yr |

## 2. Why v1 is already the substrate (no re-model)
The optimiser's inputs **already exist** from day one: `setup_matrix` (transition costs), `work_center_capacity` (constraints), `routing_operation` (times), `production_order` (due/priority), `canon.cost_rate` (objective coefficients), and — critically — `production_confirmation.setup_minutes`/`run_minutes` (the **actuals** that calibrate standards and become training/validation data). Switching optimisation on is wiring an engine to existing tables, not migrating data.

## 3. Interface stubs (defined, not implemented)
- `POST /optimise/schedule` → same contract as `/schedule/run` but returns an objective-minimising sequence + objective value; behind `planning_config.optimiser_enabled`.
- `GET /optimise/readiness?work_center` → the **optimisation-readiness gate**.
- `POST /forecast/run` → ML demand forecast → `demand_forecast` (source tagged `MODEL`).
- Feature store (Feast) + model registry (MLflow) reserved (platform stack).

## 4. Optimisation-readiness gate (History sub-gate)
Extends the platform readiness model (doc 01 §16). Per work centre, report whether there is **enough confirmed run/setup history** to trust an auto-schedule (e.g. ≥ N weeks of confirmations covering the product/transition mix). The UI shows "optimisation available for these work centres" — honest readiness, **no v1 optimisation promise**. Threshold = open decision (spec 00 §8).

## 5. Acceptance criteria (for the v1 stubs)
- **MUST** gate all optimiser endpoints behind `optimiser_enabled=false` by default (return 501/not-enabled).
- **MUST NOT** require any schema change to enable optimisation later (validated by review against `M3_schema.sql`).
- **MUST** persist actual setup/run minutes on every confirmation (the calibration data) from v1.
- **SHOULD** expose the readiness gate read-only in v1 so the roadmap is visible without promising delivery.
