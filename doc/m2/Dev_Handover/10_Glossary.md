# 10 · Glossary — M2 Maintenance Intelligence

Terms specific to M2. Platform-wide terms (canonical model, Event Spine, Manifold, readiness, tenant) are in the platform glossary `../../Dev_Handover/09_Glossary.md`.

## Maintenance strategies (EN 13306)

- **Corrective maintenance** — work after fault recognition to restore function. *Immediate* (breakdown/emergency) or *deferred* (planned corrective).
- **Preventive maintenance** — work before failure. Splits into *predetermined* and *condition-based*.
- **Predetermined maintenance** — scheduled at a fixed time/usage interval, no condition check.
- **Condition-based maintenance (CBM)** — act when a measured parameter crosses a limit.
- **Predictive maintenance (PdM)** — CBM guided by a forecast of degradation (RUL). *Future scope.*
- **Run-to-failure (RTF)** — a deliberate RCM choice to not PM a low-criticality item.

## Reliability data (ISO 14224)

- **Failure mode** — the effect by which a failure is observed (e.g. "fails to start").
- **Failure mechanism** — the physical/chemical process (fatigue, wear, corrosion).
- **Failure cause** — the root circumstance (design/install/use/maintenance).
- **Failure effect/impact** — consequence on function/plant.
- **Maintainable item** — the lowest level routinely repaired/replaced (ISO 14224 L8).
- **Equipment taxonomy (L1–L9)** — industry→plant→…→equipment unit→subunit→item→part.

## Reliability methods

- **RCM** — Reliability-Centered Maintenance: assign a strategy per failure mode by feasibility + economics.
- **FMECA** — Failure Mode, Effects & Criticality Analysis; **RPN** = severity × occurrence × detectability.
- **Criticality** — A_CRITICAL / B_ESSENTIAL / C_GENERAL / D_LOW; drives PM intensity, WO priority, spares depth.

## KPIs

- **MTBF** — mean time between failures (operating time ÷ failures).
- **MTTR** — mean time to repair (Σ repair time ÷ repairs).
- **MTTF / MTBM** — mean time to failure (non-repairable) / between maintenance (all actions).
- **Inherent availability** — MTBF ÷ (MTBF + MTTR); reliability-based (distinct from time-based OEE availability).
- **PM compliance** — completed ÷ scheduled PMs (within window) × 100; target ≥90%.
- **Schedule compliance**, **PMP** (planned maintenance %), **planned:unplanned**, **backlog**, **failure Pareto / bad actors**.

## Predictive (future)

- **OSA-CBM / ISO 13374** — open architecture, six functional blocks: data acquisition → manipulation → state detection → health assessment → prognostics → advisory.
- **P-F curve** — from potential failure (P, first detectable) to functional failure (F); the **P-F interval** is the lead time PdM buys.
- **RUL** — remaining useful life (time-to-failure forecast).
- **Anomaly detection / survival model / failure classification** — the ML approaches, phased by data availability.

## M2 objects (schema)

- **asset_profile** — reliability attributes on a canon WORK_UNIT (criticality, nameplate, default strategy).
- **maintainable_item** — ISO 14224 L7–L9 subtree under an asset.
- **maintenance_plan / plan_trigger / maintenance_task** — PM definition: what, when, checklist.
- **notification / work_order** — problem report → authorised job (SAP-style split).
- **failure_event** — a failure occurrence; links the shared canonical `downtime_event_ref`.
- **meter / meter_reading** — usage counters for meter-based PM.
- **spare_part / spare_bom / wo_part / spare_txn** — MRO catalogue, asset BOM, consumption, stock ledger.
- **condition_alert / asset_health** — basic CBM alert (v1) / future RUL-health output slot (no v1 producer).
