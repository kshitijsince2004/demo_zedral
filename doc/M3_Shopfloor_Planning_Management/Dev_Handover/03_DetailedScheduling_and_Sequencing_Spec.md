# M3 · 03 — Detailed Scheduling & Sequencing Spec (M3b)
**Deep-plan ref:** §6. **Standards:** APS / finite-capacity scheduling; ISA-95 "detailed production scheduling"; steel cold-rolling campaign rules.

## 1. Job
Turn firmed/released `planned_order`/`production_order` rows into an **executable finite-capacity sequence** (`schedule_entry`) per work centre, respecting capacity, material readiness, and **sequence-dependent setup**, minimising **setup + tardiness + WIP**.

## 2. Inputs
- Open orders + due dates + priority (`production_order`).
- Routing (`routing_operation`: WC, run-min/unit, std setup).
- Capacity supply (`work_center_capacity` by shift/period, efficiency).
- **Setup matrix** (`setup_matrix`: from_state→to_state minutes/cost, `is_forbidden`).
- Constraints: **M2 PM windows** (don't schedule on an asset in PM), **M4 live state** (resource down), material availability.

## 3. Algorithm (v1 — deterministic, rule-based)
1. **Filter** to schedulable operations (materials ready, predecessor done).
2. **Prioritise** by due date / priority (EDD default; critical-ratio optional).
3. **Sequence within a work centre** applying campaign rules: order by the setup-minimising attribute progression, honouring `is_forbidden` transitions; compute each entry's `setup_minutes` from `setup_matrix` given its predecessor's `to_state`.
4. **Place in time** forward (from now) or backward (from due) across `work_center_capacity` buckets; respect grain (`planning_config.schedule_grain` = WORK_CENTER_SHIFT | MACHINE_MINUTE).
5. **Detect overload / late** → flag; expose for planner override (drag-to-resequence).
6. **Commit**: set `status='COMMITTED'`, `scenario_tag=NULL`. Prior committed rows for the horizon → `SUPERSEDED`.

## 4. Steel cold-rolling campaign rules (Hero Steels seed template)
Encoded as `setup_matrix` + sequence policy on the mill/rolling work centres:
- **Width: wide → narrow** within a campaign (a wider coil marks the rolls and scratches subsequent narrower coils).
- **Width increase forces a roll change** → high `setup_minutes`/`setup_cost`, or `is_forbidden=true` without an explicit roll-change entry.
- **Gauge & hardness** progress smoothly (small step penalties).
- Annealing furnaces scheduled by **charge** (`capacity_basis='FURNACE_CHARGE'`, `available_qty`), not minutes.
Other sectors supply their own `setup_matrix` + policy; the engine is unchanged (deep-plan §10).

## 5. What-if & re-scheduling
- **What-if**: write candidate `schedule_entry` rows under a `scenario_tag`; compare KPI deltas (setup total, tardy count, utilisation) before commit.
- **Reactive**: on breakdown / material short / hot order, re-run for the affected work centre(s) only; planner confirms. (Automated reactive re-schedule = future, spec 08.)

## 6. Interfaces
- `POST /schedule/run?work_center&horizon[&scenario_tag]` → schedule + KPI summary.
- `POST /schedule/commit` / `POST /schedule/{id}/move` (manual resequence).
- `GET /schedule/dispatch-list?work_center&shift` → `v_dispatch_list`.
- `GET /schedule/whatif/compare?a&b` → KPI delta.

## 7. Acceptance criteria
- **MUST** never exceed `work_center_capacity` in a committed schedule (finite-capacity guarantee).
- **MUST** compute `setup_minutes` from `setup_matrix` and never emit a `is_forbidden` transition uncosted.
- **MUST** treat M2 PM windows and M4 down-state as hard unavailability.
- **MUST** keep what-if (`scenario_tag` ≠ NULL) out of the committed dispatch list.
- **SHOULD** reproduce the steel wide→narrow campaign on the Hero Steels seed in an acceptance test.
- **SHOULD** store actual setup from confirmations (spec 04) to calibrate the matrix (feeds spec 08).
