# M4 · 07 · APIs, Events & Integration
**Deep-plan:** §0, §5, §12, §14 · **Build phase:** M4-1→4

## 1. REST (OpenAPI, OIDC, tenant-scoped)
| Method · Path | Purpose |
|---|---|
| `GET /oee/assets/{id}/current` | live OEE + current state (Redis) |
| `GET /oee/assets/{id}/intervals?grain=shift&from=&to=` | OEE interval series (mart) |
| `GET /oee/assets/{id}/losses?period=` | loss tree + top-loss Pareto (minutes & cost) |
| `GET /oee/rollup?scope=line|plant&from=&to=` | summed-quantity rollup (no avg) |
| `PUT /oee/config` · `PUT /oee/assets/{id}/config` | policy: threshold, planned-time convention, fidelity |
| `PUT /oee/ideal-cycle` | upsert ideal cycle (material × work-unit), versioned |
| `GET /oee/assets/{id}/readiness` | Required/Quality/Fidelity/History gates |
| `POST /oee/recompute` | bounded replay for a (asset, window) |

All reads served from the Serving zone/mart; writes are policy/reference only (M4 never writes canonical events).

## 2. Domain events
Publishes the spec-05 §4 set (`oee.interval.computed`, `oee.state.changed`, `oee.microstop.detected`, `oee.speedloss.flagged`, `oee.toploss.updated`, `oee.other_bucket.exceeded`). Consumes `canon.state_event`, `canon.downtime_event`, `canon.production_count`, plus `m2.*` failure classification and `m3.*` plan-target updates.

## 3. Manifold ingest on-ramp (historian)
For clients with an existing OEE/MES historian, Manifold maps states/reasons/counts onto the canonical contract via the **OEE sector template** (steel cold-rolling seeded): state map, reason→loss→component map, ideal-cycle table, count map. No M4 code change — ingestion is a Manifold mapping (doc 02).

## 4. Edge collector contract (FUTURE — switch-on, D9)
Reserved interface for automatic capture (spec 03 §4): an edge gateway client (OPC-UA / MQTT / digital-IO / current-clamp) emits canonical `state_event`s after **edge-side debounce + micro-stop threshold**. Contract: `{tenant_id, work_unit_ref, signal_ts, running:bool, source_tag}` → resolver. Built when a client connects PLCs; not in v1.

## 5. MVP migration bridge (target design + migration)
The existing OEE/Downtime **MVP** is the head-start; migration is **non-destructive and incremental**:
| MVP today | Target | Migration step |
|---|---|---|
| OEE from own tables/direct feed | OEE from `canon.*` Event Spine | repoint calc engine at the Serving API; keep MVP UI as a consumer |
| flat/ad-hoc reasons | 3-layer tree → loss → component | import reasons as L1/L2 leaves; backfill `loss_category_ref`/`oee_component`; keep old codes as aliases |
| hard-coded ideal cycle | versioned `oee.ideal_cycle` | seed from the MVP constant; flag uncalibrated |
| A/P/Q in app code | shared ISO 22400 registry | move definitions to registry; reconcile |
**First acceptance gate:** MVP OEE and canonical OEE **agree to the unit on a back-test window** (tolerance per open decision, e.g. ≤0.5 pts/30 days) before the MVP is repointed. No history discarded; reasons mapped forward.

## 6. Acceptance (MUST)
- A-01 All endpoints OIDC-secured and tenant-scoped (D8); reads never cross tenants.
- A-02 No endpoint writes a canonical event; only `oee.*` policy/reference + derived rollups.
- A-03 Historian ingest works via Manifold mapping with zero M4 code change.
- A-04 Edge-collector contract is documented and stub-tested (no v1 build).
- A-05 MVP back-test reconciliation passes within tolerance before repoint; old reason codes resolve via aliases.
