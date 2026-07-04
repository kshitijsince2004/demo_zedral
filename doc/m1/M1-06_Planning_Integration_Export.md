**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-06   ·   Document 7 of 10

**Planning Integration & Export**

CSV import and SAP integration for automatic data population, the auto-source field map, and the temporary export feature

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

# 1. Why Integration Matters

Integration is what makes M1 fast. Every field sourced from Planning, the coil master, or the previous process is a field the operator does not type. The plan also tells each line which coils to expect, so capture is ‘pick and confirm' rather than ‘search and key'. This document defines the two inbound paths — CSV first, SAP next — the field-level auto-source contract, and the interim export feature.

*Figure. Integration layer between source systems and the M1 core*

The integration layer isolates M1 from source-system detail. Connectors fetch; a mapping/transform step normalises names and units to the M1 canonical model; a staging area reconciles against existing data; and only validated records are upserted. The same staging discipline is used by both CSV and SAP, so the two paths converge before touching M1.

# 2. Option 1 — CSV Import (Phase 1)

CSV import delivers value on day one without waiting for SAP scope sign-off: the PP&C team's existing schedule spreadsheets are imported directly into M1's plan and coil master.

## 2.1 Import workflow

- **Provide file** — PP&C drops a CSV/XLSX to a watched folder, or Admin uploads it; a template defines the expected columns.
- **Parse & map** — columns map to canonical fields via a saved mapping profile; units normalised (kg→MT, etc.).
- **Validate** — each row checked against the import rules (below); errors collected, not fatal.
- **Stage & preview** — a staging batch shows valid vs error rows; Admin reviews the summary.
- **Load (upsert)** — valid rows create/update plan_order, coil_plan and coil master; the batch is recorded.
- **Report** — an import report lists loaded, updated, skipped and errored rows with reasons.

## 2.2 Validation & error handling

| Check | On failure |
| --- | --- |
| Required columns present & typed | Whole file rejected with a clear header error |
| Coil No unique within file & not conflicting | Row flagged; existing coil offered for update not duplicate |
| Customer / Grade exist in master | Row errored; unknown code listed for Admin to add or map |
| Numeric ranges (width/thk/qty) sane | Row errored with the offending value and expected range |
| Dates valid & not in the past beyond tolerance | Row warned; loadable with confirmation |

Partial success is supported: valid rows load, errored rows are exported back as a correction file. Re-importing the corrected file is idempotent — coils already loaded are updated, not duplicated, keyed on COIL_NO.

## 2.3 Scheduling

- **On-demand** — Admin uploads ad-hoc.
- **Scheduled** — a watcher polls the PP&C folder on a cron (e.g. each shift start) and auto-imports new files.
- **Event** — a file-arrival trigger starts the pipeline immediately.
- Every run produces an import_batch record (source, file, counts, status, who, when) for audit.

# 3. Option 2 — SAP Integration (Phase 2)

Once scope is agreed with plant IT/SAP, the CSV bridge is replaced by a live connection that pulls production orders, customer/grade master and QM specifications — and, in a later step, writes actuals back to SAP PP.

## 3.1 SAP architecture & middleware

- **Connector** — OData services (S/4HANA) or BAPI/RFC (ECC) exposed through SAP's integration tier (PI/PO, CPI, or an API gateway).
- **Middleware** — the M1 integration server orchestrates pulls, applies the mapping/transform, and manages staging, retries and idempotency.
- **Auth** — technical service user with least-privilege authorisations; OAuth/mTLS between middleware and SAP.
- **No direct DB coupling** — M1 never reads SAP tables directly; all exchange is via the service contract.

## 3.2 Data synchronisation flow

- Scheduled/event pull of new & changed production orders and master data (delta by change timestamp).
- Map to canonical fields & units; resolve/raise unknown customers/grades.
- Stage and reconcile against existing plan & coil master (insert/update/close).
- Upsert into M1 planning + coil master; record the sync batch.
- (Later) Write-back: on shift approval, post actuals (produced, yield, scrap, holds) to the SAP order.

## 3.3 Representative interfaces & mapping

| SAP object | Direction | Maps to M1 | Key |
| --- | --- | --- | --- |
| Production order (PP) | Inbound | planning.plan_order | sap_order_no |
| Order operations / routing | Inbound | planning.coil_plan | order + seq |
| Customer master | Inbound | master.customer | customer_code |
| Material / grade master | Inbound | master.grade | grade_code |
| QM inspection spec | Inbound | master.grade_spec | grade + customer |
| Confirmations (actuals) | Outbound | from shift_log / prod_* | sap_order_no |

# 4. Field Auto-Source Map

The contract for ‘what the operator never types'. Each field is sourced from the highest available authority; the operator only supplies measured/observed values.

| Field group | Auto-sourced from | Operator supplies instead |
| --- | --- | --- |
| Date / Shift / Line / Operator | System clock, device binding, login | — |
| Target MT, planned coil list | Planning (SAP PP / CSV) | — |
| Customer, Grade, Surface finish | Plan order → coil master | — (confirm only) |
| Nominal width / thickness | Coil master | Actual measured width/thickness |
| Incoming thickness / weight | Previous process output | Output thickness / weight achieved |
| Hardness / UTS / roughness limits | Grade/customer spec | Measured hardness / UTS / Ra |
| Sl. No., timestamps, totals | System (derived) | — |
| Defects, stoppages, crew | Codes from master (picked) | Which code, time, quantity |

| Net effect With plan + coil master + previous-process carry-forward in place, roughly 55–70% of a form's fields are populated before the operator touches it — the foundation of the ≤ 30–45 s entry target in M1-03. |
| --- |

# 5. Temporary Export Feature

An explicitly interim capability so the plant keeps feeding existing spreadsheets/reports during the transition, before downstream modules and SAP write-back are live. It is documented as temporary and is retired once M5/M6 are in production.

## 5.1 Scope & behaviour

| Aspect | Specification |
| --- | --- |
| Who | Supervisor (own scope), Plant Head & Admin (all) — never Operator |
| What | Captured entries filtered by process, date range, shift, grade, customer or coil |
| Formats | CSV and XLSX (canonical column names with units) |
| How | On-demand from a report view, or a saved scheduled export to a folder/email |
| Audit | Every export logged in audit.export_job (scope, params, row count, who, when) |
| Limits | Row-scope honours line access; large exports run async and notify on completion |

| Marked temporary by design The export feature is a transition bridge, not a long-term interface. Standing data exchange with other systems is via the versioned APIs, event stream and SAP write-back — the export is removed once those are in place. |
| --- |
