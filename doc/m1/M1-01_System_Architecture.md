**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-01   ·   Document 2 of 10

**System Architecture**

High-level, application, data-flow, integration, user-access & database views, with a concrete recommended technology stack

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

# 1. Architecture Overview

M1 is a layered, service-oriented system that runs on the plant network and is reachable from every shop-floor device. The architecture is deliberately conservative: proven components, offline tolerance, clear separation of concerns, and stable contracts at every boundary so later modules attach without disturbing capture. Six views describe it — high-level, application, data flow, integration, user access, and database — followed by the recommended technology stack and deployment topology.

| Driver | Architectural response |
| --- | --- |
| Shop floor must keep working if the network blips | Offline-first PWA with a local queue; line edge cache; sync on reconnect |
| Entry must be fast under production pressure | Thin capture API, optimistic UI, server-side validation that returns in <300 ms |
| Data must be trustworthy and traceable | Single coil spine, server-enforced validation, immutable audit trail |
| Other modules will consume this data | Versioned REST APIs + domain events + read replica; no direct table access |
| Plant IT favours supportable, common technology | PostgreSQL, containerised services, standard OIDC SSO, SAP via OData/RFC |

# 2. High-Level Architecture

Six horizontal layers, with security, RBAC, audit and observability as cross-cutting concerns that touch every layer. Devices talk only to the application layer; the application layer talks only to the API layer; persistence, integration and analytics sit behind the services. This strict layering is what keeps the system modular.

*Figure. M1 high-level layered architecture*

| Layer | Responsibility |
| --- | --- |
| Presentation / Device | Industrial touchscreens, rugged tablets and browsers; renders forms and dashboards |
| Application (PWA) | Capture forms, master-data pickers, offline cache & sync engine, operator dashboard |
| API & Domain Services | Capture, validation, master-data, planning/import, reporting, auth/RBAC, export |
| Data / Persistence | PostgreSQL OLTP, BI read replica, object store for attachments/exports |
| Integration | SAP (PP/MM/QM), PP&C CSV import, coil-master sync, temporary export |
| Analytics & Monitoring | OEE, downtime, yield, rejections, traceability, quality trends, shift performance |

# 3. Application Architecture

The client is a single Progressive Web App (PWA) installed to the device home screen. It is composed of an app shell plus ten interchangeable process-form modules that all reuse the same shared components (header block, master-data pickers, stoppage/defect/crew sub-forms). An offline cache (IndexedDB) and a sync engine make capture resilient to network loss. The backend is a set of focused services behind one API gateway.

*Figure. Application components — client modules, API gateway, backend services*

## 3.1 Client composition

- **App shell & navigation** — login, line/shift context, routing; loads instantly from cache.
- **Process form modules (×10)** — one per process; each is just its process-specific section plus the shared blocks.
- **Master-data pickers** — customer, grade, defect, stoppage, operator; cached locally and searchable offline.
- **Offline cache (IndexedDB)** — the active shift's plan, coils and masters are pre-loaded at shift start.
- **Sync engine** — queues entries, retries on reconnect, resolves conflicts by last-writer-with-audit.
- **Operator dashboard** — target vs produced, open coils, running stoppage, shift progress.

## 3.2 Backend services

Services are independently deployable but share one database. Splitting them by responsibility keeps each small and lets reporting or integration scale separately from capture.

| Service | Responsibility |
| --- | --- |
| Capture | Create/update shift logs and process entries; orchestrates validation; emits events |
| Validation engine | Stateless rule evaluation (range, mandatory, dependency, duplicate, spec) — shared by client & server |
| Master-data | Serves and manages customer, grade, defect, stoppage, operator, furnace masters |
| Planning / Import | CSV import pipeline and SAP sync; populates plan & coil master |
| Reporting | Reads the replica; serves dashboards and KPI aggregates |
| Auth & RBAC | OIDC token validation, role & line-scope resolution, policy enforcement |
| Audit | Writes the immutable audit log; manages change requests |
| Export (temporary) | Generates filtered CSV/XLSX extracts; logs every export |

# 4. Data Flow Architecture

Data flows along the physical material path. Planning seeds the coil master; each process reads the coil's current state, captures its shift data, and writes the coil forward with refined dimensions and properties. Annealing introduces a charge/base grouping over coils. CRS may set a For-CTL routing flag. Every capture also feeds the reporting/traceability layer.

*Figure. Material-and-data flow with the COIL_NO traceability spine*

At each handoff the coil identity, grade and current dimensions/weight carry forward; thickness reduces through rolling, and mechanical properties are set at annealing and verified at CRS. Because all processes write to one coil record, a coil's full genealogy is reconstructable at any point — the basis of the traceability analytics in M1-09.

# 5. Integration Architecture

M1 sources planning and master data from SAP and the PP&C scheduling spreadsheets, and (interim) exports actuals back out. An integration layer isolates M1 from source-system specifics: connectors fetch, a mapping/transform step normalises to canonical fields and units, a staging area reconciles, and only validated records are upserted into M1.

*Figure. Integration layer between source systems and the M1 core*

