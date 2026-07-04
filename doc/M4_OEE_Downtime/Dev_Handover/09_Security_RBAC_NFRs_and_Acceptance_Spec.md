# M4 · 09 · Security, RBAC, NFRs & Acceptance
**Deep-plan:** §13 · **Cross-cutting**

## 1. RBAC (extends M1: Operator / Supervisor / Plant-Head / Admin)
| Role | Can |
|---|---|
| **Operator** | view live OEE tile for own line; reason-code stops |
| **Shift Supervisor** | shift OEE, loss Pareto; validate reason coding |
| **OEE / CI Engineer** | configure state model, micro-stop thresholds, ideal-cycle, reason tree, targets; run loss analysis |
| **Maintenance/Reliability** | read breakdown losses (shared with M2) |
| **Plant Manager** | OEE/TEEP trends, cost of loss (read-only analytics) |
| **Admin** | masters, integration, capture-fidelity & OEE policy, posture of recompute |
Row-level scoping by site/area (inherits M1 `line_access`). OIDC via Keycloak.

## 2. Definition-change governance (OEE-specific)
Because ideal cycle, micro-stop threshold, and planned-time convention **move the number**, every change is **effective-dated and audit-logged** (`oee.policy_change_log`) and surfaced on trends ("definition changed here"). A trend can never be silently broken by a re-definition.

## 3. NFRs (delta over platform §7)
| Concern | Target |
|---|---|
| Latency | live tile reflects a new state within D2 budget (minutes, tunable) |
| Determinism | resolver + calc **idempotent & replayable**; same events ⇒ same OEE |
| Reconciliation | M4 totals tie to M2 minutes and M3 counts nightly (spec 06 §4) |
| Confidence | every OEE carries a fidelity flag (MANUAL/HISTORIAN/AUTOMATIC) |
| Offline | first-party/edge capture queues locally, syncs on reconnect (like M1) |
| Multi-tenant | D8 logical isolation; `tenant_id` everywhere |
| Hybrid | resolver + tile + collector run on-prem edge (D1) |

## 4. Acceptance (MUST / SHOULD)
- **MUST** A/P/Q/OEE/TEEP match ISO 22400 worked examples (spec 02 C-01..05).
- **MUST** rollups sum-then-divide; no averaging of percentages (C-02).
- **MUST** loss leaves reconcile to factor gaps (L-02) and to M2/M3 (K-04, P-03).
- **MUST** one `downtime_event_ref` shared with M2 — no double count (M-05).
- **MUST** definition changes effective-dated & audit-logged; recompute deterministic.
- **MUST** MVP back-test reconciles within tolerance before repoint (A-05).
- **MUST** no v1 write to `oee.loss_prediction`; HISTORY gate honest (F-01..02).
- **SHOULD** auto-capture replay reproduces Availability within tolerance & sets `micro_stops_observed` (S-05).
- **SHOULD** "All Other" governance prompt fires above threshold (L-04).

## 5. Test plan
Unit: factor math, time-model, threshold classification, pricing rate-as-of. Integration: M1-bootstrap → OEE; historian ingest; recompute/replay. Reconciliation: nightly M4↔M2↔M3. Fixtures: a Hero-Steels shift (manual) + a discrete-part shift (clean cycle) for cross-sector (D11).
