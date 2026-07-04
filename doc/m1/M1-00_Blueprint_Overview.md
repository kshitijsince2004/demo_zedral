**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-00   ·   Document 1 of 10

**Blueprint Overview & Index**

Module M1 — Data Capture Layer · executive overview, design principles, modularity & document map

**Document set — M1 Technical Blueprint**

| Doc | Title |
| --- | --- |
| M1-00 | Blueprint Overview & Index |
| M1-01 | System Architecture |
| M1-02 | Process-Wise Data Capture Design |
| M1-03 | UX Design & Operator Workflow |
| M1-04 | Data Model & Database Design |
| M1-05 | Role-Based Access Control & Security |
| M1-06 | Planning Integration & Export |
| M1-07 | Validation Framework |
| M1-08 | Audit Trail & Compliance |
| M1-09 | Reporting & Monitoring |

Prepared for Z Company  ·  Role: Manufacturing Digital Transformation Consultant / Industrial Software Architect

Version 1.0  ·  30 May 2026  ·  Confidential

**Contents**

# 1. Executive Summary

Module M1 (Data Capture Layer) replaces the paper log sheets used across the Hero Steels Cold Rolling Steel Plant with a digital capture system that operators use directly on shop-floor touchscreens and tablets. It is the foundation of the wider plant digitization initiative: every downstream module — quality analytics, OEE, traceability, planning feedback — depends on the clean, structured, real-time data that M1 captures at source.

The preceding mapping phase analysed **11 manual log sheets** across the full production sequence and cross-referenced them against **9 Work Instruction (WI/PRD) SOPs**. It cataloged **317 individual field captures** and reduced them to **115 distinct canonical fields** — **35 shared master fields** that recur across lines and **80 process-specific fields** unique to one line. That separation is the backbone of M1: shared fields become reusable master tables and a common header block; unique fields become each form's process-specific section. This document set turns that analysis into a build-ready technical architecture.

| The single design idea that everything else follows from COIL_NO is the spine of the entire plant. Every process appends to the same coil record as it flows HR Slitting → Pickling → Cold Rolling → Annealing → Skin Pass → Rewinding → CRS → CTL. Annealing adds a charge/base grouping layer over coils. Capture once, reuse everywhere, trace end-to-end. |
| --- |

## 1.1 At a glance

| Metric | Value |
| --- | --- |
| Manual log sheets replaced | 11 |
| Process lines covered | 8 master lines (HR Slitting → CTL); Cold Rolling spans 2HI / 4HI / 6HI |
| Field captures cataloged | 317 |
| Canonical (de-duplicated) fields | 115 (35 shared + 80 process-specific) |
| M1 capture forms | 10 (one per process; Pickling adds an hourly chart form) |
| Target data-entry time per coil | ≤ 30–45 seconds (mostly taps, minimal typing) |
| Auto-populated share of fields | ≈ 55–70% sourced from plan / coil master / previous process |
| Documents in this blueprint set | 10 (this index + 9 design documents) |

## 1.2 Objectives & success criteria

M1 is judged by operator adoption, not by feature count. The design therefore prioritises UX simplicity over software complexity, and is measured against concrete, testable targets:

| Objective | How M1 delivers it | Success measure |
| --- | --- | --- |
| Minimum clicks | Pick-from-plan autofill, dropdowns, toggles, numeric keypads | ≤ 6 taps to log a routine coil |
| Minimum typing | Auto-source from plan/coil/previous process; last-value defaults | ≤ 2 free-typed fields per coil |
| Maximum automation | SAP / CSV / coil master / previous-process carry-forward | 55–70% of fields pre-filled |
| Error-proof entry | Inline validation, range guards, dependency checks, duplicate block | < 1% rejected on review |
| Multi-shift support | Shift-scoped logs, structured handover, carry-open-coils | Zero data loss at shift change |
| High adoption | Large touch targets, offline-tolerant, fast, role-scoped views | > 90% lines on M1 within pilot+2 months |

# 2. Design Principles

Two principles govern every screen and table in this blueprint.

## 2.1 Ease of use on the shop floor

