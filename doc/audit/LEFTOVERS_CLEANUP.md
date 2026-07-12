# Post-Consolidation Leftovers — Cleanup Spec

The M1 consolidation is functionally complete (all core checks pass). These are the
**leftovers** found in the changed repo. Ordered by severity. File paths are relative to repo root.
Line numbers are approximate — anchor on the surrounding text.

---

## 🔴 1. Seed scripts resurrect the removed SUPERVISOR role

Migration `1913…_remove_supervisor_role.js` deletes the SUPERVISOR role, but seeds re-create it,
and there's a role_id mismatch. Fix all seed scripts.

**`server/scripts/seed-pilot-users.mjs`**
- Line ~37 — remove the SUPERVISOR role insert:
  ```
  (2, 'SUPERVISOR', 'Shift Supervisor: Can approve logs'),   ← DELETE this line
  ```
- Line ~24 — the `supervisor` user is assigned `role_id: 5` (= MACHINE_HEAD) while lines are set,
  not machines. Either delete this demo user, or convert it cleanly to a machine head:
  ```js
  // BEFORE
  { username: 'supervisor', emp_code: '2000', full_name: 'Line Supervisor', role_id: 5,
    lines: ['HRS','PKL','CRM','6HI'], machines: ['6HI','4HI','2HI'] },
  // AFTER (drop it, or rename + drop `lines`)
  { username: 'linehead', emp_code: '2000', full_name: 'Line Machine Head', role_id: 5,
    lines: [], machines: ['6HI','4HI','2HI'] },
  ```
- Confirm the role table block seeds only the 4 live roles: `(1 OPERATOR)`, `(3 PLANT_HEAD)`,
  `(4 ADMIN)`, `(5 MACHINE_HEAD)`. No `role_id 2`.

**`server/scripts/seed-zedral-demo.mjs`**
- Line ~134 — remove `(2,'SUPERVISOR','Shift Supervisor'),` from the role VALUES list.
- Lines ~139/165/170 — remove `'supervisor'` from any user/loop arrays.

**`server/scripts/seed-pilot.mjs` (~L56), `seed-login-profiles.mjs` (~L33), `pilot-smoke.mjs` (~L190,195)**
- Console labels / smoke-test names referencing "Supervisor". Rename to "Machine Head" or remove.
  If `pilot-smoke.mjs` logs in as badge 2000 and expects approve rights, confirm that user now
  resolves to MACHINE_HEAD after the seed fix, or point the smoke test at the machine-head user.

---

## 🔴 2. Client tests still encode the removed SUPERVISOR role

These reference a role/routes that no longer exist. `roleHome.test.ts` will **fail** (uses
`UserRole.SUPERVISOR`, now `undefined`).

**`client/tests/roleHome.test.ts` (~L15,16,28)**
- Delete the `SUPERVISOR` cases:
  ```js
  it('maps SUPERVISOR to /username.role workspace', () => {            // ← DELETE whole test
    expect(getRoleHomePath(UserRole.SUPERVISOR, [], ['4HI'], 'supervisor')).toBe('/supervisor.supervisor');
  });
  ```
  and any other `UserRole.SUPERVISOR` usage in this file.

**`client/tests/route-guard.property.test.ts`**
- Line ~28 — remove `SUPERVISOR: 2` from the local `ROLE_RANK`; renumber to
  `{ OPERATOR:0, MACHINE_HEAD:1, PLANT_HEAD:2, ADMIN:3 }`.
- Line ~81 — `roleArb`: drop `'SUPERVISOR'` → `fc.constantFrom('OPERATOR','MACHINE_HEAD','PLANT_HEAD','ADMIN')`.
- Lines ~64–70 — remove/repoint the dead routes `/review`, `/review/:shiftLogId`,
  `/reports/supervisor`; change any `minRole: 'SUPERVISOR'` to `'MACHINE_HEAD'`.
- Lines ~136,140,149–159,184–186 — update the assertions/hierarchy comment to the 4-role order
  `OPERATOR < MACHINE_HEAD < PLANT_HEAD < ADMIN`.

