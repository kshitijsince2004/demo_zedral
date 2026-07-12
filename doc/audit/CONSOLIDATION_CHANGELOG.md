# M1 Consolidation Plan — Complete Changelog

This document provides a comprehensive inventory of every file created, modified, or deleted during the M1 Consolidation program (Phases 0 through 6), along with an explanation of why the changes were made.

The overarching goal was to standardize the system on the "Model B" architecture (order/machine-centric) and completely strip away the "Model A" legacy structures, duplicate forms, and dead code.

---

## 1. Database Migrations
We shipped 12 new migrations to collapse the dual-schema state, drop unused tables, and ensure tenant isolation.

* **`1913000000000_remove_supervisor_role.js`**: Removed the deprecated `SUPERVISOR` role and merged its capabilities into `MACHINE_HEAD`.
* **`1914000000000_drop_txn_crm.js`**: Dropped the phantom `txn.crm` table which survived only in types.
* **`1915000000000_seed_missing_machines.js`**: Seeded missing lines into `master.machine` to support line-agnostic handovers (Phase 2).
* **`1916000000000_drop_shiftlog_handover_cols.js`**: Hard-dropped the 5 legacy handover columns (`handover_notes`, `prev_shift_log_id`, etc.) from `txn.shift_log`. (Phase 3.3).
* **`1917000000000_drop_change_request.js`**: Dropped the unwired `audit.change_request` table.
* **`1918000000000_drop_prod_glv.js`**: Dropped the incomplete GLV capture table `txn.prod_glv`.
* **`1919000000000_unify_stoppages.js`**: United the twin stoppage tables into `txn.stoppage_entry`, maintaining RLS and correcting cross-shift boundary times.
* **`1920000000000_drop_stoppage_entry.js`**: Dropped the redundant `txn.order_stoppage` after the stoppage merge.
* **`1921000000000_drop_coil_process_history.js`**: Dropped `coil_process_history` (replaced by `order_journey_step`).
* **`1922000000000_unify_crew.js`**: Replaced `txn.crew_entry` with `master.machine_crew_roster`.
* **`1923000000000_archive_and_unify_crm_skp.js`**: Moved `prod_crm` and `prod_skp` to the `archive` schema and backfilled all history into `crm6_order`, `crm6_rolling`, and `crm6_skinpass`.
* **`1924000000000_phase6_drop_dead_tables.js`**: Safely dropped `canon.cost_rate` and `canon.personnel` after FK-guard checks.

---

## 2. Handover & Order-Source Generalization (Backend)
Moved shift handovers from the legacy `ShiftHandoverService` (Model A) to `MachineHandoverService` (Model B), and made it line-agnostic.

* **`[DELETE] packages/server/src/services/ShiftHandoverService.ts`**: Deleted the entire legacy handover implementation.
* **`[NEW] packages/server/src/services/handover/OrderSource.ts`**: Introduced a strategy interface to resolve active work units dynamically per machine.
* **`[NEW] packages/server/src/services/handover/SixHiOrderSource.ts`**: Implementation for 6HI resolving `crm6_order`.
* **`[NEW] packages/server/src/services/handover/LegacyOrderSource.ts`**: Fallback implementation for legacy lines (HRS, PKL) using classic process tables.
* **`[MODIFY] packages/server/src/services/MachineHandoverService.ts`**: 
  - Added the validation gate before closing a shift.
  - Added open-work (stoppages/coils) carry-forward logic upon handover acceptance.
  - Rewired to use the new `OrderSource` interface.
* **`[MODIFY] packages/server/src/services/shiftLogValidationService.ts`**: Handover accept now validates the incoming shift against existing validation rules. Pointed legacy SKP validation to `archive.prod_skp_pass`.
* **`[MODIFY] packages/server/src/services/shiftLogService.ts`**: Removed all legacy `handover()` logic; delegates heavily to the Model B infrastructure.

---

## 3. Database Core & Types
Aligned the application's schema definitions and runtime mappers with the migrated state.

* **`[MODIFY] packages/server/src/db-types.ts` & `src/db/types.ts`**: Auto-regenerated via `kysely-codegen` to reflect the 86 remaining tables (dropped dead canon, glv, legacy crm/skp types).
* **`[MODIFY] packages/server/src/audit/auditedTables.ts`**: Repointed `prod_crm` and `prod_skp` references to `archive.prod_crm` and `archive.prod_skp`. Removed `txn.prod_glv`.
* **`[MODIFY] packages/server/src/export/read/processMappers.ts`**: Removed mapping paths for the dropped legacy CRM and SKP tables.

---

## 4. Reports, Traceability, & Export Repointing
Forced all read-paths to consume the unified Model B structures instead of dual-reading Model A and B.

