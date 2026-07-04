# M3 · 09 — Security, RBAC, NFRs & Acceptance Spec
**Deep-plan ref:** §13. **Inherits:** platform `08_Platform_Security_Spec` + M1 RBAC.

## 1. Roles (extend M1: Operator / Supervisor / Plant-Head / Admin)
| Role | Can |
|---|---|
| **Production Planner** | MPS/MRP, posture config requests, firm planned orders, what-if |
| **Scheduler** | run/commit detailed schedule, resequence, dispatch |
| **Shift Supervisor** | execute dispatch, confirm production, own & sign off shift handover |
| **Operator** | confirm own work centre/line (reuse M1 capture), acknowledge carryover |
| **Materials Controller** | stock/MRP netting (Posture C) |
| **Plant Manager** | read-only KPIs, attainment, cost |
| **Admin** | masters, integration, **posture & workflow config** (audit-logged) |
Row-level scoping by site/area (reuse M1 `line_access`). Posture is admin-only and audit-logged.

## 2. Security & multi-tenancy
OIDC (Keycloak); `tenant_id` on every `ops.*` row; queries tenant-scoped at the data layer (D8); logical isolation default, physical on request. Handover sign-off and order state transitions are immutable, fully **audit-logged** (who/when/what) — handover is a legal-grade record (HSE).

## 3. NFRs (delta over platform §7)
| Concern | Target |
|---|---|
| Hybrid/edge (D1) | scheduler + dispatch + capture run on-prem disconnected; sync on reconnect |
| Latency (D2) | dispatch board + plan-vs-actual refresh in minutes (tunable); capture never blocks |
| Scheduler scale | committed sequence for ≥10k open operations/tenant in interactive time |
| Offline capture | confirmations + handover queue locally, sync on reconnect (like M1) |
| Reconciliation | M3 throughput ties to M4 ProductionCount to the unit |
| Availability | 99.5% serving (inherited) |
| Observability | OpenTelemetry traces on MRP run, schedule run, confirm, handover sign-off |

## 4. Acceptance criteria (module-level, gates v1 done)
- **MUST** honour posture end-to-end (A ingest-execute / B own-schedule / C system-of-record) with **no schema change** between them.
- **MUST** enforce finite capacity in committed schedules (no overload).
- **MUST** guarantee no orphaned order at handover; block sign-off on unacknowledged mandatory carryover.
- **MUST** book one ProductionCount per produced qty; reconcile with M4.
- **MUST** price lateness/idle/changeover via effective-dated cost rate (D7).
- **MUST** keep canon independent (no FK canon→ops; soft `order_ref`).
- **MUST** run hybrid/edge + offline-tolerant + tenant-isolated + audited.
- **SHOULD** reproduce the Hero Steels cold-rolling campaign sequence on the seed template.
- **SHOULD** bootstrap the full lifecycle from the M1 SAP-PP CSV + `prod_*` actuals with zero data loss.

## 5. Test plan (summary)
Unit: state-machine transitions, MRP gross-to-net arithmetic, setup-matrix costing, capacity math. Integration: M1 CSV→order→schedule→confirm→ProductionCount→KPI; SAP PP connector map. Cross-module: M3↔M4 count reconciliation; M2 PM window as capacity block. Acceptance: posture A/B/C walkthroughs; steel campaign; handover no-orphan + sign-off gating; offline capture sync. Schema: `pglast.parse_sql` in CI.
