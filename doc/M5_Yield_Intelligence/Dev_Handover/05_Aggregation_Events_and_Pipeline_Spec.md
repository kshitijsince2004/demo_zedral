# M5 · 05 · Aggregation, Events & Pipeline Spec
**Deep-plan:** §3, §13 · **Stack:** Kafka + Flink (stream) · Airflow (batch) · Redis (live)

## 1. Two paths, one truth
- **Streaming (Flink off the canonical event stream):** updates the **live yield tile**, running scrap/transition board, and the reconciliation-gap signal in the Redis cache. Provisional — labelled "live, unreconciled."
- **Batch (Airflow scheduled rollups):** closes the mass balance per lot/window, computes trusted `yield_interval`, `loss_attribution`, `loss_bridge`, `top_loss`, and `yield_factor_feedback`, and publishes to the KPI mart.

A yield number is **trusted only after its `material_balance` closes** (spec 02 §3); the live tile shows the provisional figure with a "reconciling" badge until then.

## 2. Pipeline order (per window)
```
ingest canonical ProductionCount + weights + genealogy
  → resolve genealogy (parent→child, charge/base)
  → close mass balance (Input = Good+Scrap+Rework+Byproduct+ΔWIP+Gap)  → status
  → compute material yield + FPY (per step) + RTY (∏ over chain)
  → attribute losses (reason → category → quantity_class → recoverability → big_loss → price)
  → build loss_bridge + top_loss (mass/units/cost)
  → publish KPI registry + yield_factor_feedback (→ M3)
```

## 3. Recompute / replay (deterministic)
All derived rows are a pure function of canonical events + effective-dated policy. A corrected weight, scrap reason, or expected-yield factor triggers recompute of exactly the affected `(work_unit, material, window)` partitions — balance → interval → attribution → bridge — with no manual patching. Late-arriving offline captures (spec 03 §5) use the same path. Recompute is idempotent (UNIQUE keys on intervals/bridges/top_loss).

## 4. Domain events (Kafka topics)
| Event | Emitted when | Consumers |
|---|---|---|
| `m5.balance_closed` | mass balance reaches CLOSED | UIL, Reporting |
| `m5.balance_deviation` | gap > 2× tolerance / drifting | Monitoring (data-quality alert) |
| `m5.yield_interval_computed` | trusted interval written | UIL, KPI registry |
| `m5.loss_bridge_updated` | bridge/Pareto recomputed | Monitoring, Reporting |
| `m5.yield_drop_detected` | yield below target/threshold | Monitoring (alert) |
| `m5.other_bucket_now_top_loss` | Other reason in top-3 / >10% | UI prompt (spec 04 §4) |
| `m5.yield_factor_feedback` | actual-vs-expected published | M3 (planning) |

All events carry `tenant_id`, scope refs, `schema_version`. Idempotent keys; at-least-once delivery; consumers dedupe.

## 5. Performance
Partition `material_balance`/`yield_interval` by window month (TimescaleDB). Heavy yield-by-grade×shift×supplier-lot analytics run in ClickHouse off the serving path so reconciliation never blocks the live tile (same read-replica discipline M1/M4 use).