* **`[DELETE] packages/server/src/services/CoilTraceabilityService.ts`**: Deleted entirely. Was querying phantom `txn.coils`.
* **`[MODIFY] packages/server/src/services/ReportingService.ts`**: Rewired to pull scrap and production metrics from `txn.crm6_shift_summary` instead of the legacy `prod_crm` and `prod_skp` tables.
* **`[MODIFY] packages/server/src/export/read/ExportReadRepository.ts`**: Removed legacy SKP stream extractors.
* **`[MODIFY] packages/server/src/services/TraceabilityService.ts`**: Fully repointed coil traceability searches to rely on `crm6_order` and `crm6_skinpass`.
* **`[MODIFY] packages/server/src/routes/reportRoutes.ts` & `shiftLogRoutes.ts`**: Repointed `/handover/summary` and `/handover` endpoints to query `txn.machine_handover` directly.
* **`[MODIFY] packages/server/src/export/read/lineLogQuery.ts`**: Switched base line-log queries to reference unified stoppages.

---

## 5. Security & Authorization
* **`[MODIFY] packages/server/src/auth/machineAccessPolicy.ts` & `lineAccessPolicy.ts`**: Re-aligned role matrices for `LINE_INCHARGE` and `SHIFT_MANAGER`, removing `SUPERVISOR`.
* **`[MODIFY] packages/shared-validation/src/types/roles.ts`**: Dropped `SUPERVISOR` from the shared typescript enums.
* **`[MODIFY] packages/server/src/export/auth/exportAuthz.ts`**: Removed supervisor exceptions from export gateways.
* **`[MODIFY] packages/server/src/services/authService.ts`**: Updated token issuance to drop supervisor mapping.

---

## 6. Offline Client Sync Safety (Zero Data Loss)
* **`[MODIFY] packages/server/src/modules/m1-collection/services/ProductionService.ts`**: Added dual-write logic in `saveSkp`. If an operator device comes online with queued SKP data referencing the old schema, the server saves it to both `archive.prod_skp` (for audit) and maps it seamlessly into the new `crm6_*` structures.

---

## 7. Frontend Cleanup (React / Vite)
Stripped out dead UI components, removed the supervisor role from the router, and pointed dashboards at the new endpoints.

* **`[MODIFY] packages/client/src/pages/capture/ProcessForms.tsx` & `GenericCapturePage.tsx`**: Removed `SkpCaptureForm` from the generic capture dictionary. Eliminated legacy SKP conditional logic.
* **`[MODIFY] packages/client/src/components/RoleRoute.tsx`**: Removed `SUPERVISOR` role from RBAC boundary checks.
* **`[MODIFY] packages/client/src/lib/userScope.ts`**: Aligned local storage scope parsing with the new role boundaries.
* **`[MODIFY] packages/client/src/pages/admin/UsersAdmin.tsx` & `SystemAdmin.tsx`**: Removed supervisor assignment from the user administration dropdowns.
* **`[MODIFY] packages/client/src/pages/sixHi/SixHiCapturePage.tsx` & `SixHiHub.tsx` & `SixHiShiftSummaryPage.tsx`**: Adjusted prop-drilling for order resolution and reporting context to match the new `SixHiOrderSource` API contracts.
* **`[MODIFY] packages/client/src/pages/plant/PlantShiftReviewPage.tsx`**: Repointed the UI to render `machine_handover` properties instead of the legacy `shift_log.handover_*` columns.
* **`[MODIFY] packages/client/src/components/live/OrderDetailModal.tsx` & `packages/client/src/lib/liveService.ts`**: Updated live telemetry to parse `crm6_*` schemas instead of dual-reading.

---

## 8. Test Suites & Seeding (Quality Gates)
* **`[NEW] packages/server/tests/integration/machineHeadLifecycle.integration.test.ts`**: New integration test validating the end-to-end flow of Model B handovers.
* **`[DELETE] packages/server/tests/integration/supervisorLifecycle.integration.test.ts`**: Removed dead test suite for the supervisor role.
* **`[MODIFY] packages/server/tests/architecture/migrationBoundaries.test.ts`**: Added `archive` to the allowed schemas list to prevent architectural boundary violations from the new CRM/SKP archive tables.
* **`[MODIFY] packages/server/tests/auditTrail.test.ts`**: Updated audit checks to inspect `archive.prod_crm` instead of `txn.prod_crm`.
* **`[MODIFY] packages/server/tests/auth/lineAccessPolicy.test.ts` & `rbac.test.ts`**: Updated RBAC test assertions to match the new 4-role model.
* **`[MODIFY] packages/server/tests/exportRoutes.test.ts` & `reportRoutes.test.ts` & `userRoutes.test.ts`**: Corrected mock structures for export and handover reporting APIs.
* **`[MODIFY] packages/server/scripts/seed-admin.mjs` & `seed-pilot-users.mjs` & `seed-zedral-demo.mjs` & `seed_security.sql`**: Removed supervisor mock assignments and ensured demo data seeds with valid `machine_code` foreign keys.
