# Spec — Remove SUPERVISOR, fold capabilities into MACHINE_HEAD (machine-scoped)

**Objective:** eliminate the SUPERVISOR role entirely. Every supervisor capability moves
to **MACHINE_HEAD**, but scoped **by machine** (the machine head's assigned machines) instead
of by line. Remove all now-dead supervisor code, data, seeds, and tests.

**Footprint:** ~185 references across ~65 files (full list in §9). This is a cross-cutting
change — do it as one coordinated branch with the phases below, not piecemeal.

**Out of scope:** PLANT_HEAD is left as-is here. (The separate plant-head tightening lives in
`CONSOLIDATION_PLAN.md`; don't mix them.)

**Cross-spec sequencing:** this spec shares three files with `CONSOLIDATION_PLAN.md`
(`routes/shiftLogRoutes.ts`, `routes/reportRoutes.ts`, `services/ReportingService.ts`).
Do **this spec first**, then the consolidation phases build on the new 4-role model. Also, strict
per-machine approval (§1) is only exact once `CONSOLIDATION_PLAN.md` **Phase 2** gives every line
a machine identity — until then classic single-machine lines use the path-4 fallback.

> ## ⚠️ CRITICAL DISTINCTION — read before touching any "supervisor" string
>
> Two unrelated things contain the word "supervisor". Only the **role** is being removed.
>
> - **The SUPERVISOR *role*** (`UserRole.SUPERVISOR`, `role_name='SUPERVISOR'`, `SupervisorRoute`, rank 2) → **REMOVE.** This is the entire objective.
> - **The "supervisor override PIN" *mechanism*** (`verifySupervisorOverridePin`, `POST /auth/supervisor-override`, client `authApi.supervisorOverride`) → **KEEP — DO NOT DELETE OR RENAME.** It is **role-agnostic**: `OVERRIDE_ROLES` already accepts ADMIN / PLANT_HEAD / **MACHINE_HEAD**, so it keeps working after the role is gone. It powers field-level overrides (`FieldWrapper.tsx`), the APK "discard parked action" (`SyncStatusBadge.tsx`), and **kiosk exit** (see `M1-10_Operator_APK_Conversion.md`, `AGENTS_for_android_folder.md`). Deleting it **breaks the offline APK kiosk flow.**
>
> The **only** change to the override-PIN mechanism is dropping the string `'SUPERVISOR'` from the
> `OVERRIDE_ROLES` array (§3). The function, endpoint, and client helper names stay as-is
> (renaming them is optional cosmetic work, explicitly **out of scope** here because it touches
> the APK kiosk contract).

---

## 1. The core design decision — how "machine-wise" works

Supervisor approval today is **line-scoped** (`security.line_access` with an `APPROVE` level).
Machine Head is **machine-scoped** (`security.machine_access`). The bridge is that
**`master.machine` carries `process_id` / `process_code`** — so a machine head's machines map
cleanly to the processes/lines they may act on.

**New rule (DECIDED: machine-wise only):** a MACHINE_HEAD may approve / reject / reopen /
override a shift log **iff every machine that shift actually ran on is in their
`machineAccess`.** Scope is the *machine*, not the whole process — a 4HI-only head must **not**
be able to approve 6HI or 2HI work even though they share a process.

`txn.shift_log` has **no** `machine_code` column (only `process_id` + `mill_type`), so resolve
the shift's machine(s) in this priority order:

```
resolveShiftLogMachines(shiftLog): Promise<string[]>
  1. txn.machine_shift_session.machine_code WHERE shift_log_id = X   (machine-centric lines)
  2. txn.crm6_order.machine_code            WHERE shift_log_id = X   (6HI orders)
  3. shift_log.mill_type → machine_code                              (CRM mills: 2HI/4HI/6HI)
  4. fallback: master.machine.machine_code WHERE process_id = shift_log.process_id
              (classic single-machine lines — coincides with machine-wise when 1 machine/process)

assertShiftLogApproval(user, shiftLog)   // server/src/auth/machineAccessPolicy.ts
  = ADMIN / PLANT_HEAD → allow (existing carve-outs)
  = else: throw unless resolveShiftLogMachines(shiftLog) ⊆ user.machineAccess
```

This replaces the line-scoped supervisor checks with a strict machine-scoped check.

> **Note:** exact per-machine granularity depends on the shift carrying a machine identity
> (paths 1–3). That is true for 6HI today and for every line after `CONSOLIDATION_PLAN.md`
> Phase 2 (machine identity for all lines). Until then, classic single-machine lines fall back
> to path 4, which is machine-wise wherever a process has exactly one machine.

---

## 2. Rank & enum change (`packages/shared-validation/src/types/roles.ts`)

Remove `SUPERVISOR` and **renumber** to close the gap (cleaner than leaving a hole):

```ts
export enum UserRole { OPERATOR='OPERATOR', MACHINE_HEAD='MACHINE_HEAD', PLANT_HEAD='PLANT_HEAD', ADMIN='ADMIN' }
ROLE_RANK   = { OPERATOR:0, MACHINE_HEAD:1, PLANT_HEAD:2, ADMIN:3 }
ROLE_LABELS = { …, MACHINE_HEAD:'Machine head', … }   // drop 'Supervisor'
```

**Watch:** `ROLE_RANK` is consumed by the client `RoleRoute` (rank ≥ comparison) and hard-coded
in tests. Any client route using `minRole="SUPERVISOR"` must become `minRole="MACHINE_HEAD"`.
Update `packages/shared-validation/tests/roles.test.ts` and
`packages/client/tests/route-guard.property.test.ts` to the new numbers.

---

## 3. Backend changes

| Area | File | Change |
| --- | --- | --- |
| Override authority | `shared-validation/src/rules/overrides.ts` | `canOverride`: `SUPERVISOR||ADMIN` → `MACHINE_HEAD||ADMIN` |
| Override roles | `server/src/services/authService.ts` | `OVERRIDE_ROLES`: drop **only** the string `'SUPERVISOR'` from the array (keeps `MACHINE_HEAD, ADMIN, PLANT_HEAD`). **Do NOT touch** `verifySupervisorOverridePin` itself or `POST /auth/supervisor-override` in `authRoutes.ts` — the mechanism stays (see Critical Distinction). |
| Line/approve policy | `server/src/auth/lineAccessPolicy.ts` | Remove the 3 SUPERVISOR branches; grant APPROVE/WRITE-scoped to MACHINE_HEAD via machine→process (see §1). Update `ensureLineScopes` default level for MACHINE_HEAD. |
| Approve/reject/reopen | `server/src/routes/shiftLogRoutes.ts` (L309/320/331) | `requireRole([SUPERVISOR, PLANT_HEAD])` → `requireRole([MACHINE_HEAD, PLANT_HEAD])`; add `await assertShiftLogApproval(user, shiftLog)` inside each handler (machine-wise, §1). PLANT_HEAD/ADMIN skip the machine check via existing carve-outs. |
| Export authz | `server/src/export/auth/exportAuthz.ts` + `routes/exportRoutes.ts` | Drop `SUPERVISOR` (MACHINE_HEAD already permitted) |
| Device registration | `server/src/routes/deviceRoutes.ts` | `[ADMIN, SUPERVISOR]` → `[ADMIN, MACHINE_HEAD]` |
| Traceability | `server/src/routes/traceabilityRoutes.ts` | replace `SUPERVISOR` with `MACHINE_HEAD` in both role lists |
| Shift audit | `server/src/routes/shiftRoutes.ts` (L97) | replace `SUPERVISOR` with `MACHINE_HEAD` |
| Live board | `server/src/routes/liveRoutes.ts` | drop/replace `SUPERVISOR` |
| Machine access `/me` | `server/src/routes/machineAccessRoutes.ts` (L19) | drop `SUPERVISOR` |
| Reports | `server/src/routes/reportRoutes.ts` | `/supervisor` (L22) → rename to `/machine-head` (or fold into machine-head dashboard); replace `SUPERVISOR` in `/drilldown`, `/daily`, `/coil-traceability`, `/handover`, `/plant-head*` |
| Reporting services | `server/src/services/ReportingService.ts`, `services/reporting/DashboardReportingService.ts` | rename `getSupervisorDashboard` → `getMachineHeadDashboard`; scope its query by machine→process, not line |
| Validation gate ctx | `server/src/services/shiftLogValidationService.ts` | any `UserRole.SUPERVISOR` role checks → `MACHINE_HEAD` |
| Shift override reason | `server/src/services/ShiftDetectionService.ts` + `routes/shiftRoutes.ts` | **DECIDED: rename** `'SUPERVISOR_INSTRUCTION'` → `'MACHINE_HEAD_INSTRUCTION'` in the `ShiftOverrideReason` type and the `validReasons` list. Requires the CHECK-constraint + row-backfill migration in §4. |
| 6HI | `server/src/services/SixHiService.ts` | replace `SUPERVISOR` role checks with `MACHINE_HEAD` |

---

## 4. Data migration (new `migrations/19xx_remove_supervisor_role.js`)

Reversible. Reassign users, convert their scope from lines to machines, then drop the role.

```sql
-- up
-- 1. Re-point every SUPERVISOR user to MACHINE_HEAD
UPDATE security.user_role ur
   SET role_id = (SELECT role_id FROM security.role WHERE role_name='MACHINE_HEAD')
 WHERE role_id = (SELECT role_id FROM security.role WHERE role_name='SUPERVISOR');

-- 2. Convert their line_access → machine_access (machine-wise):
--    grant every machine whose process is a line they could act on
INSERT INTO security.machine_access (user_id, machine_code)
SELECT DISTINCT la.user_id, m.machine_code
  FROM security.line_access la
  JOIN master.machine m ON m.process_id = la.process_id
 WHERE la.user_id IN (/* the reassigned users */)
ON CONFLICT DO NOTHING;

-- 3. Remove the SUPERVISOR role row (now unreferenced)
DELETE FROM security.role WHERE role_name='SUPERVISOR';
```

```sql
-- 4. Rename the override reason code (DECIDED) — CHECK constraint + backfill existing rows
UPDATE txn.shift_override_audit
   SET reason_code = 'MACHINE_HEAD_INSTRUCTION'
 WHERE reason_code = 'SUPERVISOR_INSTRUCTION';

ALTER TABLE txn.shift_override_audit DROP CONSTRAINT IF EXISTS shift_override_audit_reason_code_check;
ALTER TABLE txn.shift_override_audit ADD  CONSTRAINT shift_override_audit_reason_code_check
  CHECK (reason_code IN ('OVERTIME','PREV_SHIFT_CONTINUATION','MACHINE_HEAD_INSTRUCTION','SHIFT_CORRECTION','OTHER'));
```

`down`: re-insert the SUPERVISOR role row (id 2), and restore the old reason code + constraint.
User re-assignment is not auto-reversible, so snapshot affected `user_id`s in the migration
comment for manual rollback.

**Gate:** run the FK check from `DB_AUDIT.md` §6 on `security.role` first; confirm no code path
still reads role_id 2 after §2–§3 land.

---

## 5. Client changes

| File | Change |
| --- | --- |
| `components/RoleRoute.tsx` | remove any `SupervisorRoute` export/guard; keep rank logic (renumbered) |
| `lib/roleHome.ts` | delete the `SUPERVISOR` case (machine head already routes to `/machine-head-dashboard`) |
| `lib/authStore.ts`, `lib/userScope.ts`, `lib/machineRouting.ts`, `lib/reportingService.ts`, `lib/authApi.ts` | strip `SUPERVISOR` branches; route former supervisor behavior through MACHINE_HEAD |
| `pages/plant/PlantShiftReviewPage.tsx` → move/rename to machine-head area | **DECIDED: keep it a functional screen for MACHINE_HEAD.** Surface the shift-review (approve/reject/reopen) route inside the machine-head dashboard/navigation, guarded by `MachineHeadRoute`, and **filter the shift-log list to only the machines in the user's `machineAccess`** (machine-wise, §1). It must remain fully functional — this is the machine head's primary approval surface. |
| `pages/admin/UsersAdmin.tsx` | remove the `SUPERVISOR` `<option>` from the role dropdown + its badge color case |
| `pages/admin/SystemAdmin.tsx`, `pages/Login.tsx`, `pages/MachineComingSoon.tsx`, `pages/sixHi/HandoverAcceptPage.tsx`, `components/sixHi/SixHiManualOrderModal.tsx` | remove `SUPERVISOR` **role** conditionals; fold into MACHINE_HEAD where the behavior should persist |
| ⚠️ `components/forms/FieldWrapper.tsx`, `operator/sync/SyncStatusBadge.tsx`, `lib/authApi.ts` | **KEEP the `authApi.supervisorOverride(...)` calls — they use the override-PIN mechanism, NOT the role.** Only remove a literal `UserRole.SUPERVISOR` role branch if one exists in the file; leave the override-PIN usage untouched (see Critical Distinction). |

---

## 6. Seeds & fixtures

Convert the seeded supervisor persona into a machine head (badge 2000 can stay, role changes),
or delete it if redundant with the existing machine-head seed:

- `server/scripts/seed-pilot-users.mjs` — the `{ username:'supervisor', role_id:2, lines:[…] }` row → `role_id: MACHINE_HEAD`, replace `lines` with `machines`
- `server/scripts/seed-admin.mjs`, `seed-login-profiles.mjs`, `seed-pilot.mjs`, `seed-zedral-demo.mjs` — drop/convert supervisor console lines + role inserts
- `server/seed.sql`, `server/seed_security.sql` — remove the `SUPERVISOR` role insert
- `server/scripts/apply-machine-shift-migration.sql`, `scripts/migrate_phase11.ts` — strip supervisor refs

---

## 7. Tests to update / rename

| File | Action |
| --- | --- |
| `server/tests/integration/supervisorLifecycle.integration.test.ts` | rename → `machineHeadLifecycle…`; assert machine-scoped approve/reject/reopen |
| `server/tests/rbac.test.ts`, `tests/reportRoutes.test.ts`, `tests/exportRoutes.test.ts`, `tests/userRoutes.test.ts`, `tests/auth/lineAccessPolicy.test.ts`, `tests/properties/security.test.ts`, `tests/shiftLogValidation.test.ts`, `tests/export/exportPhase7.test.ts`, `tests/integration/validationConfigService.integration.test.ts` | replace SUPERVISOR actors with MACHINE_HEAD; assert machine-scope boundaries |
| `shared-validation/tests/roles.test.ts`, `tests/properties/warnOverride.property.test.ts`, `tests/properties/validations.test.ts` | new rank numbers; override authority = MACHINE_HEAD |
| `client/tests/roleHome.test.ts`, `tests/route-guard.property.test.ts`, `tests/userScope.test.ts` | drop SUPERVISOR; renumbered ranks |

---

## 8. "Unusable supervisor things" to delete outright

- The `SUPERVISOR` enum value, rank, label, and DB role row.
- The `/reports/supervisor` endpoint name (rename to machine-head) — no orphan.
- The seeded `supervisor` demo user (convert or delete).
- Any `SupervisorRoute` guard export.
- Doc references to nonexistent supervisor pages (`ReviewQueue`, `CorrectionQueue`, `SupervisorDashboard`) — already gone from code; scrub from `PROJECT_STRUCTURE.md`.

**DO NOT delete (not the role):** `verifySupervisorOverridePin`, `POST /auth/supervisor-override`,
`authApi.supervisorOverride`, and their call sites in `FieldWrapper.tsx` / `SyncStatusBadge.tsx`.
Also **do not edit** the pre-existing `M1-10_Operator_APK_Conversion.md` / `AGENTS_for_android_folder.md`
— their "supervisor PIN" references are the override mechanism, not the role.

---

## 9. Full file inventory (65 files touching SUPERVISOR)

**shared-validation (6):** `types/roles.ts`, `rules/overrides.ts`, `rules/shiftLogRules.ts`, `tests/roles.test.ts`, `tests/properties/warnOverride.property.test.ts`, `tests/properties/validations.test.ts`

**server/src (14):** `auth/lineAccessPolicy.ts`, `export/auth/exportAuthz.ts`, `routes/authRoutes.ts`, `routes/deviceRoutes.ts`, `routes/exportRoutes.ts`, `routes/liveRoutes.ts`, `routes/machineAccessRoutes.ts`, `routes/reportRoutes.ts`, `routes/shiftLogRoutes.ts`, `routes/shiftRoutes.ts`, `routes/traceabilityRoutes.ts`, `services/ReportingService.ts`, `services/reporting/DashboardReportingService.ts`, `services/ShiftDetectionService.ts`, `services/SixHiService.ts`, `services/authService.ts`, `services/shiftLogService.ts`, `services/shiftLogValidationService.ts`

**server tests (9)** and **server scripts/seeds (9):** see §6/§7.

**client (16):** `components/RoleRoute.tsx`, `components/forms/FieldWrapper.tsx`, `components/sixHi/SixHiManualOrderModal.tsx`, `lib/authApi.ts`, `lib/authStore.ts`, `lib/machineRouting.ts`, `lib/reportingService.ts`, `lib/roleHome.ts`, `lib/userScope.ts`, `operator/sync/SyncStatusBadge.tsx`, `pages/Login.tsx`, `pages/MachineComingSoon.tsx`, `pages/admin/SystemAdmin.tsx`, `pages/admin/UsersAdmin.tsx`, `pages/plant/PlantShiftReviewPage.tsx`, `pages/sixHi/HandoverAcceptPage.tsx` + 3 client tests.

> **KEEP-not-remove within this list** (override-PIN mechanism, not the role):
> `server/src/routes/authRoutes.ts` (`/auth/supervisor-override`), `client/lib/authApi.ts`
> (`supervisorOverride`), `client/components/forms/FieldWrapper.tsx`, `client/operator/sync/SyncStatusBadge.tsx`.
> These appear in the grep only because they contain the word "supervisor" — see Critical Distinction.

---

## 10. Execution order

1. `shared-validation` enum/rank/labels + override authority (§2, §3 override rows) — regenerate downstream.
2. Server policy + helpers (`resolveShiftLogMachines`, `assertShiftLogApproval` — machine-wise, §1) + route role lists (§3).
3. Server reports/services rename + machine-scoping (§3).
4. Client guards/pages/libs (§5).
5. Data migration (§4) — **after** code no longer reads role_id 2.
6. Seeds + tests (§6, §7).
7. Completion gate — **role-scoped, NOT a blanket "supervisor" grep:**
   - `grep -rn "UserRole.SUPERVISOR\|'SUPERVISOR'\|SupervisorRoute\|role_id.*2\b" packages` → **zero** (role fully gone).
   - `grep -rn "supervisorOverride\|verifySupervisorOverridePin\|supervisor-override" packages` → **unchanged** (override-PIN mechanism intact — this is the safety check that you did NOT break the APK kiosk flow).
   - `npm run build && npm test && npm run arch:check` green.
   > ⚠️ Do **not** use a blanket `grep -ri supervisor = zero` gate — it would demand deleting the override-PIN mechanism and break kiosk exit / parked-action discard.

---

## 11. Decisions — RESOLVED

1. **`SUPERVISOR_INSTRUCTION` reason code** → **RENAMED** to `MACHINE_HEAD_INSTRUCTION`. Migration in §4 handles the CHECK constraint + backfills existing rows; code list updated in §3.
2. **Shift-review UI** → **stays a functional screen, opened to MACHINE_HEAD**, surfaced in the machine-head dashboard/nav and filtered to their machines (§5).
3. **Approval scope** → **machine-wise only** (§1). Scope is the specific machine(s) a shift ran on — *not* the whole process. A machine head assigned only 4HI cannot approve 6HI/2HI work.
