# 02 · Asset Registry & Failure Taxonomy — Developer Specification

**Component owner:** Reliability/Domain · **Phase:** M2-0 · **Depends on:** 01 Data Model, platform 02 Canonical Model · **Consumed by:** 03 PM Engine, 04 Work Orders, 06 KPIs

---

## 1. Purpose & scope

The reliability backbone: a disciplined asset hierarchy down to the maintainable item, a criticality model, and a controlled failure-mode vocabulary (ISO 14224). Without this, MTBF/MTTR and failure Pareto are not sliceable. **In scope:** asset profile, maintainable-item subtree, criticality/FMECA, failure taxonomy, seed templates. **Out of scope:** PM scheduling (03), KPI math (06).

## 2. Key concepts (MUST)

- The canonical ISA-95 hierarchy stops at `WORK_UNIT` (= the asset). M2 extends **downward** with `maintainable_item` (ISO 14224 levels **L7 SUBUNIT → L8 MAINTAINABLE_ITEM → L9 PART**) via a self-referential subtree, **without** altering `canon.equipment_node`.
- Each asset gets a 1:1 `asset_profile` (criticality, nameplate, default strategy).
- Each significant failure is described by the ISO 14224 quartet and FMECA-scored.

## 3. Asset hierarchy mapping (ISO 14224 × ISA-95)

| ISO 14224 level | Where it lives | Example (generic) | Example (Hero Steels) |
|---|---|---|---|
| L1–L5 industry→plant/unit | `canon.equipment_node` (ENTERPRISE…WORK_CENTER) | plant / area | CR complex / mill bay |
| **L6 equipment unit** | `canon.equipment_node` level `WORK_UNIT` + `asset_profile` | pump, motor, furnace | 4-Hi tandem mill |
| **L7 subunit** | `maint.maintainable_item` level `SUBUNIT` | hydraulic unit, drive | mill hydraulic AGC |
| **L8 maintainable item** | `maint.maintainable_item` level `MAINTAINABLE_ITEM` | bearing, valve, motor | work-roll bearing |
| **L9 part** | `maint.maintainable_item` level `PART` | bearing SKU | specific bearing p/n |

## 4. Criticality model (RCM)

`asset_profile.criticality` ∈ {`A_CRITICAL`, `B_ESSENTIAL`, `C_GENERAL`, `D_LOW`}. Criticality drives: default PM intensity, work-order `priority` defaults, spares stocking depth (spec 05), and (later) which assets are first candidates for predictive (spec 08). Criticality **MAY** be set directly or derived from an FMECA roll-up (max RPN of the asset's failure modes).

## 5. Failure taxonomy (ISO 14224 + FMECA)

`failure_mode` columns (see `M2_schema.sql`):

| Field | ISO 14224 sense |
|---|---|
| `mode_desc` / `mode_code` | **failure mode** — the observed effect ("fails to start", "external leak") |
| `mechanism` | **failure mechanism** — fatigue, wear, corrosion, electrical breakdown |
| `cause` | **failure cause** — design/install/use/maintenance root |
| `effect` | **failure effect/impact** — line stop / derate / safety / none |
| `severity`, `occurrence`, `detectability` (1–10) | FMECA scores |
| `rpn` (generated) | risk priority = S×O×D |
| `assigned_strategy` | RCM decision: RUN_TO_FAILURE / TIME_BASED / METER_BASED / CONDITION_BASED / PREDICTIVE |
| `detection_method` | how it's caught (operator, PM inspection, condition monitoring, breakdown, sensor) |

**RCM decision logic (build as a guided workflow, not automated):** for each significant failure mode, assign a strategy by technical feasibility + economic justification → the strategy becomes the basis for a `maintenance_plan` (condition/time/meter) or an explicit run-to-failure flag (excluded from PM scheduling). This is a Reliability-Engineer task surfaced in the UI; the system records the decision and links plan↔failure_mode.

## 6. Seed taxonomies (sector-neutral core + Hero Steels template)

Ship a **generic** failure-mode starter set keyed to asset archetypes (rotating / static / electrical / material-handling / hydraulic / utility), then a **sector template** that specializes it. Open decision: adopt M1's `MECH/ELECT/UTILITY/POWER` stoppage codes as the v1 failure-category layer (fast, consistent with M1) vs a fuller ISO 14224 mode set (richer, more effort). Recommended: **map M1 codes → ISO 14224 categories** so both hold.

Hero Steels seed (illustrative rows):

| Asset archetype | Failure mode | Mechanism | Default strategy |
|---|---|---|---|
| Mill work-roll bearing | overheating / vibration | fatigue/wear | CONDITION_BASED (vibration) |
| Hydraulic AGC | pressure loss / external leak | seal wear | TIME_BASED + inspection |
| Annealing furnace fan | bearing failure | wear | METER_BASED (run-hours) |
| EOT crane brake | brake fade | wear | TIME_BASED |
| Air compressor | air leak / overheating | wear/fouling | CONDITION_BASED |

## 7. Interfaces

Registry CRUD via REST (spec 07): `/v1/maint/assets/{id}/profile`, `/v1/maint/items`, `/v1/maint/failure-modes`. Bulk asset/equipment import arrives via Manifold (SAP PM functional location + equipment → hierarchy + `asset_profile`).

## 8. NFRs

Hierarchy reads cached in serving; `maintainable_item` self-join bounded (≤4 levels); failure-mode lookups indexed by `(tenant_id, asset_id)`.

## 9. Acceptance criteria

- **MUST** model an asset to L9 and attach failure modes with the ISO 14224 quartet.
- **MUST** compute `rpn` and allow an `assigned_strategy` per failure mode.
- **MUST** load the Hero Steels seed template and a generic non-steel template from the same schema (D11).
- **SHOULD** derive asset criticality from FMECA roll-up when not set manually.

## 10. Build phasing

**M2-0:** asset_profile + maintainable_item + failure_mode + seed templates + registry CRUD. Precedes the PM engine (03) which needs criticality + strategy.

## 11. Risks

Taxonomy churn (effective-date / version seed sets); inconsistent criticality scoring across plants (provide a documented banding rubric); incomplete L7–L9 data from legacy CMMS (allow asset-level failure modes when item-level is absent).
