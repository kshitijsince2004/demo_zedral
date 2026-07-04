# 09 · Security, RBAC, NFRs & Acceptance — Developer Specification

**Component owner:** M2 + Platform/Security · **Phase:** cross-cutting (M2-0 onward) · **Depends on:** platform 08 Platform & Security · **Consumed by:** all M2 specs

---

## 1. Purpose & scope

The cross-cutting requirements every M2 service must meet: roles & permissions, multi-tenancy, non-functionals, the consolidated acceptance criteria, and the test plan. M2 **inherits** the platform security model (platform 08 — OIDC/Keycloak, TLS, encryption at rest, tenant isolation, audit, OpenTelemetry) and adds maintenance-specific roles and targets.

## 2. RBAC (extends the M1 role model)

M1 roles: Operator / Supervisor / Plant-Head / Admin. M2 adds maintenance personas (mapped to Keycloak groups; row-level scoping by site/area as in M1).

| Role | Can | Cannot |
|---|---|---|
| **Technician** | execute assigned WOs, log labour/parts/readings/root cause, raise notifications | edit plans, change cost rates, close others' WOs |
| **Maintenance Planner** | create/edit plans & triggers, schedule & assign WOs, manage backlog, manage spares | change RBAC, edit cost rates |
| **Reliability Engineer** | manage failure modes/FMECA/criticality, condition rules, (future) predictive config | execute WOs outside scope |
| **Maintenance Manager** | read all KPIs/cost/analytics, approve high-cost WOs | edit operational records |
| **Admin** | masters, integration (connectors), workflow config, role assignment | — |
| *(inherited)* Plant-Head | read-only analytics across lines | edits |

Cost-rate management belongs to the Financial Impact Layer's owner (platform 07), not M2 roles (D7 governance).

## 3. Multi-tenancy & data protection (MUST)

- `tenant_id` on every `maint.*` row; all queries tenant-scoped at the data-access layer (D8); no cross-tenant path exists.
- Logical isolation default; physical on client request (D1/D8).
- Encryption in transit (TLS) + at rest; per-tenant keys per platform policy.
- **Audit**: every WO create/transition/close, cost booking, plan change, mapping, and export logged (who/what/when) — reuse the M1 audit pattern; post-close edits require an audited change request.

## 4. Non-functional requirements

| Concern | Target |
|---|---|
| **Latency** | PM due-scan + condition eval within tenant cadence (default minutes, D2); capture never blocks |
| **Scale** | ≥100k active triggers and ≥10M failure/WO rows per tenant; meter readings at TimescaleDB scale |
| **Availability** | 99.5% for serving/monitoring; capture & PM scan **edge-deployable** and offline-tolerant (D1) |
| **Offline** | first-party capture queues locally, syncs idempotently on reconnect |
| **Integrity** | idempotent pipelines; one downtime row shared with M4; stock ledger = source of truth for on-hand |
| **Observability** | OTel traces, Prometheus metrics, structured logs — tagged by tenant + service |
| **Reproducibility** | costed lines store the resolved rate (audit); KPIs store definition_ref |

## 5. Consolidated acceptance criteria (module-level)

- **MUST** stand up `maint.*` from `M2_schema.sql` against `canon` with zero errors.
- **MUST** run the full notification→WO lifecycle (corrective + preventive) with valid, audited transitions.
- **MUST** generate PMs from time/meter/condition triggers exactly once, honouring the compliance window.
- **MUST** bootstrap failures from M1 stoppages with no CMMS present.
- **MUST** compute the maintenance KPI family per spec 06 and reconcile breakdown downtime with M4.
- **MUST** price labour/parts/downtime via effective-dated rates (D7).
- **MUST** keep predictive as readiness-only (no fabricated RUL) per spec 08.
- **MUST** enforce RBAC + tenant isolation + audit on every write.
- **SHOULD** ingest a sample SAP PM export via Manifold; **SHOULD** support offline capture; **SHOULD** load both a steel and a non-steel seed (D11).

## 6. Test plan

| Layer | Tests |
|---|---|
| **Unit** | trigger date math (fixed/floating/meter projection), KPI formulas, cost resolution, state-transition guards |
| **Integration** | due-scan → WO generation → close → KPI rollup; M1 stoppage → failure_event; spare reserve→issue→ledger |
| **Contract** | OpenAPI conformance; event schema compatibility; canonical write-back lineage |
| **Data quality** | failure has ISO 14224 quartet; one downtime_event_ref per breakdown; on_hand == ledger |
| **Reconciliation** | M2 breakdown downtime_h == M4 Availability-loss hours (spec 06 §5) |
| **Non-functional** | due-scan throughput at 100k triggers; offline capture sync; tenant-isolation negative tests |
| **Acceptance** | the §5 MUSTs, scripted against the Hero Steels seed + a non-steel seed |

## 7. Build phasing

Security/RBAC/audit land in **M2-0** (before any capture). NFR targets are verified continuously; the reconciliation and offline tests gate **M2-2** and **M2-1** respectively.

## 8. Risks

Privilege creep (least-privilege default, periodic review); audit gaps on offline edits (change-request workflow); tenant-isolation regressions (negative tests in CI); NFR drift under real meter volume (load test early with TimescaleDB).