Operators work standing, often gloved, beside running machinery. Every interaction is designed for that reality: large buttons, high-contrast controls, and input types matched to the data. Wherever a value is one of a known set, M1 uses a **dropdown, radio group, or toggle** rather than a text box. Numbers are entered on a large on-screen **numeric keypad**. Coils, customers, and grades are chosen by **auto-complete** search. Free text is reserved for genuine remarks only.

## 2.2 Minimise manual entry — source automatically

An operator should only enter what cannot be known in advance — the measured and observed values of the shift. Everything else is sourced automatically. The hierarchy of truth is: Planning (SAP PP / PP&C CSV) → Coil Master → Customer Order / Grade spec → Previous-process output. M1 pre-fills from the highest available source and leaves the operator to confirm or measure.

| Auto-sourced from | Examples of fields filled before the operator arrives |
| --- | --- |
| Production Planning (SAP / CSV) | Target MT, planned coils for the shift, customer, grade, planned width/thickness, due priority |
| Coil Master (COIL_NO) | Grade, surface finish, customer, nominal width/thickness, heat no., parent coil |
| Previous process output | Incoming thickness, incoming weight, achieved hardness, current status |
| Customer / Grade spec | Hardness band, UTS / elongation limits, roughness target (for quality validation) |
| System / context | Date, shift, line, operator (from login), Sl. No., timestamps, derived totals |

*Table. The auto-source contract — detailed field-by-field in M1-06 (Planning Integration).*

| Operator's true workload After autofill, a routine coil needs only: confirm the suggested coil, enter the measured output value(s), tap any defect/stoppage, and submit. That is the whole interaction the UX is optimised around (M1-03). |
| --- |

# 3. Scope of Module M1

| In scope for M1 | Out of scope (later modules) |
| --- | --- |
| Digital capture of production, quality, process, machine & downtime data for all 10 processes | Advanced SPC / quality analytics engine (consumes M1 data) |
| Shared master data (customer, grade, defect, stoppage, operator, furnace) | Plant-wide OEE optimisation & scheduling algorithms |
| Coil master & end-to-end traceability spine | Maintenance management / condition monitoring |
| Planning auto-population (CSV import + SAP integration) | Energy / utilities metering integration |
| Validation, audit trail, RBAC, role dashboards | Automated PLC / SCADA tag acquisition (future enhancement) |
| Temporary export feature (CSV / XLSX) | Customer-facing quality certificate generation |

# 4. Modularity, Granularity & Connection to Other Modules

M1 is explicitly built to be consumed by other modules. Modularity is achieved at three levels — data, service, and form — so that future modules attach to stable contracts rather than to M1's internals.

| Level | Granularity decision | Why it helps later modules |
| --- | --- | --- |
| Data | One canonical field = one column, with unit embedded (UPPER_SNAKE_CASE); one master per real-world entity; coil is atomic | Modules join on stable keys (COIL_NO, GRADE_CODE) with no re-mapping or unit conversion |
| Service | Capture, validation, master-data, reporting exposed as separate APIs | A new module calls the read API / event stream; it never reaches into tables |
| Form | Shared header + sub-forms (stoppage, defect, crew) reused; process-specific section isolated per process | Adding a line or field touches one process module, not the platform |

Every captured row carries the keys other modules need: COIL_NO, PROCESS_ID, SHIFT_LOG_ID, GRADE_CODE, CUSTOMER_ID, and timestamps. M1 publishes domain events (coil captured, shift submitted, defect logged, stoppage logged) and exposes a read replica for analytics. This lets the planned modules below attach cleanly:

- **M2 — Quality & SPC:** consumes hardness, UTS, elongation, roughness and defect events against grade/customer spec.
- **M3 — OEE & Downtime analytics:** consumes stoppage entries, run times, target vs actual production.
- **M4 — Traceability & Genealogy:** walks the COIL_NO spine and annealing charge/base grouping for full coil history.
- **M5 — Planning feedback:** returns actuals (produced, yield, holds) to SAP PP / PP&C against the plan.
- **M6 — WIP & Inventory:** uses coil status and next-destination routing (e.g. the For-CTL flag).
- **M7 — Maintenance:** uses machine parameters (roll changes, oil, coolant, steam) as leading indicators.

