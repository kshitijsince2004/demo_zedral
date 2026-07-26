**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-09   ·   Document 10 of 10

**Reporting & Monitoring**

Role-based dashboards and KPI definitions — production, OEE, downtime, yield, rejections, traceability, quality and shift performance

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

# 1. Reporting Approach

Because M1 captures clean, structured data at source, reporting is a read concern — no re-keying, no spreadsheet stitching. All dashboards read from the BI replica so analytics never competes with capture. Each role sees a dashboard scoped to its responsibility and access (M1-05): the operator sees their shift, the supervisor their lines, the plant head and management the whole plant. Every KPI tile drills down to the underlying coils, so a number is never a dead end.

*Figure. Illustrative supervisor view — OEE breakdown and production vs target*

# 2. Dashboards by Role

## 2.1 Operator dashboard

- Target vs produced for the current shift; open vs done coils.
- Running stoppage timer and today's stoppage tally; missed chart slots (Pickling) flagged.
- Personal/line pace; next planned coils queued.
- Purpose: keep the operator on pace and nothing forgotten — not analysis.

## 2.2 Supervisor dashboard

- Multi-line shift status; entries pending review/approval.
- Line OEE, downtime Pareto (by stoppage code), yield and rejection rate.
- Holds and exceptions needing a decision; validation overrides used.
- Purpose: run the shift and assure data quality across owned lines.

## 2.3 Plant Head dashboard

- Plant-wide OEE and trend; production vs plan by line, grade, customer.
- Quality trends and top defects; downtime drivers; yield and scrap trends.
- Coil traceability search across all lines.
- Purpose: oversight and prioritisation — read and analyse, no capture.

## 2.4 Management dashboard

- Executive KPI summary: throughput, OEE, on-time vs plan, rejection cost, trend vs target.
- Period comparisons (shift/day/week/month); export for board reporting (interim, M1-06).
- Purpose: strategic view of plant performance.

# 3. Core KPIs & Definitions

All KPIs derive from M1 capture — no separate data entry. Definitions are fixed plant-wide so a number means the same thing on every screen.

| KPI | Definition | Built from |
| --- | --- | --- |
| Production tracking | Produced MT vs target, by shift/line/grade/customer | shift_log.target, prod_* weights |
| OEE | Availability × Performance × Quality | run time vs stoppages; rate vs ideal; good vs total |
| Availability | Run time ÷ planned time (1 − downtime share) | stoppage_entry durations vs shift length |
| Performance | Actual rate ÷ ideal rate | produced vs time taken vs line standard |
| Quality rate | Good output ÷ total output | weight minus rejection/scrap/hold |
| Downtime | Total & by reason (Pareto) | stoppage_entry grouped by stoppage_code/category |
| Yield | Good output ÷ input (1 − scrap%) | input weight vs good weight; scrap_mt |
| Rejections | Rejection MT & rate; OD/ID split at CRS | rejection_mt, rejection_od/id_mt |
| Coil traceability | Full forward/backward genealogy of any coil | coil_process_history, parent/child, charge grouping |
| Quality trends | Hardness/UTS/elongation/roughness vs spec over time | prod_crm / prod_crs vs grade_spec |
| Shift performance | Output, OEE, downtime, rejections by shift & crew | shift_log, crew_entry, prod_* |

# 4. Standard Reports

- **Daily production report** — by line and shift, vs plan, with yield and rejection.
- **Downtime / stoppage analysis** — Pareto by reason and category, by line and period.
- **Quality report** — properties vs spec, defect frequency, complaint root-cause via traceability.
- **Coil genealogy report** — the full history of a coil for customer audits (M1-08).
- **Shift handover report** — produced vs target, open coils and holds carried forward.
- **Plan-vs-actual** — fulfilment against the PP&C/SAP plan, feeding the planning loop (M1-06).

# 5. Monitoring & Alerts

| Signal | Who sees it | Trigger |
| --- | --- | --- |
| Behind target | Operator, Supervisor | Produced vs pace falls below threshold |
| Extended stoppage | Supervisor | A stoppage exceeds its expected duration |
| Missed chart slot | Operator, Supervisor | Pickling hourly slot not entered |
| Out-of-spec quality | Supervisor, Plant Head | Measured property breaches grade/customer spec |
| Rejection spike | Supervisor, Plant Head | Rejection rate above rolling baseline |
| Pending approvals | Supervisor | Submitted shift logs awaiting review |

# 5b. Backlog Definitions

See [Backlog Definitions](../BACKLOG_DEFINITIONS.md) for plant KPI/drawer vs operator queue vs legacy handover rules.

# 6. Scalability & Modularity of Reporting

- Dashboards read the **replica**; heavy queries never slow capture, and reporting scales by adding replicas.
- KPIs are computed from canonical fields, so a **new line or field appears in analytics automatically** once captured.
- Reporting is a separate service consuming the same data other modules will use — M2 (quality/SPC) and M3 (OEE) extend rather than replace it.
- Definitions live in one semantic layer, so every dashboard, export and module shares identical KPI maths.
- Live, self-refreshing views can be published for shop-floor and management screens without bespoke builds.

| From capture to insight, no detour Every KPI in this document is a direct read over M1 capture. There is no parallel reporting database to reconcile — the system of record and the analytics source are the same data, separated only for performance. |
| --- |
