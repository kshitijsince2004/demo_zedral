# Zedral M1 — Schema Duplicacy & Cleanup Plan (verified)

**Inputs:** uploaded live schema `types.ts` (kysely-codegen, **89 tables**) + two AI audit reports
(*Full Duplicate/Overlap/Redundancy Audit*, *Full Dead-Code Audit*).
**Compared against:** the **current** codebase (`zedral_test-main`, post-consolidation). The uploaded
schema is post-consolidation (it has `txn.crm_*` tables **and** `txn.crm6_*` views + `archive.prod_*`),
so it matches the latest tree — **not** the original `hsl_zedral-main`. I used the latest tree because
"active / safe-to-delete" only makes sense against the code that's actually deployed.

**How to read this:** the two reports are directionally good but **AI-generated and contain errors**.
I re-verified every high-value and risky claim against the code. §A lists where the reports are
**wrong** (do NOT execute those). §D is verified-safe-now. §E is safe-but-gated. Every DB drop is
gated by the FK/row-count checks in §G.

---

## A. Report corrections — DO NOT execute these (verified wrong/oversimplified)

| Report claim | Reality (verified) | Verdict |
| --- | --- | --- |
| **Drop `master.crm_sub_process`** (R1 §1.7 — "no FK") | `planning.ppc_batch.sub_process` **REFERENCES `master.crm_sub_process(sub_process_code)`** (migration `1782…`, line 56). It's an FK/seed target. | **KEEP** — dropping breaks PPC inserts |
| **`ShiftLogService.reject()` is dead, no route** (R2 §10.2) | Route **exists**: `PUT /shift-logs/:id/reject` (`shiftLogRoutes.ts:340`) → `ShiftLogService.reject(...)`, used by the Machine-Head Shift Review page. | **KEEP** — it's live |
| **Delete `src/db/types.ts`, "one consumer"** (R1 §6.1) | It has **~9 importers** in `src/export/` (`ExportReadRepository`, `CoilLineageWalker`, `processMappers`, `TemplateBinder`, `LineLogBinder`, …). | **Gated** — repoint 9 files first (§E) |
| **Delete `services/ExportService.ts`** (R1 §2.5) | It has **2 importers**. | **Gated** — repoint 2 callers first (§E) |
| **Delete `Topbar.tsx` / `Footer.tsx`** (R2 §3.2) | `Topbar` has 1 importer, `Footer` has 3, `ZKeypad` has 1. | **Verify import chain first** (§E) |
| Various root binaries: `deploy.zip`, `debug.log`, `Zedral-M1-Operator-debug.apk`, `android.rar`, `closeStaleSessions.ts` | **Not present** in this tree (likely git-ignored or a different checkout). | Verify in your working repo before assuming |

These six are exactly why the reports shouldn't be run as-is.

---

## B. Active tables (used in live logic) — the "keep" core

Confirmed read/written by production code. Do not touch:

- **Production/orders:** `txn.crm_order`, `txn.crm_rolling`, `txn.crm_rolling_pass`, `txn.crm_skinpass`,
  `txn.crm_shift_summary`, `txn.crm_roll_change`, `txn.shift_log`, `txn.order_shift_attribution`,
  `txn.order_machine_transfer`, `txn.order_rejection`, `txn.order_remark`, `txn.defect_entry`,
  `txn.stoppage`, `txn.machine_handover`, `txn.machine_shift_session`, `txn.machine_state_event`,
  `txn.shift_event_audit`, `txn.shift_override_audit`, `txn.session_crew`, `txn.validation_overrides`,
  `txn.idempotency_key`.
- **Classic process tables (still mapped in `shiftLogService.getProcessTable`):** `txn.prod_hrs`,
  `txn.prod_hrs_slit`, `txn.prod_pkl`, `txn.prod_pkl_chart`, `txn.prod_crs`, `txn.prod_crs_slit`,
  `txn.prod_ctl`, `txn.prod_rwd`, `txn.ann_charge`, `txn.ann_charge_coil`.
- **Master/planning:** `master.machine`, `master.process`, `master.shift`, `master.grade`,
  `master.grade_spec`, `master.customer`, `master.defect_code`, `master.stoppage_category`,
  `master.stoppage_code`, `master.route_code`, `master.operator`, `master.machine_crew_roster`,
  `master.crm_sub_process` (FK target), `master.furnace`/`rp_oil_grade`/`surface_finish`/`line_area`
  (FK/seed — keep), `planning.ppc_batch`, `planning.ppc_rolling_pass_plan`, `planning.order_journey`,
  `planning.order_journey_step`, `planning.coil_plan`, `planning.plan_order`, `planning.import_batch`.
- **Security/audit/config/canon:** `security.app_user`, `security.role`, `security.user_role`,
  `security.line_access`, `security.machine_access`, `security.device_registration`,
  `security.tenant`, `security.tenant_config`, `coil.coil`, `audit.audit_log`, `audit.export_job`,
  `audit.dpr_month_lock`, `config.validation_rule`, `config.ruleset_version`,
  `canon.equipment_node`, `canon.event`, `canon.production_count`, `pgmigrations`, `pgmigrations_m1`.

