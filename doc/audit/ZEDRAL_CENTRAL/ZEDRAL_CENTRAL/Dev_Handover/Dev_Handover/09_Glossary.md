# 09 · Glossary

| Term | Meaning |
|---|---|
| **Data Lake** | The storage + processing + serving substrate; the platform's core wedge. Zones: Raw → Standardized → Canonical → Serving. |
| **Manifold** | The data-integration & mapping engine inside the Data Lake (connectors, mapping, classification, validation, dedup/MDM, conformance, readiness). |
| **Canonical Data Model** | The single shared schema every module speaks; standards-anchored (ISA-95, ISO 22400). |
| **Event Spine** | The universal canonical Event entity that all time-stamped facts specialize from (state, downtime, count, quality, energy, sensor…). |
| **Unified Intelligence (UIL)** | The synthesis layer: KPIs, cross-module correlation, trends, financial impact, insights. |
| **Operational Monitoring** | The live, low-latency "what's happening now" layer off the streaming path. |
| **Reporting** | Formatted, scheduled, distributable documents bound to the shared KPI registry. |
| **Financial Impact** | Cross-cutting service that prices KPIs/events using effective-dated cost-rates. |
| **Zone (Raw/Standardized/Canonical/Serving)** | The four Data-Lake tiers (medallion); each with a strict contract. |
| **Golden record** | The single resolved master record for an entity after dedup + survivorship. |
| **Source-key map** | Mapping of every `(source_system, native_key)` to one canonical surrogate id. |
| **Readiness %** | Per tenant×module score (Required gate + Additional + Quality + History) deciding deployability. |
| **Data contract** | A module's declared Required/Additional canonical entities/fields. |
| **Sector template** | A reusable mapping bundle per industry (steel seeded from M1) for fast onboarding. |
| **Write-back** | Modules pushing derived intelligence (e.g. risk score, downtime class) into the Canonical zone. |
| **OEE** | Overall Equipment Effectiveness = Availability × Performance × Quality (ISO 22400). |
| **Six Big Losses** | Loss taxonomy mapping reason codes to OEE components (Availability/Performance/Quality). |
| **ISA-95** | Equipment hierarchy: Enterprise → Site → Area → Work Center → Work Unit. |
| **ISO 22400** | Standard manufacturing KPI definitions. |
| **COIL_NO** | M1 traceability spine (steel); generalizes to canonical asset/material identity. |
| **M1–M7 (platform)** | Modules: M1 Shopfloor Digitization, M2 Maintenance, M3 Shopfloor Ops, M4 OEE/Downtime, M5 Yield, M6 Quality, M7 Energy. |
| **M1 blueprint M2–M7** | *Different numbering* — the Hero Steels downstream roadmap; do not confuse with platform M2–M7. |
| **D1–D11** | The locked architectural decisions (see 00 §3). |
| **Zinance (FAMS)** | The user's other product; its import/export module is reused UX prior art (D10). |
| **CDC** | Change Data Capture (incremental ERP sync). |
| **MDM** | Master Data Management (dedup + survivorship → golden record). |
| **NFR** | Non-Functional Requirement. |
