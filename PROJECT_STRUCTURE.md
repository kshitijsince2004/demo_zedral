# ZedralV2 — M1 Digital Data Collection

**Hero Steels Limited · Cold Rolling Steel Plant · Digital Transformation Initiative**

> Module M1 (Data Capture Layer) replaces the paper log sheets used across the
> Hero Steels Cold Rolling Steel Plant with a digital, offline-first capture
> system that operators use directly on shop-floor touchscreens and tablets.
> It is the foundation of the wider plant digitization initiative — every
> downstream module (quality analytics, OEE, traceability, planning feedback)
> depends on the clean, structured, real-time data that M1 captures at source.

This document is a complete map of the repository: what the project is, how it
is built, the technology stack, the monorepo layout, every package, the domain
model, the data/material flow, the API surface, the database migrations, the
build/run tooling, and the in-flight feature specs.

---

## Table of Contents

1. [What This Project Is](#1-what-this-project-is)
2. [The Core Design Idea — the COIL_NO spine](#2-the-core-design-idea--the-coil_no-spine)
3. [Technology Stack](#3-technology-stack)
4. [Monorepo Layout (top level)](#4-monorepo-layout-top-level)
5. [Package: `@m1/shared-validation`](#5-package-m1shared-validation)
6. [Package: `@m1/server`](#6-package-m1server)
7. [Package: `@m1/client`](#7-package-m1client)
8. [Domain Model & Enums](#8-domain-model--enums)
9. [The Ten Processes](#9-the-ten-processes)
10. [Roles & RBAC](#10-roles--rbac)
11. [Database & Migrations](#11-database--migrations)
12. [Export Module](#12-export-module)
13. [Build, Run & Tooling](#13-build-run--tooling)
14. [Deployment Topology](#14-deployment-topology)
15. [Feature Specs (`.kiro/specs`)](#15-feature-specs-kirospecs)
16. [Reference Documentation (`/doc`)](#16-reference-documentation-doc)
17. [Full Directory Tree](#17-full-directory-tree)

---

## 1. What This Project Is

M1 is a layered, service-oriented system that runs on the plant network and is
reachable from every shop-floor device. The design is deliberately
conservative: proven components, offline tolerance, clear separation of
concerns, and stable contracts at every boundary so later modules attach
without disturbing capture.

| Metric | Value |
| --- | --- |
| Manual log sheets replaced | 11 |
| Process lines covered | 8 master lines (HR Slitting → CTL); Cold Rolling spans 2HI / 4HI / 6HI |
| Field captures cataloged | 317 |
| Canonical (de-duplicated) fields | 115 (35 shared + 80 process-specific) |
| M1 capture forms | 10 (one per process; Pickling adds an hourly chart form) |
| Target data-entry time per coil | ≤ 30–45 seconds (mostly taps, minimal typing) |
| Auto-populated share of fields | ≈ 55–70% sourced from plan / coil master / previous process |

**Design principles**

- **Ease of use on the shop floor** — large touch targets, high-contrast
  controls, on-screen numeric keypad, "glove mode", dropdowns/toggles over
  free text. Operators work standing, often gloved, beside running machinery.
- **Minimise manual entry, source automatically** — the hierarchy of truth is
  Planning (SAP PP / PP&C CSV) → Coil Master → Customer/Grade spec →
  Previous-process output. M1 pre-fills from the highest available source; the
  operator only confirms or measures.

**Scope (in M1):** digital capture for all 10 processes, shared master data,
coil traceability spine, planning auto-population (CSV import + future SAP),
validation, audit trail, RBAC, role dashboards, and a temporary CSV/XLSX export
feature.

**Out of scope (later modules M2–M7):** advanced SPC/quality analytics, plant-wide
OEE optimisation, maintenance management, energy metering, PLC/SCADA
acquisition, customer-facing certificates.

---

## 2. The Core Design Idea — the COIL_NO spine

> **COIL_NO is the spine of the entire plant.** Every process appends to the
> same coil record as it flows
> `HR Slitting → Pickling → Cold Rolling → Annealing → Skin Pass → Rewinding → CRS → CTL`.
> Annealing adds a charge/base grouping layer over coils. Capture once, reuse
> everywhere, trace end-to-end.

Every captured row carries the keys other modules need: `COIL_NO`,
`PROCESS_ID`, `SHIFT_LOG_ID`, `GRADE_CODE`, `CUSTOMER_ID`, and timestamps. M1
publishes domain events (coil captured, shift submitted, defect logged,
stoppage logged) and exposes a read replica for analytics. Other modules read
M1 data only through versioned APIs, the event stream, or the read replica —
never by writing into M1 tables.

---

## 3. Technology Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript (workspace-wide) | `typescript ^5.5` at root; client uses `~6.0` |
| Monorepo | npm workspaces | `packages/*` |
| Client | React 18 + Vite PWA | offline-first, service worker, IndexedDB |
| Client routing | `react-router-dom` v7 | see `src/App.tsx` |
| Client state | `zustand` | stores in `src/store`, `src/lib/*Store.ts` |
| Forms | `react-hook-form` + `@hookform/resolvers` | |
| Charts | `recharts` | analytics/reporting |
| Icons | `lucide-react` | |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) | |
| Offline | `idb`, `idb-keyval`, Workbox, `vite-plugin-pwa` | local queue + sync |
| Server | Node.js + Express 4 | `src/index.ts` |
| Query builder | Kysely (`pg` driver) | typed SQL, RLS-aware driver wrapper |
| Database | PostgreSQL 15 (primary + read replica) | row-level security, partitioned txn tables |
| Migrations | `node-pg-migrate` | `packages/server/migrations` |
| Auth | JWT (`jsonwebtoken`); OIDC SSO + badge/PIN fallback | RLS line-scoping enforced in DB |
| File upload | `multer` | CSV/XLSX import |
| Spreadsheets | `exceljs`, `xlsx` | import + export rendering |
| PDF/XLSX export | `puppeteer` (optional), `exceljs` | export renderers |
| Object storage | S3-compatible (`@aws-sdk/client-s3`, optional) | export artifacts |
| Validation | Shared `zod`-based rule library | identical rules on client & server |
| Testing | Vitest + `fast-check` (property-based) + `supertest` | |
| Containers | Docker / docker-compose | Postgres primary+replica, nginx gateway, backend |
| Gateway | nginx | proxies `/api/` → backend |

---

## 4. Monorepo Layout (top level)

```
ZedralV2/
├── package.json                 # root workspace; orchestration scripts
├── docker-compose.yml           # Postgres primary+replica, nginx, backend
├── nginx.conf                   # API gateway → backend:3000
├── deploy/
│   └── docker-compose.hybrid.yml
├── convert_docx_to_md.py        # doc tooling: DOCX → Markdown
├── extract_docx.py              # doc tooling: DOCX text extraction
├── doc_summary.txt              # plain-text dump of the M1 blueprint docs
├── doc/                         # M1 technical blueprint (10 docs) + schema + plans
├── packages/
│   ├── shared-validation/       # @m1/shared-validation — types + rules (client+server)
│   ├── server/                  # @m1/server — Express API, services, migrations
│   └── client/                  # @m1/client — React PWA
└── .kiro/
    └── specs/                   # feature specs (requirements/design/tasks)
```

**Root `package.json` scripts** (fan out across workspaces):

| Script | Action |
| --- | --- |
| `npm run dev` | `dev` in every workspace that defines it |
| `npm run build` | `build` in every workspace |
| `npm run test` | `test` in every workspace |
| `npm run lint` | `lint` in every workspace |
| `npm run migrate` | run DB migrations (`-w @m1/server`) |
| `npm run seed:pilot` / `seed:admin` | seed pilot / admin data |
| `npm run smoke:pilot` / `smoke:api` | smoke tests |

---

## 5. Package: `@m1/shared-validation`

The single source of truth for domain **types** and **validation rules**, built
once and consumed by both client and server so the rules never drift.

```
shared-validation/src/
├── index.ts                     # barrel: re-exports types, rules, calc engine
├── rules/
│   ├── fieldRules.ts            # field-level range/mandatory/dependency rules
│   ├── shiftLogRules.ts         # shift-log-level rules
│   ├── sixHiRules.ts            # 6HI cold-rolling-specific rules
│   ├── overrides.ts             # supervisor override handling
│   └── runner.ts                # stateless rule evaluation engine
├── types/
│   ├── index.ts                 # type barrel
│   ├── enums.ts                 # ShiftLogState, CoilStatus, StoppageCategory, CrewRole, ProcessLine
│   ├── roles.ts                 # UserRole, ROLE_RANK, ROLE_LABELS
│   ├── models.ts                # BaseProcessEntry and shared models
│   ├── processes.ts             # per-process entry interfaces (HRS, PKL, CRM, ANN, SKP, RWD, CRS, CTL)
│   ├── processRoute.ts          # process-route engine types
│   ├── live.ts                  # live-operations view types
│   ├── sixHi.ts                 # 6HI domain types
│   └── validation.ts            # validation result/error types
└── utils/
    └── calculationEngine.ts     # derived-field calculations (scrap %, totals, etc.)
```

- Depends on `zod`. Tested with Vitest + `fast-check`.
- `isSharedValidationWorking()` is a trivial export-health check.

---

## 6. Package: `@m1/server`

Express API behind one gateway. Services are split by responsibility but share
one database. RLS (row-level security) tenant/line scoping is enforced in the
data layer via a custom Kysely driver.

### 6.1 Bootstrap & infrastructure

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Express app; mounts all route modules; `/health`; starts `ExportWorker` + `ExportScheduler`; validates auth config at startup |
| `src/db.ts` | Kysely setup; `RlsDriver`/`RlsPostgresDialect` set `app.user_id` / `app.change_request_id` per connection; primary + replica pools; `reportingDb`; `withTenantContext()` transaction helper sets `app.tenant_id`/`app.correlation_id` GUCs |
| `src/db-types.ts` | Generated Kysely DB types (`kysely-codegen`) |
| `src/context.ts` | `AsyncLocalStorage` request context (tenant, user, correlation id) |

### 6.2 Routes (`src/routes`) — mounted in `index.ts`

| Mount | File | Purpose |
| --- | --- | --- |
| `/auth` | `authRoutes.ts` | login, token, SSO/PIN |
| `/device` | `deviceRoutes.ts` | device registration/binding |
| `/planned-coils` | `plannedCoilRoutes.ts` | planned coil list |
| `/6hi` | `sixHiRoutes.ts` | 6HI cold-rolling capture |
| `/live` | `liveRoutes.ts` | live operations board |
| `/machine-access` | `machineAccessRoutes.ts` | machine/line access |
| `/shift-logs` | `shiftLogRoutes.ts` | shift log header CRUD/lifecycle |
| `/entries` | `entriesRoutes.ts` | process entry capture |
| `/stoppages` | `stoppageRoutes.ts` | stoppage sub-form |
| `/crew` | `crewRoutes.ts` | crew sub-form |
| `/defects` | `defectRoutes.ts` | defect sub-form |
| `/auto-source` | `autoSourceRoutes.ts` | auto-fill source resolution |
| `/change-requests` | `changeRequestRoutes.ts` | post-lock correction workflow |
| `/handovers` | `shiftHandoverRoutes.ts` | shift handover |
| `/import` | `importRoutes.ts` | CSV/XLSX planning import |
| `/master-data` | `masterDataRoutes.ts` | customer/grade/defect/stoppage masters |
| `/users` | `userRoutes.ts` | user admin |
| `/reports` | `reportRoutes.ts` | dashboards & KPI aggregates |
| `/exports` | `exportRoutes.ts` | export jobs |
| `/traceability` | `traceabilityRoutes.ts` | coil genealogy walk |
| `/sync` | `syncRoutes.ts` | offline queue sync |

### 6.3 Services (`src/services`)

Capture & lifecycle: `shiftLogService`, `shiftLogEntryMapper`,
`shiftLogValidationService`, `shiftLogAccessService`, `processServices`,
`ancillaryServices`, `SixHiService`, `ShiftHandoverService`.

Master/planning/import: `MasterDataService`, `PlannedCoilService`,
`ImportService`, `importRowValidator`, `PPCImportService`,
`ProcessRouteService`, `QueueTransferService`.

Auto-source: `AutoSourceService`, `autoSourceContext`, `autoSourceFieldMaps`.

Auth & access: `authService`, `authzService`, `pinService`,
`DeviceRegistrationService`, `MachineAccessService`, `UserService`,
`configService`.

Corrections & audit: `ChangeRequestService`, `changeRequestPk`,
`overrideService`, `AuditTrailService`, `DomainEventPublisher`.

Traceability & lineage: `CoilTraceabilityService`, `TraceabilityService`,
`lineageService`.

Reporting & dashboards: `ReportingService`, `DashboardService`, `LiveService`,
`ExportService`.

### 6.4 Supporting modules

- `src/auth/` — `lineAccessPolicy`, `ppcAuthorization`, `authorizationAudit`.
- `src/config/authConfig.ts` — startup auth validation.
- `src/middleware/` — `authMiddleware`, `contextMiddleware`,
  `errorMiddleware` (RFC 7807), `rateLimitMiddleware`.
- `src/reporting/` — `plantHeadDrilldown`, `plantHeadValidators`,
  `plantHeadWindow`.
- `src/repositories/BaseRepository.ts` — shared repository base.
- `src/audit/auditedTables.ts` — audit table registry.
- `src/utils/` — CSV (`csvParser`, `csvTokenizer`, `csvWriter`), PPC parsers
  (`ppcCsvParser`, `PpcRouteTranslator`, `rollingPlanXlsxParser`),
  `kpiCalculator`, `machineAllocation`, `logger`, `entryUrl`.

### 6.5 Server tooling scripts (root of `packages/server`)

`check_columns.js`, `check_db.js`, `fix-types*.js`, `seed*.js`,
`seed.sql`, `seed_security.sql` — DB diagnostics and seeding. The
`scripts/` directory holds pilot smoke/seed `.mjs` scripts referenced by
package scripts.

---

## 7. Package: `@m1/client`

A single React PWA installed to the device home screen: an app shell plus ten
interchangeable process-form modules that all reuse shared components (header
block, master-data pickers, stoppage/defect/crew sub-forms), backed by an
IndexedDB offline cache and a sync engine.

### 7.1 Entry & routing

- `src/main.tsx` — React root; registers the service worker (`virtual:pwa-register`).
- `src/App.tsx` — `BrowserRouter` route table. The **single canonical capture
  route** is `/shift-log/:processId`; legacy mill URLs (`/6hi`, `/4hi`, `/2hi`,
  `/crm6`) redirect to the user-scope workspace. Routes are wrapped in
  role guards (`ProtectedRoute`, `SupervisorRoute`, `AdminRoute`, `PlantRoute`,
  `MachineHeadRoute`).

### 7.2 Pages (`src/pages`)

| Group | Pages |
| --- | --- |
| Auth/setup | `Login`, `SetupPage` |
| Capture | `ShiftLogPage`, `OperatorDashboard`, `UserWorkspaceHome`, `UserScopeIndex` |
| Forms | Process lines: `components/process/bodies/` via `lib/processConfig.ts` (`HrsSlitBuilder`, `PklCoilForm`, `PklChartGrid`, `AnnChargeBoard`, `RwdTensionForm`, `CrsQualityForm`, `CtlPieceCounter`). Legacy mill forms under `forms/` where still present (`CRMForm`, etc.). |
| Process | `process/` — `ProcessHub`, `ProcessLayout`, `CaptureWorkspace`, `ProcessOutgoingHandoverShell`, chart/handover pages |
| 6HI | `sixHi/` — `SixHiHub`, `SixHiCapturePage`, `SixHiQueuePage`, `SixHiOrderPage`, `SixHiShiftSummaryPage`, `SixHiRedirect` |
| Review | `ReviewQueue`, `ReviewDetail`, `ReviewSubmit`, `CorrectionQueue`, `HandoverPage` |
| Live | `live/LiveOperationsPage`, `live/MachineHeadDashboard` |
| Reports | `reports/` — `SupervisorDashboard`, `PlantHeadDashboard`, `ManagementDashboard`, `TraceabilityDashboard`, `ExportData`, `ExportHistory`, `DprExport`, `LineLogExport` |
| Admin | `admin/` — `MasterDataAdmin`, `PlanningAdmin`, `UsersAdmin`, `SystemAdmin`, `MachineAssignmentPage` |
| Import | `import/RollingImportPage` |
| Misc | `MachineComingSoon` |

### 7.3 Components (`src/components`)

- `admin/` — `AdminPanel`, `PpcRollingImportPanel`.
- `analytics/` — `AnalyticsMetric`, `ChartPanel`, `ProductionPlanBars`.
- `capture/` — `ProcessLineSwitcher`, `QuickStoppageDrawer` (line switch UI).
- `process/` — shared HRS/PKL/ANN/RWD/CRS/CTL engine: `ProcessHub`, `ProcessLayout`, `CaptureWorkspace`, `bodies/*` (`HrsSlitBuilder`, `PklCoilForm`, `PklChartGrid`, …) resolved via `lib/processConfig.ts`.
- `forms/` — shared shift-log subforms (`ShiftLogHeader`, `CrewSubForm`, `DefectSubForm`, …).
- `sixHi/` — large 6HI workspace suite (rolling/skin-pass workspaces, order/stoppage modals, pass tracker, stage strip, action rails, PPC info cards, etc.).
- `live/` — `MachineStatusBoard`, `OrderDetailDrawer`, `ProcessRouteTimeline`.
- `layout/` — role-specific shells & nav (`admin/`, `executive/`, `machinehead/`, `operator/`, `supervisor/`, `shared/`) plus `Shell`, `Sidebar`, `Topbar`, `Footer`, `ShiftLogShell`, `OperatorShiftLogShell`.
- `primitives/` — `ZButton`, `ZInput`, `ZBadge`, `ZKeypad` (touch-first design system).
- `ui/` — `KpiCard`, `KpiDrilldownModal`, `NumericKeypad`, `GloveModeToggle`, `OfflineBanner`, `StatusBadge`, `StatusIndicator`, `PulseDot`, `ChangeRequestPanel`, plus `ui/operator/` cards.
- Routing guards: `ProtectedRoute`, `RoleRoute`, `RoleHomeRedirect`, `MillAccessGate`, `CrmMillRoutes`, `LegacyMillRedirect`, `UserScopeShell`.

### 7.4 Lib, hooks, services, store

- `src/lib/` — `apiClient`, `authStore`, `offlineStore`, `syncEngine`,
  `liveService`, `reportingService`, `millConfig`, `millPath`,
  `machineRouting`, `processConfig.ts` (station → body/schema/endpoint),
  `workspaceProcesses`, `userScope`, `roleHome`, `accessOptions`,
  `gloveModeStore`, `tones`.
- `src/hooks/` — `useEntryForm`, `useShiftLogState`, `useNumericCapture`,
  `useWorkspaceBase`, `useProcessHubQueue`, `useSixHiHubQueue`, `useGloveModeClasses`.
- `src/services/` — `adminService`, `autoSourceService`,
  `changeRequestService`, `offlineQueue`.
- `src/store/` — `shiftStore`, `sixHiStore`, `processStore` (zustand).

### 7.5 Client config

`vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `index.html`,
`tsconfig.{json,app.json,node.json}`, `public/` (favicon, icons).

---

## 8. Domain Model & Enums

From `shared-validation/src/types/enums.ts` and `roles.ts`:

```ts
ShiftLogState   = DRAFT | SUBMITTED | APPROVED | REOPENED
CoilStatus      = PLANNED | IN_PROCESS | HOLD | REWORK | DONE | SCRAPPED
StoppageCategory= OPN | ELECT | MECH | UTILITY | POWER | PLANNED | OTHER
CrewRole        = OPERATOR | ASST | HELPER | CRANE | MTL | SHIFT_INCHARGE | SHIFT_MANAGER
ProcessLine     = HRS | PKL | CRM | 6HI | ANN | SKP | RWD | CRS | CTL
UserRole        = OPERATOR | MACHINE_HEAD | SUPERVISOR | PLANT_HEAD | ADMIN
```

**Entry lifecycle:** operator works in `DRAFT` during the shift and `SUBMITS`
at shift end; a Supervisor reviews and `APPROVES`, which locks the shift log.
After locking, any change goes through a **change request** the Supervisor
approves with a reason — every such change is audit-logged.

Each process has a typed entry interface extending `BaseProcessEntry`
(`HRSEntry`, `PKLEntry`/`PKLChartRow`, `CRMEntry`, `ANNEntry`, `SKPEntry`,
`RWDEntry`, `CRSEntry`, `CTLEntry`) mapping 1:1 to its `txn.prod_*` table, with
units embedded in field names (`weightMt`, `outputThkMm`, `lineSpeedMpm`, …).

---

## 9. The Ten Processes

Material flows along the physical path; the coil identity carries forward and
properties are refined at each step.

| # | Process | Code | Form | Defining feature |
| --- | --- | --- | --- | --- |
| 1 | HR Slitting | `HRS` | M1-HRS-01 | Slit combination builder (parent → child coils A–D) |
| 2 | Pickling | `PKL` | M1-PKL-01 + chart M1-PKL-02 | Two surfaces: coil log + hourly process chart (tanks T1–T3, rinse) |
| 3 | Cold Rolling | `CRM` | M1-CRM-01 | 2HI / 4HI / 6HI selector; output thk < input thk |
| 4 | Cold Rolling 6HI | `6HI` | 6HI workspace | Order-driven multi-pass workspace, machine allocation, PPC plan |
| 5 | Annealing | `ANN` | M1-ANN-01 | Charge/base grouping over coils (not coil-by-coil) |
| 6 | Skin Pass | `SKP` | M1-SKP-01 | Pass-wise thickness (1–6); re-rolling genealogy |
| 7 | Rewinding | `RWD` | M1-RWD-01 | Three rewinding-tension stages + surface-finish check |
| 8 | CR Slitter | `CRS` | M1-CRS-01 | Quality gate; full mechanical/surface checks; **For-CTL** routing flag |
| 9 | Cut-to-Length | `CTL` | M1-CTL-01 | Counts pieces/bundles; kg→MT conversion; squareness check every 50 pcs |

**Shared capture pattern:** every form is a shared header block + the
process-specific section + three reusable sub-forms (stoppage, defect, crew).
Standard 7-step workflow: login → line/shift auto-select → shift dashboard →
new coil entry (pick-from-plan autofill) → process capture → review & submit →
shift handover.

---

## 10. Roles & RBAC

| Role | Rank | Capabilities (summary) |
| --- | --- | --- |
| `OPERATOR` | 0 | Capture on bound line; draft/submit shift logs |
| `MACHINE_HEAD` | 1 | Operator + live ops board, rolling import, machine dashboard |
| `SUPERVISOR` | 2 | Review/approve, corrections, command center, exports, reports |
| `PLANT_HEAD` | 3 | Executive analytics, machine assignment, plant dashboards |
| `ADMIN` | 4 | Master data, planning, users, system admin |

- Authentication via OIDC SSO with badge+PIN fallback for shared shop-floor
  terminals; JWT carried to the API.
- **Line-scoping is enforced at the data layer** (PostgreSQL RLS) — the
  `RlsDriver` sets `app.user_id` per connection and `withTenantContext()` sets
  `app.tenant_id`. An operator physically cannot read another line's rows.
- Client route guards (`RoleRoute` → `SupervisorRoute`/`AdminRoute`/etc.)
  mirror, but do not replace, server enforcement.

---

## 11. Database & Migrations

PostgreSQL 15 primary handles OLTP capture organised into logical schemas
(`master`, `coil`, `txn`, `planning`, `security`, `audit`); a streaming read
replica serves reporting. Transaction tables (`shift_log`, `prod_*`,
`audit_log`) are partitioned by date; masters are FK-enforced; audit is
write-once via a generic trigger.

Migrations (`packages/server/migrations`, run with `node-pg-migrate`):

| Migration | Adds |
| --- | --- |
| `…000_baseline` | Core schemas, masters, coil spine, shift log, `prod_*` tables |
| `…001_multi_tenancy` | Tenant columns + RLS policies |
| `…002_audit_and_lineage` | Audit log, coil process history, lineage |
| `…438_device-registration` | Device binding |
| `…440_coil_journey_updates` | Coil journey/state updates |
| `…800000_add_glv_process` | GLV process |
| `…001_user_pin_hash` | Badge/PIN hash |
| `…002_import_batch_errors` | Import batch error tracking |
| `…003_audit_baseline_triggers` | Generic audit triggers |
| `…004_handover_attestation` | Shift handover attestation |
| `…005_change_request_rejection_note` | Change-request rejection note |
| `1782…_crm6_redesign` / `_ppc_input_thk` | CRM6 redesign + PPC input thickness |
| `1783…_process_route_engine` | Process-route engine |
| `1784…_ppc_rolling_plan` (+ `_ext`) | PPC rolling plan |
| `1785…_rename_crm6_process_to_6hi` | CRM6 → 6HI rename |
| `1786…_import_batch_xlsx_source` | XLSX import source |
| `1787…_process_route_engine_revision` | Route engine revision |
| `1788…_ppc_rolling_pass_is_required` | Required-pass flag |
| `1789…_ppc_machine_allocation` | Machine allocation |
| `1790…_export_job_module` | Export job tables |
| `1791…_export_read_model` | Export read model |
| `1792…_export_phase7` | Export phase 7 |

Companion DDL: `doc/M1_schema.sql` (runnable PostgreSQL 15+ schema for all ~40
tables in dependency order, with CHECK constraints, indexes, audit triggers and
seed rows).

---

## 12. Export Module

A temporary (interim) CSV/XLSX/PDF export feature for Supervisors, Plant Head
and Admin until the SAP round-trip and downstream modules are live. Every
export is audit-logged. Implemented under `packages/server/src/export`:

```
export/
├── index.ts
├── aggregation/    DprAggregator, delaySheet, derivation, lineAreas
├── auth/           exportAuthz
├── definitions/    DprReport, LineLogReport, CoilTraceReport, RawRegisterReport,
│                   ReportDefinition, registerDictionary
├── jobs/           ExportJobService, ExportJobRunner, ExportWorker, ExportScheduler,
│                   DprMonthLock, artifactStore, objectStorage
├── layouts/        TemplateBinder, LineLogBinder, CoilTraceBinder,
│                   dpr_layout.v1.json, line_log/*.json
├── read/           ExportReadRepository, CoilLineageWalker, *Query, processMappers
├── render/         CsvRenderer, XlsxRenderer, PdfRenderer
└── types/          rdm, index
```

`ExportWorker` and `ExportScheduler` are started by the server at boot
(`index.ts`). Report definitions cover the DPR (Daily Production Report), Line
Log, Coil Trace, and Raw Register. See `.kiro/specs/m1-export-module` and
`doc/M1_Export_Module_Spec.md`.

---

## 13. Build, Run & Tooling

**Prerequisites:** Node.js (with npm workspaces), Docker (for Postgres),
PostgreSQL 15. Optional: `puppeteer` (PDF export), AWS S3 (export artifacts).

**Install (root):**
```
npm install
```

**Local stack (Docker — Postgres primary+replica, nginx, backend):**
```
docker compose up
```
- Postgres primary on `5432`, replica on `5433`, nginx gateway on `80`
  (`/api/` → backend), backend on `3000` (default `PORT` 3005 outside Docker).

**Database:**
```
npm run migrate          # apply migrations
npm run seed:pilot       # seed pilot data
npm run seed:admin       # seed admin
```

**Develop:**
```
npm run dev              # all workspaces (client: vite --host, server: tsx watch)
```

**Build / test / lint:**
```
npm run build
npm run test
npm run lint
```

**Smoke tests:** `npm run smoke:pilot`, `npm run smoke:api`.

> Note: dev servers and watchers are long-running — start them manually in a
> terminal rather than expecting them to complete.

---

## 14. Deployment Topology

Devices on each line reach a load-balanced app-server cluster in the plant data
centre. A line edge cache buffers entries during brief network loss. The
database runs primary + replica; an integration server brokers SAP/PP&C; a BI
server reads the replica; backups stream to a DR site.

- `docker-compose.yml` — local/dev full stack.
- `deploy/docker-compose.hybrid.yml` — hybrid deployment variant.
- `nginx.conf` — gateway proxying `/api/` to the backend with standard
  `X-Real-IP` / `X-Forwarded-For` headers.

**Indicative sizing:** pilot 1–2 lines (5–15 devices, 300–800 entries/day, 2 HA
app nodes) → plant-wide 10 processes (40–80 devices, 3,000–6,000 entries/day,
3–4 app nodes, partitioned DB).

**NFR targets:** availability ≥ 99.5% on the floor (offline capture covers
blips); form open < 1 s; validate+save < 300 ms; dashboard < 2 s; immutable
audit on every change.

---

## 15. Feature Specs (`.kiro/specs`)

Each spec is a `requirements.md` / `design.md` / `tasks.md` triad.

| Spec | Purpose |
| --- | --- |
| `configurable-input-validation` | Make field validation rules configurable rather than hard-coded |
| `import-data-integrity-fixes` | Fix PPC/rolling-plan import data integrity issues (includes `bugfix.md`) |
| `m1-export-module` | The CSV/XLSX/PDF export module (DPR, line log, coil trace, raw register) |
| `plant-head-features` | Plant-head dashboards, drilldown and analytics |

---

## 16. Reference Documentation (`/doc`)

The original M1 technical blueprint — a linked set of ten documents plus
companions:

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

Companions: `M1_schema.sql` (runnable DDL), `M1_Export_Module_Spec.md`,
`ROLLLING PLAN.XLSX` / `SKINPASS PLAN.XLSX` (sample PPC plans). Python helpers
`convert_docx_to_md.py` and `extract_docx.py` regenerate Markdown/text from the
source DOCX files (`doc_summary.txt` is the extracted dump).

---

## 17. Full Directory Tree

```
ZedralV2/
├── convert_docx_to_md.py
├── extract_docx.py
├── doc_summary.txt
├── docker-compose.yml
├── nginx.conf
├── package.json
├── package-lock.json
├── deploy/
│   └── docker-compose.hybrid.yml
├── doc/
│   ├── M1-00_Blueprint_Overview.md
│   ├── M1-01_System_Architecture.md
│   ├── M1-02_Process_Data_Capture_Design.md
│   ├── M1-03_UX_Design.md
│   ├── M1-04_Data_Model.md
│   ├── M1-05_RBAC_Security.md
│   ├── M1-06_Planning_Integration_Export.md
│   ├── M1-07_Validation_Framework.md
│   ├── M1-08_Audit_Compliance.md
│   ├── M1-09_Reporting_Monitoring.md
│   ├── M1_Export_Module_Spec.md
│   ├── M1_schema.sql
│   ├── ROLLLING PLAN.XLSX
│   └── SKINPASS PLAN.XLSX
├── .kiro/
│   └── specs/
│       ├── configurable-input-validation/   (requirements/design/tasks.md)
│       ├── import-data-integrity-fixes/      (requirements? bugfix/design/tasks.md)
│       ├── m1-export-module/                 (requirements/design/tasks.md)
│       └── plant-head-features/              (requirements/design/tasks.md)
└── packages/
    ├── shared-validation/
    │   ├── package.json  tsconfig.json  vitest.config.ts
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── rules/   (fieldRules, shiftLogRules, sixHiRules, overrides, runner)
    │   │   ├── types/   (enums, roles, models, processes, processRoute, live, sixHi, validation, index)
    │   │   └── utils/   (calculationEngine)
    │   └── tests/
    ├── server/
    │   ├── package.json  tsconfig.json  vitest.config.ts  Dockerfile.dev  .env
    │   ├── check_columns.js  check_db.js  fix-types*.js  seed*.js  seed*.sql
    │   ├── migrations/   (baseline → export_phase7; see §11)
    │   ├── scripts/      (pilot smoke/seed .mjs)
    │   ├── src/
    │   │   ├── index.ts  db.ts  db-types.ts  context.ts
    │   │   ├── audit/  auth/  config/  middleware/  reporting/  repositories/
    │   │   ├── routes/        (22 route modules; see §6.2)
    │   │   ├── services/      (~40 services; see §6.3)
    │   │   ├── export/        (aggregation/auth/definitions/jobs/layouts/read/render/types)
    │   │   ├── types/  utils/
    │   │   └── tests/
    │   └── dist/
    └── client/
        ├── package.json  index.html  vite.config.ts  vitest.config.ts  eslint.config.js
        ├── tsconfig.{json,app.json,node.json}
        ├── public/   (favicon.svg, icons.svg)
        ├── src/
        │   ├── main.tsx  App.tsx  App.css  index.css
        │   ├── assets/
        │   ├── components/  (admin, analytics, capture, command, export, forms,
        │   │                 layout, live, primitives, sections, sixHi, ui + guards)
        │   ├── hooks/  lib/  services/  store/
        │   └── pages/   (admin, forms, import, live, reports, sixHi + top-level)
        ├── tests/
        └── dist/
```

---

*Prepared as a repository map for ZedralV2 / Hero Steels M1 Digital Data
Collection. For design rationale and field-level detail, see the `/doc` M1
blueprint set; for in-flight work, see `.kiro/specs`.*