| Module contract rule Other modules read M1 data only through versioned APIs, the event stream, or the read replica — never by writing into M1 tables. M1 remains the single system of record for shop-floor capture. |
| --- |

# 5. Temporary Export Feature

Until the SAP round-trip and downstream modules are live, M1 includes a clearly-scoped, temporary **export feature** so the plant can keep feeding existing spreadsheets and reports during the transition. It lets Supervisors, Plant Head and Admin export captured data as CSV or XLSX, filtered by process, date range, shift, or coil. Exports are logged (who, what, when) in the audit trail. The feature is deliberately flagged as interim — it is replaced by the standing integration once M5/M6 are in production, and is documented fully in M1-06.

# 6. Document Map

This blueprint is delivered as a linked set of ten documents. Read this index first; then each design document is self-contained and can be owned by a different team.

| Doc | Title | What it covers |
| --- | --- | --- |
| M1-00 | Blueprint Overview & Index | This document — summary, principles, modularity, export, glossary |
| M1-01 | System Architecture | High-level, application, data-flow, integration, user-access & database views; tech stack |
| M1-02 | Process-Wise Data Capture Design | All 10 processes: screens, workflow, auto/manual fields, validation, approval, handover, exceptions |
| M1-03 | UX Design & Operator Workflow | Screen-by-screen specs, click counts & entry time, device layouts, error prevention; prototype |
| M1-04 | Data Model & Database Design | Master/transaction/reference/user/audit/planning tables, ER diagram, full SQL DDL, keys |
| M1-05 | RBAC & Security | Operator/Supervisor/Plant Head/Admin roles, full permission matrix, access architecture |
| M1-06 | Planning Integration & Export | CSV import + SAP integration, field auto-source map, temporary export feature |
| M1-07 | Validation Framework | Range, mandatory, dependency, duplicate & integrity rules by data category |
| M1-08 | Audit Trail & Compliance | Audit logging, change history, correction & approval workflow, traceability |
| M1-09 | Reporting & Monitoring | Dashboards per role; OEE, downtime, yield, rejections, traceability, quality, shift KPIs |

Two companion files accompany the set: **M1_schema.sql** (the runnable PostgreSQL DDL behind M1-04) and **M1_Operator_Prototype.html** (the clickable shop-floor screen prototype behind M1-03).

# 7. Naming Convention & Glossary

All identifiers follow <ENTITY>_<ATTRIBUTE>[_<UNIT>] in UPPER_SNAKE_CASE, with the unit embedded wherever a measure has one. Weight is stored in **MT** plant-wide (CTL, which logs kg on paper, is converted on entry). The full variant-to-standard mapping lives in M1-04; the most-used terms are below.

| Term | Meaning |
| --- | --- |
| COIL_NO | Single normalised coil identity — the traceability spine across all processes |
| ANN_CHARGE_NO / ANN_BASE_NO | Annealing furnace-charge grouping over the coils loaded together |
| SHIFT_LOG | The per-date, per-shift, per-process header record that owns all entries for that shift |
| GRADE_CODE / SURFACE_FINISH | Steel grade and finish (Matt/Bright), split into two fields (were combined on paper) |
| For-CTL flag | Routing marker set at CRS that sends a coil's weight onward to the Cut-to-Length line |
| HROP / CRCA | Grade families that drive process limits (e.g. pickling line-speed band) |
| MPM / kg·cm⁻² / N·mm⁻² | Units: line speed (m/min), pressure, tensile strength — embedded in field names |

# 8. Assumptions & Open Items

The design proceeds on a small set of assumptions to be confirmed with line owners before build sign-off. None blocks architecture; each affects a specific field definition.

- A few abbreviations (W/P, Y.Sr, IB/TIECV, Burr/Meghor pressure) must be confirmed and added to the M1 data dictionary.
- Consolidated plant-wide defect-code and stoppage-code masters (union of the per-sheet lists) to be approved.
- Standardised unit policy — MT plant-wide — to be signed off, with kg shown as a derived view on CTL.
- SAP integration scope (read-only plan pull first; actuals write-back in a later phase) to be confirmed with IT/SAP.
- Device standard per line (industrial touchscreen vs tablet) and network/offline expectations to be confirmed.
