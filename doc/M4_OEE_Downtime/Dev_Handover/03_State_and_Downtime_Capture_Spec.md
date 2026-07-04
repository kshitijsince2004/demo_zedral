# M4 · 03 · State & Downtime Capture
**Deep-plan:** §5 · **Build phase:** M4-1 (manual) → M4-4 (auto, switch-on)

## 1. The state model
Controlled vocabulary (`oee.machine_state`), each state carrying `is_planned` and `counts_as` (OEE component):
| State | Running | is_planned | counts_as | Big Loss |
|---|---|---|---|---|
| `RUNNING` | yes | — | NONE | — |
| `MINOR_STOP` | no (short) | false | PERFORMANCE | L3 |
| `BREAKDOWN` | no | false | AVAILABILITY | L1 |
| `SETUP` | no | true | AVAILABILITY | L2 |
| `PLANNED_STOP` | no | true | (per convention) | planned |
| `NOT_SCHEDULED` | no | true | NONE (TEEP only) | — |

## 2. State Interval Resolver (the core v1 job)
Input: raw `canon.state_event` transitions (from any source). Output: closed, gap-free `oee.state_interval` rows.
Steps: **(1)** order events per work-unit by `ts`; **(2)** close each interval at the next transition; **(3)** **debounce** — collapse flapping below a debounce window; **(4)** apply the **micro-stop threshold** (`work_unit_config.micro_stop_threshold_sec` ?? `oee_config` default; 60–120 s) — a stop *below* it becomes `MINOR_STOP` (`is_micro_stop=true`, Performance/L3), *above* it stays `BREAKDOWN`/`SETUP` (Availability); **(5)** stamp `counts_as`; **(6)** link `state_event_ref` (and `downtime_event_ref` when the stop is a downtime shared with M2). The resolver is **idempotent and replayable**: re-running over corrected events yields identical intervals.

> The micro-stop threshold is the **A/P seam** — it must be explicit config, logged on change, and identical across recompute, so the Availability/Performance split is reproducible rather than an artefact of capture.

## 3. v1 — M1 bootstrap (no new hardware)
Map M1 capture onto the canonical contract:
| M1 source | → canonical | M4 use |
|---|---|---|
| `txn.stoppage_entry` (category OPN/ELECT/MECH/UTILITY/POWER/PLANNED/OTHER + start/end + reason) | `DowntimeEvent` + `StateEvent` | Availability + reason attribution |
| `prod_*` counts (good/scrap, MT) | `ProductionCount` | Performance + Quality |
| `shift_log` (date, shift, process) | `Shift` / PPT | Availability denominator |
M1 stoppage categories seed the Layer-1 reason tree (spec 04); `shift_log` is the time spine. OEE is produced per process/shift/coil immediately.

## 4. Future — automatic detection (collector contract, switch-on)
Architected now, built when a client connects PLCs (D9). Edge collector taps a **PLC run/cycle bit, OPC-UA tag, MQTT topic, or clamp-on current sensor**, applies debounce + micro-stop threshold **at the edge**, and emits the **same** `canon.state_event`s. Operators are then prompted to reason-code only **unexplained** stops. Target: ≥98% run/idle accuracy, <0.5% false-positive/hr. Nothing downstream changes; the `work_unit_config.capture_fidelity` flips `MANUAL → AUTOMATIC`, `micro_stops_observed → true`, and the **Fidelity gate** (and OEE confidence) rises. Collector API in spec 07 §4.

## 5. Why fidelity matters (honest OEE)
Manual capture's blind spot is **sub-threshold micro-stops** — the largest single source of OEE under-reporting; automatic capture typically reveals **30–50% more downtime**. In v1 (manual), M4 reports micro-stop capture as a **readiness gap** (Fidelity gate `passed=false`), never as zero, so the OEE is labelled *indicative* rather than falsely precise.

## 6. Acceptance (MUST)
- S-01 Resolver produces gap-free, non-overlapping intervals per work-unit (no time uncounted, none double-counted).
- S-02 A stop equal to the threshold ± ε classifies deterministically and identically on recompute.
- S-03 Changing the threshold is logged and re-derives the A/P split without manual edits.
- S-04 M1 bootstrap yields a non-null OEE for a Hero-Steels process/shift fixture with no PLC data.
- S-05 (auto path) the same fixture replayed via simulated PLC events yields identical Availability to ground truth within tolerance, and `micro_stops_observed=true`.
