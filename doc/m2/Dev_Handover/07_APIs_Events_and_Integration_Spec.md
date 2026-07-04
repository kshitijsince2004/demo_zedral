# 07 · APIs, Events & Integration — Developer Specification

**Component owner:** M2 Backend + Platform · **Phase:** M2-1→2 · **Depends on:** platform 03 Manifold, 08 Platform/Security · **Consumed by:** all M2 UIs, UIL, Monitoring, Reporting, M4

---

## 1. Purpose & scope

M2's external contracts: REST APIs, domain events, the **Manifold connector mapping** for ingesting an existing CMMS/EAM (SAP PM first), and the module boundaries. **In scope:** endpoint catalogue, event catalogue, SAP PM→canonical field map, boundary contracts. **Out of scope:** internal service design (specs 03–06).

## 2. API conventions (inherited — MUST)

REST, versioned `/v1/...`, OpenAPI-documented, **OIDC** (Keycloak) secured, **idempotent** writes (client idempotency key), cursor pagination, RFC-7807 error bodies, all requests tenant-scoped. (Platform 00 §5.)

## 3. REST endpoint catalogue (v1)

| Area | Method & path | Purpose |
|---|---|---|
| Registry | `GET/POST /v1/maint/assets/{id}/profile` · `GET/POST /v1/maint/items` · `GET/POST /v1/maint/failure-modes` | reliability registry CRUD |
| Plans | `GET/POST /v1/maint/plans` · `POST /v1/maint/plans/{id}/triggers` · `POST /v1/maint/plans/{id}/tasks` · `GET /v1/maint/plans/due?as_of=` | PM plans, triggers, checklists, due list |
| Meters | `POST /v1/maint/meters` · `POST /v1/maint/meters/{id}/readings` · `GET /v1/maint/meters/{id}` | usage counters |
| Notifications | `POST /v1/maint/notifications` · `POST /v1/maint/notifications/{id}/convert` | problem reports → WO |
| Work orders | `GET/POST /v1/maint/work-orders` · `PATCH /v1/maint/work-orders/{id}/status` · `POST /.../labor` · `POST /.../parts` · `POST /.../tasks` | lifecycle + capture |
| Failures | `GET/POST /v1/maint/failures` | failure events + analytics |
| Spares | `GET/POST /v1/maint/spares` · `POST /v1/maint/spares/{id}/txns` · `GET /v1/maint/spares/reorder` | MRO |
| KPIs/analytics | `GET /v1/maint/kpis` · `GET /v1/maint/analytics/pareto` | metrics + Pareto |
| Health (future) | `GET /v1/maint/assets/{id}/health` | RUL/health (spec 08, empty in v1) |

Writes that produce canonical facts call the **canonical write-back API** (platform 01 §8) so `canon.event` rows + specializations are created consistently with lineage.

## 4. Domain events (Kafka/Redpanda; at-least-once, idempotent consumers)

| Direction | Topic / event | Payload (key fields) |
|---|---|---|
| Publish | `maintenance.notification.created` | notif_id, asset, failure_mode, severity |
| Publish | `maintenance.workorder.created\|assigned\|started\|completed\|closed` | wo_id, asset, type, status, costs |
| Publish | `maintenance.failure.logged` | failure_event_id, asset, mode, downtime_h, downtime_event_ref |
| Publish | `maintenance.pm.due` / `maintenance.pm.generated` | plan_id, trigger_id, asset, due_ts |
| Publish | `maintenance.condition.alert` | asset, tag, value, threshold, severity |
| Publish | `maintenance.spare.issued` / `maintenance.spare.reorder` | spare_id, qty, on_hand |
| Publish | `maintenance.kpi.published` | kpi_code, scope, period, value |
| Consume | `downtime.logged` (M1/M4) | → bootstrap `failure_event` (spec 04 §5) |
| Consume | `sensor.reading` / meter feed | → meter triggers + condition rules |
| Consume | `mapping.confirmed` (Manifold) | → CMMS field maps activated |

## 5. Manifold connector mapping — SAP PM (primary CMMS target)

M2 does not build connectors; **Manifold** (platform 03) ingests and maps. M2 supplies the **maintenance sector template** (canonical target fields). SAP PM → canonical map:

| SAP PM object | Canonical / `maint` target |
|---|---|
| Functional Location | `canon.equipment_node` (AREA/WORK_CENTER hierarchy) |
| Equipment | `canon.equipment_node` WORK_UNIT + `maint.asset_profile` |
| Equipment BOM | `maint.maintainable_item` + `maint.spare_bom` |
| Task List | `maint.maintenance_plan` + `maint.maintenance_task` |
| Maintenance Plan (MPLA) | `maint.maintenance_plan` + `maint.plan_trigger` |
| Notification | `maint.notification` (+ `failure_mode` from catalog) |
| Work Order (order header/ops) | `maint.work_order` (+ `wo_task`, `wo_labor`) |
| Measurement Point/Document | `maint.meter` + `maint.meter_reading` |
| Material/Spare | `maint.spare_part` |

Maximo/Infor follow the same target via their own maps. Connector priority (open decision): **SAP PM first** (Hero Steels runs SAP) per platform D4 sequence (files/DB first, then SAP/API). Dedup & source-key resolution handled by Manifold (no duplicate assets when capture + CMMS both present).

## 6. Module boundaries (contracts)

| With | M2 provides | M2 consumes | Shared |
|---|---|---|---|
| **M1** | enriches stoppages → failures | `downtime.logged`, capture patterns | `canon.event` |
| **M4 (OEE)** | failure classification, MTTR | — | the single `downtime_event_ref` (never double-count) |
| **UIL** | maintenance KPIs | cross-module synthesis | KPI registry |
| **Monitoring** | asset-health/due-PM tiles (Redis) | live cache infra | streaming path |
| **Financial Impact** | what to price | cost-rate engine (D7) | `cost_rate` |
| **Reporting** | reliability/cost report data | render/schedule | same KPI numbers |

## 7. NFRs

APIs stateless + horizontally scalable; events idempotent; connector sync incremental (CDC where SAP allows) and edge-tolerant (D1); contracts versioned so consumers don't break on internal change.

## 8. Acceptance criteria

- **MUST** expose the v1 endpoints with OpenAPI specs and OIDC enforcement.
- **MUST** publish/consume the listed events with idempotent handling.
- **MUST** ingest a sample SAP PM export via Manifold into `maint.*` using the §5 map.
- **MUST** route all canonical facts through the write-back API (lineage preserved).
- **SHOULD** support incremental CMMS sync, not just full reload.

## 9. Build phasing

**M2-1:** internal REST + events + M1-stoppage consume. **M2-2:** KPI/analytics endpoints. **M2-3:** Manifold SAP PM connector + sector template + dedup.

## 10. Risks

Connector variance across SAP versions (template + Manifold mapping review queue, D5); duplicate assets from capture+CMMS (Manifold dedup/source-key map); event ordering (idempotent consumers + event timestamps).