> Two "keep both — complementary, not duplicate" pairs confirmed: `txn.stoppage` (business record)
> vs `txn.machine_state_event` (live state), and `txn.shift_event_audit` vs `audit.audit_log` vs
> `canon.event` (three tiers). Just document them; don't merge.

---

## C. Duplicate / dead schema objects (classification)

| Object | Status | Evidence | Action bucket |
| --- | --- | --- | --- |
| `txn.crm6_order/rolling/rolling_pass/skinpass/shift_summary` (views) | **Duplicate (0 code queries)** | transitional views over `crm_*`; code uses `crm_*` only (verified 0 `crm6_` queries) | §E gated drop |
| `archive.prod_crm`, `archive.prod_skp`, `archive.prod_skp_pass` | **Zombie (actively dual-written)** | `ProductionService.ts:185` still `insertInto('archive.prod_skp')`; in `auditedTables.ts`; `shiftLogValidationService` reads `archive.prod_skp_pass` | §E remove writes → drop |
| `security.permission` | **Dead (no FK)** | only touched by dead `authzService.ts`; no inbound FK (verified) | §E drop after authzService |
| `dpr.template/month/daily_entry/source_map/field_mapping` | **Dead schema** | only queried by the dead `src/dpr/` submodule (verified: no `dpr.*` refs outside `/dpr/`) | §E drop after zero-row check |
| `audit.audit_log.change_request_id` (column) | **Dead FK column** | referenced table dropped (1917); always NULL | §E column drop |
| `security.app_user.auth_subject` (column) | **Dead column** | replaced by `supertokens_user_id` | §E column drop (verify no seed uses it) |
| `master.machine.machine_status/capacity_mt/department/machine_type` (columns) | **Likely dead** | status derived from `machine_state_event`; others unread | §G verify then drop |
| `planning.production_target`, `planning.queue_handoff` | **Likely dead tables** | not found in service queries | §G verify (FK+rows) then drop |
| `audit.lineage_ref` | **Test-only** | only in `platform-audit-lineage.test.ts` | §G verify then drop |
| `master.crm_sub_process` | **KEEP** | FK target (see §A) | keep |
| index `ix_machine_shift_session_active` | **Redundant** | superseded by unique `ux_machine_shift_session_one_active` | §E drop index |

---

## D. SAFE TO DELETE NOW (verified 0 references / clearly dead)

These I verified have **zero importers/callers** or are unrouted. Delete + `npm run build && npm test`.

### D1. Throwaway / security-risk files (root + server)
```
# root  (⚠️ contain plaintext DB creds — delete for security)
test_shift_lookup.js          # ⚠️ postgres://m1_user:m1_pass123@...
patch_handover.js  patch_process.js  patch_process_2.js
convert_docx_to_md.py  extract_docx.py  doc_summary.txt
# packages/server  (⚠️ check_columns.js has creds)
packages/server/fix-types.js  fix-types2.js  fix-types3.js
packages/server/check_columns.js   # ⚠️ creds
packages/server/check_db.js
packages/server/seed_coils.js  packages/server/seed_sso.js
```
> Also rotate the `m1_pass123` DB password if that repo was ever pushed anywhere.

### D2. Dead backend services (0 importers — verified)
```
packages/server/src/services/authzService.ts          # + then drop security.permission (§E)
packages/server/src/platform/eventPublisher.ts        # dead publisher wrapper
packages/server/src/services/DomainEventPublisher.ts  # dead publisher wrapper
```
All live event publishing goes through `platform/m1Events.ts` (keep that).