- **Inbound, Phase 1 (CSV):** PP&C schedule files are dropped/scheduled, validated, staged and loaded into plan & coil master.
- **Inbound, Phase 2 (SAP):** OData/RFC connectors pull production orders, customer/grade master and QM specs on a schedule or event.
- **Outbound (interim):** the temporary export service produces CSV/XLSX for existing reports until write-back/modules are live.
- **Future:** actuals write-back to SAP PP and event publication to downstream modules (M2–M7).

# 6. User Access Architecture

Authentication is delegated to the plant identity provider via OIDC SSO (with a badge + PIN fallback for shared shop-floor terminals). The API gateway validates the token; the RBAC policy engine resolves the user's role and the lines they may access; and data access is filtered at the row level by line and role. An operator physically cannot see another line's data — the filter is applied server-side, not in the UI.

*Figure. Authentication, RBAC and line-scoped data access*

Role definitions and the full permission matrix are in M1-05. The key architectural point is that line-scoping is enforced in the data layer (row-level), so every API — capture, reporting, export — inherits the same access rules automatically.

# 7. Database Architecture

A single PostgreSQL primary handles OLTP capture, organised into logical schemas (master, coil, txn, planning, security, audit). A streaming read replica serves reporting and BI so analytics never competes with capture for resources. An object store holds attachments and generated exports; backups with point-in-time recovery and a DR standby protect the record.

*Figure. Database logical architecture and supporting stores*

The schema separation mirrors the modularity strategy: masters are shared and slowly-changing; transaction tables are append-heavy and partitioned by date; audit is write-once. Full table structures, keys and the runnable DDL are in M1-04 and the companion M1_schema.sql.

# 8. Recommended Technology Stack

The stack below is chosen for shop-floor reliability, plant-IT supportability, and a clean path to the later modules. It favours mature, widely-supported components over novelty.

| Layer | Recommendation | Why |
| --- | --- | --- |
| Client | React + TypeScript PWA (offline-first, service worker, IndexedDB) | One codebase for touchscreen/tablet/browser; installable; works through network blips |
| UI controls | Large-target component library; on-screen numeric keypad; virtualised pickers | Built for gloved, standing operators (see M1-03) |
| API | REST/JSON over HTTPS behind an API gateway; OpenAPI-documented | Simple, cacheable, easy for later modules to consume; versioned contracts |
| Services | Containerised (Docker) Node.js/TypeScript or Java/Spring Boot services | Independently deployable; common skills in plant IT |
| Validation | Shared rule library packaged for both client and server | Identical rules everywhere; no client/server drift (M1-07) |
| Database | PostgreSQL 15+ (primary + streaming read replica), date-partitioned txn tables | ACID, JSONB for flexible attributes, robust replication, no licence cost |
| Auth | OIDC SSO (Keycloak / Azure AD / plant IdP); badge+PIN fallback | Plant-standard identity; MFA where required; shared-terminal friendly |
| Integration | Scheduler + CSV pipeline now; SAP OData/RFC connector + middleware later | Phased: value from CSV immediately, SAP when scope is signed off (M1-06) |
| Object store | S3-compatible store (on-prem MinIO or cloud) | Attachments and exports off the OLTP database |
| Observability | Central logs + metrics + uptime alerts; structured audit | Operability and the compliance trail (M1-08) |
| Deployment | On-prem plant data centre (latency, autonomy) or private cloud | Capture must survive WAN loss; on-prem keeps the floor independent |

# 9. Deployment & Topology

Devices on each line reach an app-server cluster (load-balanced, 2+ nodes) in the plant data centre. A line edge cache buffers entries during brief network loss. The database runs primary + replica; an integration server brokers SAP/PP&C; a BI server reads the replica; backups stream to a DR site.

*Figure. Deployment topology — shop floor, plant data centre, SAP and DR*

## 9.1 Indicative sizing (pilot → plant-wide)

| Dimension | Pilot (1–2 lines) | Plant-wide (10 processes) |
| --- | --- | --- |
| Concurrent devices | 5–15 | 40–80 |
| Coil entries / day | 300–800 | 3,000–6,000 |
| App nodes | 2 (HA pair) | 3–4 behind LB |
| DB | 1 primary + 1 replica | 1 primary + 1–2 replicas, partitioned |
| Storage growth | ~1–2 GB / month | ~10–20 GB / month (excl. attachments) |

# 10. Non-Functional Requirements

| Quality | Target / approach |
| --- | --- |
| Availability | ≥ 99.5% on the floor; offline capture means brief outages don't stop work |
| Performance | Form open < 1 s; validate+save < 300 ms; dashboard < 2 s |
| Scalability | Stateless services scale horizontally; replica absorbs reporting load; txn tables partitioned by date |
| Resilience | Edge cache + client queue tolerate network loss; DB failover to replica; DR standby |
| Security | OIDC SSO, row-level line scoping, TLS everywhere, least-privilege service accounts (M1-05) |
| Auditability | Immutable audit log on every change; correction via approval workflow (M1-08) |
| Modularity | Versioned APIs + events + read replica; schema separation; one process module per line |
| Maintainability | Containerised, OpenAPI-documented, shared validation library, infrastructure-as-code |
