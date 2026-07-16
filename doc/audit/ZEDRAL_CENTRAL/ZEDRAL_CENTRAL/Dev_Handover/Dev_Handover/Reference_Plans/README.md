# Reference Plans — rationale & diagrams behind the specs

This folder gives the development team the **"why"** behind the build specs (`../00`–`09`). The specs are the build contract; these planning deep-plans carry the fuller reasoning, models, trade-offs, and the locked decisions.

## How the specs map to these plans

| Build spec (`../`) | Rationale / deeper detail in |
|---|---|
| 01 Data Lake · 02 Canonical Model | `01_DataLake_and_Canonical_Model_DeepPlan.md` |
| 03 Manifold | `02_Manifold_DeepPlan.md` |
| 04 Unified Intelligence · 05 Operational Monitoring | `03_UnifiedIntelligence_and_OperationalMonitoring_DeepPlan.md` |
| 06 Reporting | `05_Reporting_Layer_DeepPlan.md` |
| 07 Financial Impact · 08 Platform/Security · decisions D1–D11 | `04_Consolidated_Review_and_Traceability.md` |

> Also see the **M1 Data Capture Layer** blueprint in `../../M1_Technical_Blueprint/` — the build-ready first-party source that validates the canonical model.

## Diagram gallery (`Diagrams/`)

All 20 architecture diagrams as **PNG** (browse without tooling) + **mermaid source** (editable). Grouped:

**Data Lake & Canonical (01–05)**
- `diagram_01_reference_architecture` — sources → lake zones → consumers
- `diagram_02_zone_pipeline` — Raw → Standardized → Canonical → Serving
- `diagram_03_ingestion_flow` — batch + streaming paths
- `diagram_04_canonical_erd` — canonical entity-relationship model
- `diagram_05_data_readiness_flow` — per-module readiness scoring

**Manifold (06–10)**
- `diagram_06_manifold_architecture` — ingestion → conformance pipeline
- `diagram_07_import_lifecycle` — import state machine
- `diagram_08_field_mapping_flow` — auto/manual mapping decision flow
- `diagram_09_dedup_master_data` — dedup → golden record
- `diagram_10_onboarding_unlock_flow` — connect → unlock modules

**Unified Intelligence & Monitoring (11–15)**
- `diagram_11_unified_intelligence_architecture`
- `diagram_12_intelligence_maturity_ladder` — descriptive→prescriptive
- `diagram_13_kpi_rollup_synthesis` — ISA-95 roll-ups + cross-module
- `diagram_14_operational_monitoring_architecture`
- `diagram_15_progressive_capability` — depth by installed module

**Review & Decisions (16–17)**
- `diagram_16_plan_coverage_map` — planned/partial/gap status
- `diagram_17_open_decisions_gating` — decisions → what they gate

**Reporting (18–20)**
- `diagram_18_reporting_vs_uil_boundary`
- `diagram_19_reporting_architecture`
- `diagram_20_scheduling_distribution`
