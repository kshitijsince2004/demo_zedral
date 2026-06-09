**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-08   ·   Document 9 of 10

**Audit Trail & Compliance**

Audit logging, change history, user and timestamp tracking, the correction & approval workflow, and full traceability

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

# 1. Compliance Goal

M1 must be able to answer, for any data point, four questions: what was recorded, who recorded it, when, and — if it changed — why. Paper sheets answered none of these reliably. M1 makes the answer automatic by logging every change immutably, governing corrections through an approval workflow, and tying every record to the coil traceability spine. This is both a quality requirement (customer audits, complaint investigation) and a control requirement (no silent edits).

# 2. Audit Logging

Every insert, update and delete on transactional and master data writes an immutable row to audit.audit_log. The log is append-only — no application path can edit or delete it — and is captured at the database layer (trigger) so nothing bypasses it.

| Audit field | Captures |
| --- | --- |
| table_name / record_pk | Exactly which record changed |
| action | INSERT / UPDATE / DELETE |
| column_name | Which field changed (for updates) |
| old_value / new_value | Before and after (full row JSON or field-level) |
| user_id | Authenticated user who made the change |
| change_request_id | Links the change to its approval, when post-lock |
| ts | Server timestamp (timezone-aware) |

| How it's enforced A generic trigger function (audit.fn_audit, in M1_schema.sql) is attached to each capture table. Because it runs in the database, the audit entry is written in the same transaction as the change — they succeed or fail together, so the log can never drift from reality. |
| --- |

# 3. Change History & Tracking

- **Full history per record** — the audit log reconstructs the complete change timeline of any entry, coil or charge.
- **User tracking** — every change carries the authenticated user; shared-terminal entries are still attributed via badge+PIN login.
- **Timestamp tracking** — creation, submission, approval and each amendment are individually timestamped.
- **Login & export tracking** — authentication events and every data export (audit.export_job) are logged.
- **Master-data history** — changes to customers, grades, codes and specs are audited like transactional data.

# 4. Data Correction Workflow

Corrections are expected — a mistyped weight, a wrong coil — but they must be controlled. Before a shift log is approved, the operator edits freely (every edit still audit-logged). After approval the record is locked, and any change requires a Supervisor-approved change request with a reason. The original value is never overwritten silently; the audit log keeps both.

*Figure. Entry lifecycle and post-lock correction workflow*

| State | Who can change | How |
| --- | --- | --- |
| DRAFT | Operator (own line) | Direct edit; audit-logged |
| SUBMITTED | Supervisor | Approve, or reject back to DRAFT with a note |
| APPROVED / LOCKED | No direct edit | Requires a change request |
| CORRECTION REQUESTED | Supervisor decides | Approve (with reason) → AMENDED, or reject |
| AMENDED | — | Change applied + audit-logged; record re-locked |

# 5. Approval Workflow

- **Submit** — at shift end the operator submits; the validation gate must pass (M1-07).
- **Review & approve** — the Supervisor reviews entries for the line and approves, which locks the shift log.
- **Reject** — sends the log back to DRAFT with a note for the operator to fix.
- **Correction approval** — post-lock changes need a Supervisor-approved change request capturing the reason.
- **Separation of duties** — the person who captures is not the person who approves (M1-05).

# 6. Full Traceability

Audit answers ‘who/when/why'; the coil spine answers ‘what happened to this material'. Together they give end-to-end traceability.

- **Forward & backward genealogy** — from a finished slit/sheet back to its parent HR coil, or forward from an HR coil to all its descendants.
- **Charge resolution** — an annealing charge resolves to its constituent coils and back, so a furnace issue maps to exactly the affected coils.
- **Cross-process record** — every process's capture for a coil is retrievable in sequence (the coil_process_history chain).
- **Defect & stoppage linkage** — defects and stoppages tie to the specific coil/shift, enabling complaint root-cause and downtime analysis.
- **Routing trail** — the For-CTL flag records why and when a coil moved to the CTL line.

| Customer-audit ready For any dispatched coil, M1 can produce its full history — dimensions and properties at each process, who recorded them, when, any corrections and their reasons, and the coils it shared a furnace charge with — without manual reconstruction. |
| --- |

# 7. Retention & Integrity

| Aspect | Approach |
| --- | --- |
| Immutability | Audit log is append-only; no application or user role can edit/delete it |
| Retention | Transactional & audit data retained per plant/customer policy; old partitions archived, not purged |
| Integrity | Audit written in the same DB transaction as the change; tamper-evident ordering by id + timestamp |
| Access | Audit visible to Plant Head & Admin (all) and Supervisor (own scope); never editable in-app |
| Backup / DR | Audit included in PITR backups and DR replication alongside the data it describes |
