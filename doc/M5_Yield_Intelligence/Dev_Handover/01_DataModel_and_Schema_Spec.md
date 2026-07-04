# M5 · 01 · Data Model & Schema Spec
**Pairs with:** `M5_schema.sql` (runnable) · **Deep-plan:** §4, §6, §11

## 1. Design stance
M5 is **thin-write / heavy-read**. It introduces **no new transactional capture** — it consumes the canonical `ProductionCount` (good/scrap/rework/total + weight) and the material-lot genealogy, and adds only a **derived** yield layer. The canonical `ProductionCount`, `LossCategory`, `ReasonCode`, `material_lot` genealogy and `DefectRecord` already exist (canonical model §10); M5 is the module that **brings the material/quantity side to life**.

## 2. Entities (see `M5_schema.sql` for full DDL)

| Entity | Role | Key columns |
|---|---|---|
| `yield_config` | per-tenant policy (definitions-as-config) | default_quantity_basis, recon_tolerance_pct, default_expected_source, net_salvage, report_avoidable_only |
| `work_unit_config` | per-work-unit basis & capture fidelity | quantity_basis, capture_fidelity, genealogy_required |
| `expected_yield_factor` | PSQ baseline / avoidable-loss reference (versioned) | expected_yield_pct, planned_scrap_pct, source, is_calibrated, version, effective_* |
| `yield_target` | yield targets per scope×material | target_material_yield_pct, target_rty_pct |
| `material_balance` | **the conservation-of-mass close** | input_mt, good_mt, scrap_mt, rework_mt, byproduct_mt, dwip_mt, gap_mt, gap_pct, status |
| `yield_interval` | computed dual-basis yield per asset×material×bucket | *_mt + *_units quantities, material_yield_pct, fpy_pct, rty_pct, scrap/rework/quality ratios, avoidable_loss_mt |
| `loss_attribution` | every lost kg/unit, priced, genealogy-traced | reason_ref, loss_category_ref, quantity_class, recoverability, big_loss, loss_mt/units, net_loss_cost, **production_count_id** |
| `loss_bridge` | waterfall snapshot (serving) | steps (JSONB ordered), total_loss_cost |
| `top_loss` | Pareto snapshot by mass/units/cost | rank_basis, rank, value_* |
| `yield_factor_feedback` | actual-vs-expected → M3 | actual_yield_pct, expected_yield_pct, delta_pct |
| `policy_change_log` | audit of effective-dated config | entity, old/new_value, changed_by, effective_from |
| `readiness_snapshot` | Required/Quality/Fidelity/History gates | genealogy_complete, expected_calibrated, recon_within_tol, fidelity |
| `yield_prediction` | FUTURE-SCOPE stub | predicted_yield_pct, model_version (unwritten v1) |
| `v_yield_rollup` (view) | **SUM-then-divide** material-yield rollup | never averages sub-yields |

## 3. The no-double-count anchor
`loss_attribution.production_count_id` and `lot_ref` point at the **same** canonical rows M4 (Quality factor), M3 (attainment) and M6 (defect) read. M5 **aggregates**; it never re-records a count. The mass balance therefore reconciles against the *one* count truth, and M5's Quality-loss must equal M4's Quality-factor loss by construction (spec 06 §4).

## 4. Keys, types, tenancy
Surrogate `BIGINT GENERATED ALWAYS AS IDENTITY` PKs; `UUID tenant_id` on every table (D8 isolation, RLS in spec 09); `TIMESTAMPTZ` UTC; `NUMERIC` for all masses/units/costs (never float); `JSONB ext` for non-core extension; units embedded in column names (`_mt`, `_units`, `_pct`, `_cost`). Hard FK only to `canon.*`; soft BIGINT `*_ref` to `ops.*`/`qual.*`.

## 5. Versioning & effective dating
`expected_yield_factor` and `yield_config` are **effective-dated and versioned**; changes are written to `policy_change_log`. Because yield trends move when an expected-yield factor or basis changes, **every policy change is audited with `effective_from`** so a trend is never silently re-baselined (deep-plan §13). Recomputation is deterministic/replayable from canonical events.

## 6. Indexing & partitioning
`material_balance` and `yield_interval` are time-series — partition by `bucket_start`/`window_start` (monthly) and consider TimescaleDB hypertables. Indexes shipped: work-unit×bucket, material, lot, reason, non-closed balances. Heavy multi-dimensional yield analytics (yield by grade×shift×supplier-lot heatmaps) belong in ClickHouse off the serving path.
