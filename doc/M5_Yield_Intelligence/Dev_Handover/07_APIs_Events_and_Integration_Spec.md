# M5 · 07 · APIs, Events & Integration Spec
**Deep-plan:** §0, §12, §14 · **Style:** REST/OpenAPI, versioned `/v1`, read-mostly

## 1. Read APIs (Serving)
| Method · Path | Returns |
|---|---|
| `GET /v1/yield/intervals?work_unit&material&grain&from&to` | dual-basis yield intervals (material yield, FPY, RTY, ratios, avoidable) |
| `GET /v1/yield/material-balance?work_unit&lot&from&to` | mass-balance closes + gap + status |
| `GET /v1/yield/loss-bridge?scope&material&grain&bucket` | ordered waterfall steps + total cost |
| `GET /v1/yield/top-loss?scope&grain&bucket&basis=COST` | Pareto (mass/units/cost) |
| `GET /v1/yield/by-dimension?dim=grade|shift|supplier_lot|step` | yield/loss sliced by dimension |
| `GET /v1/yield/readiness?work_unit` | Required/Quality/Fidelity/History gate state + confidence |
| `GET /v1/yield/factors?route&material` | expected-yield factors (for M3) |

## 2. Write / config APIs (admin/engineer, audited)
| Method · Path | Purpose |
|---|---|
| `PUT /v1/yield/config` | tenant policy (basis, tolerance, expected source, salvage netting) — writes `policy_change_log` |
| `PUT /v1/yield/expected-yield-factor` | new versioned factor (effective-dated) |
| `PUT /v1/yield/reason-map` | reason → category/quantity_class/recoverability/big_loss |
| `POST /v1/yield/recompute` | trigger deterministic replay for (work_unit, material, window) |

## 3. Domain events
Publishes the topics in spec 05 §4. Subscribes to canonical `production_count.*`, `material_lot.*` (genealogy), `defect_record.*` (M6), `downtime_event.*` (cobble link, M4/M2), `cost_rate.*` (D7).

## 4. Auto-capture collector contract (future switch-on)
Edge collectors POST canonical ProductionCount rows; M5 does **not** parse raw signals — the edge does debounce/conversion, M5 ingests canonical:
```json
POST /v1/ingest/production-count
{ "tenant_id":"…","work_unit_ref":123,"lot_ref":456,
  "good_mt":4.80,"scrap_mt":0.14,"rework_mt":0.04,"total_mt":4.98,
  "good_units":1,"scrap_units":0,
  "reason_ref":71,"capture_fidelity":"AUTOMATIC","ts":"…" }
```
| Collector | Edge does | Emits |
|---|---|---|
| Weighbridge/coil scale | true in/out mass | weight per process |
| Length/width encoder | crop/trim length → mass | scrap by reason |
| Vision/surface | defect area → reject mass | scrap/rework + defect link |

## 5. MVP migration (existing dashboards + insights → canonical)
Non-destructive, incremental:
1. Repoint the existing yield calc/dashboards onto `canon.*` ProductionCount/weights/genealogy via the Serving API (keep the screens).
2. Introduce the Mass-Balance Resolver; publish the reconciliation gap; the old flat "scrap %" becomes one slice.
3. Migrate existing scrap reasons as Layer-1/2 leaves; backfill quantity_class + recoverability; keep historical codes as aliases.
4. Seed `expected_yield_factor` from the current constant; flag uncalibrated routes.
5. Move yield ratios into the shared ISO 22400 registry (M4/M6/UIL read the same numbers).
6. **Acceptance gate:** existing yield % == canonical material yield to tolerance on a back-test window **and** mass balance closes ≤1–2% (spec 09).

## 6. Boundaries enforced in code
- M5 **reads** canonical counts; never writes another module's tables.
- M5 Quality Ratio and M4 Quality factor computed from the *same* good/total — reconciliation test in CI (spec 06 §4).
- Yield-factor feedback to M3 is a **published event**, not a write into `ops.*`.
