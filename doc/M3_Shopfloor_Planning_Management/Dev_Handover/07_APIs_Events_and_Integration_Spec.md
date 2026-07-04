# M3 · 07 — APIs, Events & Integration Spec
**Deep-plan ref:** §0, §12. **Standards:** REST/OpenAPI; SAP PP object model (ingestion reference); ISA-95 Part 5 B2M transactions (framing).

## 1. REST surface (FastAPI + OpenAPI, OIDC, tenant-scoped)
| Area | Endpoints (selected) |
|---|---|
| Master data | `GET/POST /materials`, `/boms`, `/routings`, `/work-centers/{id}/capacity`, `/setup-matrix` |
| PPC (spec 02) | `POST /ppc/mrp-run`, `POST /ppc/mps`, `GET /ppc/capacity-load`, `POST /ppc/planned-orders/{id}/firm` |
| Scheduling (spec 03) | `POST /schedule/run`, `/schedule/commit`, `/schedule/{id}/move`, `GET /schedule/dispatch-list`, `GET /schedule/whatif/compare` |
| Orders (spec 05) | `POST /orders`, `POST /orders/{id}/release|cancel`, `GET /orders/{id}`, `GET /orders?status&due` |
| Execution (spec 04) | `POST /exec/confirm`, `POST /handover`, `/handover/{id}/draft|review|signoff`, `GET /handover/open-carryover` |
| KPIs (spec 06) | `GET /kpis/plan-daily`, `GET /kpis/registry` |
| Config | `GET/PUT /planning-config` (posture; admin-only, audit-logged) |

All mutating endpoints are idempotent (client `request_id`); all reads tenant-scoped at the data layer (D8).

## 2. Domain events (Kafka/Redpanda)
Producers: order lifecycle (spec 05) + handover + schedule commit. Topics: `m3.order.*`, `m3.production.confirmed`, `m3.schedule.committed`, `m3.handover.signed_off`, `m3.capacity.overload`. Envelope: `{tenant_id, event_id, ts, type, payload, lineage_ref}`. Consumers: Monitoring, KPI svc, **M4** (ProductionCount), Financial Impact, Reporting, and **M1 write-back** (plan as auto-source).

## 3. Manifold connector mapping — SAP PP → canonical (Posture A/B ingest)
| SAP PP object | Canonical / `ops` target | Notes |
|---|---|---|
| Material master (MARA/MARC) | `ops.material` | sku, type, base UoM |
| BOM (STKO/STPO) | `ops.bom_line` | qty_per, scrap |
| Routing (PLPO/MAPL) | `ops.routing` + `routing_operation` | WC, std times |
| Work centre (CRHD) + capacity | `canon.equipment_node` + `ops.work_center_capacity` | |
| PIR / demand (PBED) | `ops.demand_forecast` | demand_type=PIR |
| MPS/MRP planned order (PLAF) | `ops.planned_order` | source=ERP_IMPORT |
| Production order (AUFK/AFKO/AFPO) | `ops.production_order` | order_no, qty, dates |
| Confirmation (AFRU) | `ops.production_confirmation` | actuals → ProductionCount |
Field-mapping, dedup, master-data resolution, readiness all run in **Manifold** (doc 02). The **M1 SAP-PP plan CSV** is the *first* connector (D4) — same target tables, CSV instead of API.

## 4. Inbound constraints from sibling modules
- **M2** PM schedules → capacity unavailability windows (scheduler input, spec 03).
- **M4** live `StateEvent` → resource up/down for dispatch feasibility.
- **M6** quality holds → handover `QUALITY_HOLD` carryover.

## 5. Acceptance criteria
- **MUST** publish OpenAPI 3 for every endpoint; version independently of canon (doc 02 §7).
- **MUST** emit each domain event exactly once; consumers idempotent.
- **MUST** map the SAP PP objects above (and the M1 CSV) into the canonical/`ops` targets via Manifold with lineage preserved.
- **MUST** keep all reads/writes tenant-scoped (D8) and hybrid-edge runnable (D1).
- **SHOULD** ship the SAP PP connector map as a reusable **planning sector template** (doc 02 §12).