### D3. Dead client components/pages (0 importers / unrouted — verified)
```
packages/client/src/services/offlineQueue.ts          # replaced by operator/db/outboxRepo.ts
packages/client/src/components/layout/PlantHeadShell.tsx
packages/client/src/components/ui/KpiCard.tsx
packages/client/src/components/ui/KpiDrilldownModal.tsx
packages/client/src/components/reports/DrilldownPanel.tsx
packages/client/src/components/sixHi/SixHiStageStrip.tsx
packages/client/src/components/analytics/ProductionPlanBars.tsx
packages/client/src/components/command/LineStatusBoard.tsx
packages/client/src/components/plant-head/FloatingAlertDock.tsx
packages/client/src/components/primitives/NumericKeypad.tsx   # (confirm exact path)
packages/client/src/pages/reports/ExportData.tsx      # not in App.tsx routes
packages/client/src/pages/reports/DprExport.tsx       # superseded by Plant/MachineDprExport
```
> When you delete `PlantHeadShell.tsx`, re-check `Topbar`/`Footer` — they may become 0-ref and then
> also deletable (they're currently referenced, see §E).

### D4. Empty directories
```
packages/server/src/dpr/routes/
packages/client/src/components/forms/sections/
packages/client/src/components/sections/
```

**Exit gate for §D:** `npm run build && npm test && npm run arch:check` green; `git grep` of each
deleted symbol returns nothing.

---

## E. GATED deletes — do the prerequisite first (safe, but not one-step)

| # | Object | Prerequisite (touch this first) | Then |
| --- | --- | --- | --- |
| E1 | `txn.crm6_*` views | confirm `grep -rn "crm6_" packages/server/src \| grep -iE "selectFrom\|insertInto"` = 0 (already true) | migration: `DROP VIEW txn.crm6_*`; remove `TxnCrm6*` from `db-types.ts` |
| E2 | `security.permission` table | delete `authzService.ts` (§D2) | migration `DROP TABLE security.permission` (no FK — verified) |
| E3 | `archive.prod_crm/skp/skp_pass` | remove dual-write `ProductionService.ts:185`; remove the 3 rows from `audit/auditedTables.ts`; repoint `shiftLogValidationService` read of `archive.prod_skp_pass`; remove archive ids from `shiftLogService.getProcessTable` if present | zero-row check → `DROP TABLE archive.*` |
| E4 | `src/dpr/` submodule + `dpr.*` schema | delete the `src/dpr/` classes/repositories (only self-referenced — verified); remove `ShiftBoundaryScheduler` no-op wiring from `index.ts` if it pulls dpr | zero-row check on `dpr.*` → `DROP SCHEMA`/tables |
| E5 | `src/db/types.ts` | repoint the **~9** `src/export/**` importers to `../db-types` (verified list: `ExportReadRepository`, `CoilLineageWalker`, `rawRegisterQuery`, `lineLogQuery`, `coilTraceQuery`, `processMappers`, `TemplateBinder`, `LineLogBinder`, `line_log/index`) | delete `db/types.ts` |
| E6 | `services/ExportService.ts` | repoint its **2** importers to `../export/jobs/ExportJobService` | delete file |
| E7 | `Topbar.tsx` / `Footer.tsx` / `ZKeypad.tsx` | after E-deletes, re-grep importers; if the only importers were dead shells (e.g. `PlantHeadShell`), they'll hit 0 | delete |
| E8 | `audit.audit_log.change_request_id`, `security.app_user.auth_subject` columns | grep code for the column names = 0 (auth_subject: confirm no seed writes it) | migration `DROP COLUMN` |
| E9 | index `ix_machine_shift_session_active` | none (unique `ux_…one_active` covers it) | migration `DROP INDEX` |

---

## F. Refactors the reports flag (optional, not deletions)

Lower priority, behavior-preserving — do only if you want the tidy-up:
`ProductionMetricsService` → delegate to `ShiftAttributionService`; collapse the 4 DB-level
shift-resolution lookups into one `ShiftDetectionService` method; replace the inline
`SkinPassThicknessSpecs` with the shared `ThicknessSpecs` (this also serves Item 5 of the earlier
enhancements spec); pick one Excel lib per direction (keep `xlsx` read / `exceljs` write — document);
drop `@types/express-rate-limit`; route `console.error` in `userRoutes.ts` through the logger.

---

## G. Execution order + gates

**Pre-drop DB gates (run each on a production-like DB before any `DROP`):**
```sql
-- inbound FKs to a candidate table (must be empty to drop safely)
SELECT c.conrelid::regclass AS referencing, a.attname
FROM pg_constraint c JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ord) ON true
JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
WHERE c.contype='f' AND c.confrelid='security.permission'::regclass;   -- <- candidate
-- row count
SELECT count(*) FROM security.permission;                              -- <- candidate
```

**Phases (one PR each; every migration reversible):**
1. **P1 — File hygiene (zero risk):** §D1 (⚠️ rotate the leaked DB password), §D4 empty dirs.
2. **P2 — Dead code (verified):** §D2 services, §D3 components/pages. Build+test.
3. **P3 — crm6 views:** E1 (drop views + `TxnCrm6*` types). Regenerate `db-types.ts`.
4. **P4 — authz + permission:** E2 (delete `authzService.ts` → drop `security.permission`).
5. **P5 — archive tables:** E3 (remove dual-write → zero-row check → drop `archive.*`).
6. **P6 — DPR submodule + schema:** E4 (delete `src/dpr/` → zero-row check → drop `dpr.*`).
7. **P7 — type-file merge:** E5 (repoint export/ → delete `db/types.ts`), E6 (`ExportService`).
8. **P8 — columns + index + Topbar/Footer:** E7, E8, E9.
9. **P9 — optional refactors:** §F.

**Do NOT touch:** `master.crm_sub_process`, `ShiftLogService.reject()`, the classic `txn.prod_*`
tables (still mapped), and the "complementary" audit/stoppage pairs.

**Estimated impact (verified subset):** ~20 dead files + ~9 dead components/pages in P1–P2 alone,
then ~5 DB objects (crm6 views, permission, archive×3, dpr schema) + 2 columns + 1 index across
P3–P8. Materially smaller than the reports' "~72 files" headline because several of their targets are
**not** actually dead (§A).

---

## Sources
- Uploaded: *Zedral V2.2 — Full Duplicate, Overlap & Redundancy Audit* (Report 1).
- Uploaded: *Zedral V2.2 — Full Codebase Dead Code Audit* (Report 2).
- Verified against `zedral_test-main` (`packages/server/src`, `packages/client/src`, `migrations/`) and the uploaded `types.ts` schema.
