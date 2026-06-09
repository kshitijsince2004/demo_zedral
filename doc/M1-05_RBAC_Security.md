**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-05   ·   Document 6 of 10

**Role-Based Access Control & Security**

Roles, line-scoping, the full permission matrix and the access-control architecture

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

# 1. Access Model Overview

M1 access is governed by two independent dimensions: **role** (what kind of action a user may take) and **line scope** (which processes/lines their actions apply to). A user's effective permission is the intersection of the two. This separation lets the plant grant, for example, Supervisor actions on three specific lines without granting them everywhere — and it is enforced in the data layer so every API inherits it automatically.

*Figure. Authentication, role resolution and line-scoped data access*

# 2. Roles

## 2.1 Operator

The shop-floor user who captures data. Scoped to a single assigned production line and the current shift.

- Can access **only the assigned production line** — other lines are invisible, not merely read-only.
- Can **enter and edit shift data** for the current shift (own draft entries).
- **Cannot modify master data** (customers, grades, codes) — only select from it.
- Can raise a correction request on locked data, but cannot approve it.
- Sees only own-line dashboards and coil traceability within scope.

## 2.2 Supervisor

Reviews and is accountable for the data quality of the lines they own.

- Access to **multiple lines** (their assigned set).
- **Reviews operator entries**; approves/locks shift logs.
- **Approves corrections** to locked data, with a recorded reason.
- **Monitors shift performance**; can override a validation block with a logged justification.
- Views reports and exports within scope.

## 2.3 Plant Head

Plant-wide visibility for oversight and decision-making — read and analyse, not capture.

- Access to **all lines** (read-only on transactional data).
- Views **dashboards** and **production / quality / downtime / traceability analytics** (M1-09).
- Can export and drill down anywhere; does not capture or approve operational entries.

## 2.4 Admin

Configures and maintains the system; the only role that touches master data and integration.

- **User management** and **role management** (assign roles and line scope).
- **Master data management** (customers, grades, defect & stoppage codes, operators, furnaces, specs).
- **SAP / CSV integration management** (connections, mappings, schedules).
- **Workflow configuration** (validation thresholds, approval rules) and **audit controls**.
- Does not routinely capture production data; all admin actions are audit-logged.

# 3. Permission Matrix

Capabilities by role. **Y** = allowed; **R/Own/Multi/All** = allowed within that data scope; **Config** = governed by an Admin-set workflow rule; **—** = not permitted.

| Capability | Operator | Supervisor | Plant Head | Admin |
| --- | --- | --- | --- | --- |
| Log in (SSO / badge+PIN) | Y | Y | Y | Y |
| View own assigned line | Y | Y | Y | Y |
| View other / all lines | — | Multi | All | All |
| Create / edit shift data (own line, current shift) | Y | Y | — | — |
| Edit submitted data (pre-approval) | Own | Y | — | — |
| Submit shift log | Y | Y | — | — |
| Approve / lock shift log | — | Y | — | — |
| Approve correction (post-lock) | — | Y | — | Config |
| Raise correction request | Y | Y | — | — |
| Override validation (with reason) | — | Y | — | Y |
| View dashboards & analytics | Own | Multi | All | All |
| Coil traceability search | Own | Y | Y | Y |
| Export data (temp feature) | — | Y | Y | Y |
| Manage master data | — | — | — | Y |
| Manage users & roles | — | — | — | Y |
| Configure SAP / CSV integration | — | — | — | Y |
| Configure validation / workflow | — | — | — | Y |
| View audit trail | — | Own scope | All | All |

# 4. Line-Scoping (row-level security)

Line scope is data held in security.line_access(user_id, process_id, access_level). Every query for transactional data is filtered by the caller's accessible processes at the data layer (PostgreSQL row-level security / enforced in the data-access layer). Because the filter is applied server-side, an operator cannot reach another line's data through any route — UI, API or export.

| access_level | Meaning |
| --- | --- |
| READ | May view entries for the line (e.g. Plant Head, or a cross-trained operator) |
| WRITE | May create/edit draft entries for the line (Operator on assigned line) |
| APPROVE | May approve/lock and approve corrections for the line (Supervisor) |

# 5. Authentication & Session Security

- **SSO via OIDC** against the plant identity provider; **badge + PIN** fallback for shared shop-floor terminals.
- Short-lived JWT access tokens validated at the API gateway; refresh handled transparently by the PWA.
- Shared-terminal sessions auto-lock after inactivity; the next operator badges in without losing queued work.
- Optional MFA for Admin and remote (management) access.
- All traffic over TLS; service-to-service calls use least-privilege service accounts.

# 6. Security Controls Summary

| Control | Implementation |
| --- | --- |
| Least privilege | Role × line-scope intersection; default deny |
| Separation of duties | Operators capture, Supervisors approve, Admins configure — never the same action |
| Auditability | Every create/update/delete and every login/export logged immutably (M1-08) |
| Override governance | Validation overrides require a reason and are restricted to Supervisor/Admin |
| Master-data protection | Only Admin writes masters; all forms read them |
| Data-in-transit / at-rest | TLS everywhere; encryption at rest on DB and object store |
| Account lifecycle | Joiners/movers/leavers via Admin; disabled accounts retain their audit history |

| Enforcement principle Permissions are enforced on the server, never only in the UI. Hiding a button is a convenience; the API and the row-level filter are the real control. |
| --- |