**`client/tests/userScope.test.ts` (~L13)**
- Remove or repoint `expect(userScopePath('Supervisor', 'SUPERVISOR'))…` to a live role.

---

## 🟠 3. Dead SUPERVISOR branches in client code

**`client/src/lib/roleHome.ts` (~L24)** — remove the unreachable case (also a TS error if `role: UserRole`):
```js
    case 'SUPERVISOR': {                          // ← DELETE this whole case block
      if (username && usesUserScopeHome(role)) {
        return userScopePath(username, role);
      }
      return '/plant';
    }
```

**`client/src/lib/authStore.ts` (~L172)** — remove the dead branch:
```js
    if (role === 'SUPERVISOR') return true;        // ← DELETE
```

**`client/src/components/RoleRoute.tsx` (~L25)** — fix the stale comment:
```
 *   OPERATOR < MACHINE_HEAD < SUPERVISOR < PLANT_HEAD < ADMIN   →   OPERATOR < MACHINE_HEAD < PLANT_HEAD < ADMIN
```

---

## 🟠 4. GLV — finish removing the dropped feature (decision required)

`txn.prod_glv` was dropped and removed from `getProcessTable`, but GLV still lingers here, leaving
the schema inconsistent. **Decide:** if GLV is permanently gone, remove all four; if it may return,
leave them but note process 9 won't resolve a table.

- `server/src/services/shiftLogValidationService.ts` (~L34) — remove `9: 'GLV',` from `PROCESS_ID_TO_CODE`.
- `shared-validation/src/rules/fieldRules.ts` (~L345 & ~L363) — remove `GLVSchema` and its entry in `ProcessSchemas`.
- `server/src/services/importRowValidator.ts` (~L10) — drop `'GLV'` from `PROCESS_CODES`.
- `server/src/export/read/rawRegisterQuery.ts` (~L157) — drop `'GLV'` from the `ALL` list.

*(Consistency note: `getProcessTable` already has no process 9, so leaving GLV in these lists means
a process-9 shift would validate/import but resolve no table. Cleanest to remove.)*

---

## 🟡 5. Cosmetic — comments/labels only (no functional impact)

- `shared-validation/src/rules/overrides.ts` (~L12) — comment says "SUPERVISOR or ADMIN"; code is
  already `MACHINE_HEAD || ADMIN`. Update the comment.
- `shared-validation/src/rules/shiftLogRules.ts` (~L19) — field message `'Supervisor ID is required'`
  (the `supervisorId` field = shift manager). Rename message if desired.
- Override-PIN UI text — **keep the mechanism**, optionally rename the words:
  `client/src/components/forms/FieldWrapper.tsx` (~L69 "Supervisor Override Required"),
  `client/src/operator/sync/SyncStatusBadge.tsx` (~L39,87 "Supervisor PIN"),
  `server/src/routes/authRoutes.ts` (~L117,150 comments). These power field overrides + APK kiosk
  exit — do **not** delete them; renaming to "Override PIN" is optional polish.

---

## ✅ Do NOT touch (correct by design)

- `audit_log.change_request_id` column + the `fn_audit` trigger (`current_setting('app.change_request_id', true)`).
- `archive.prod_crm` / `archive.prod_skp` / `archive.prod_skp_pass` tables + types.
- `verifySupervisorOverridePin`, `POST /auth/supervisor-override`, `authApi.supervisorOverride`.

---

## Sign-off after cleanup

- [ ] `grep -rn "UserRole.SUPERVISOR\|'SUPERVISOR'\|SupervisorRoute" packages --include=*.ts --include=*.tsx` → **0** (override-PIN excluded).
- [ ] `grep -rn "role_id.*2\|'SUPERVISOR'" packages/server/scripts` → **0**.
- [ ] GLV decision applied consistently (all four sites, or documented as intentionally retained).
- [ ] `npm run build` · `npm run test:unit` · `npm run arch:check` green — with the client tests actually running (confirm `roleHome.test.ts` passes, not skipped).
