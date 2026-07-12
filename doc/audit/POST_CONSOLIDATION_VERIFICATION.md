# Post-Consolidation Verification Checklist

**Purpose:** verify the M1 Consolidation execution against the specs (`CONSOLIDATION_PLAN.md`,
`SUPERVISOR_REMOVAL_SPEC.md`, `DB_AUDIT.md`). Run each check **in the live repo**; the items
below are ordered by severity. 🔴 = must fix/decide before sign-off. 🟠 = verify, fix if it fails.

For each item: run the command, compare to **Expected**, and apply **If it fails**.

---

## 🔴 1. Supervisor refactor went off-spec (two new roles instead of MACHINE_HEAD)

The changelog created **`LINE_INCHARGE` + `SHIFT_MANAGER`**. The spec and the original instruction
were: **fold all SUPERVISOR capability into `MACHINE_HEAD`, machine-scoped.** This is a product
deviation that must be decided by a human, not just verified.

**Check what actually shipped:**
```
grep -rn "LINE_INCHARGE\|SHIFT_MANAGER\|MACHINE_HEAD" packages/shared-validation/src/types/roles.ts
grep -rn "LINE_INCHARGE\|SHIFT_MANAGER" packages/server/src/auth packages/server/src/services/authService.ts
```
**Expected (per spec):** SUPERVISOR gone; its capabilities on `MACHINE_HEAD`; final enum =
`OPERATOR, MACHINE_HEAD, PLANT_HEAD, ADMIN` (4 roles). **No** new `LINE_INCHARGE`/`SHIFT_MANAGER` roles.

**If it fails (new roles present):** decide —
- **(A) Enforce the spec:** revert `1913…_remove_supervisor_role.js` and the role edits; redo per
  `SUPERVISOR_REMOVAL_SPEC.md` (supervisor users → MACHINE_HEAD; `line_access` → `machine_access`;
  approval scoped machine-wise via `resolveShiftLogMachines` / `assertShiftLogApproval`).
- **(B) Accept the split:** only if you consciously want two roles — then update the specs +
  `ROLE_RANK`, and confirm the "4-role model" claim in the tests is corrected.

**Also confirm the override-PIN mechanism was NOT touched** (it only contains the word "supervisor"):
```
grep -rn "verifySupervisorOverridePin\|/auth/supervisor-override\|supervisorOverride" packages
```
**Expected:** still present and intact (powers field overrides + APK kiosk exit). If it was deleted → **restore it** (see `SUPERVISOR_REMOVAL_SPEC.md` Critical Distinction).

---

## 🔴 2. 6HI validation gate — may block every 6HI handover

`ShiftLogValidationService` only maps processes **1–9**; 6HI is **process_id 31**, so an
unconditional `assertValid` returns a BLOCK `"Unknown process line"` and throws on **every 6HI
handover**. The changelog didn't mention a process-31 exemption, and described validating the
*incoming* shift (wrong — gate the *outgoing* shift before close).

**Check for the exemption:**
```
grep -n "31\|Unknown process\|process_id\|PROCESS_ID_TO_CODE" packages/server/src/services/shiftLogValidationService.ts
grep -n "assertValid\|resolveShiftLogMachines\|process" packages/server/src/services/MachineHandoverService.ts
```
**Expected:** the gate is **process-aware** — runs `assertValid` for form lines (1–9) and **skips
process 31 (6HI)**; and it validates the **outgoing** shift in `createOutgoingHandover`, not the
incoming shift at accept.

**Runtime proof (the real test):** with `VALIDATION_STRICT=true`, perform a full 6HI outgoing
handover.
**Expected:** succeeds. **If it 400s with "Unknown process line"** → the gate isn't
process-aware. Fix: guard `assertValid` to `process_id ∈ 1..9`, no-op for 31.

---

## 🟠 3. Domain events deferred (Phase 1.2)

Changelog says event emission was deferred. Confirm the gap and its scope.
```
grep -rn "publishShiftClosed\|production.counted\|canonicalWriteback" packages/server/src/services/MachineHandoverService.ts
```
**Expected/known:** **no** `publishShiftClosed` in the handover path → `shift.closed`,
`production.counted`, and canonical write-back **do not fire on handover close** (they still fire on
`submit()`). Acceptable as deferred — **record it as open tech-debt**, and confirm nothing downstream
assumes events fire at handover.

---

## 🟠 4. Stoppages merged into the wrong survivor — verify 6HI repoint

Changelog unified into `txn.stoppage_entry` (Model A) and dropped `txn.order_stoppage` (Model B).
If any 6HI code still reads `order_stoppage`, 6HI stoppages are broken.
```
grep -rn "order_stoppage" packages/server/src        # MUST be zero
grep -rn "stoppage_entry\|txn.stoppage" packages/server/src/services/SixHiService.ts
```
**Expected:** zero `order_stoppage` references anywhere; `SixHiService` reads the unified table.
**Also confirm:** `publishDowntimeLogged` still fires from the stoppage create path, and the
Model B `category_code`/`breakdown_code` data has a home in the unified schema.
**If it fails:** repoint `SixHiService` (and any exporter) to the unified stoppage table.

---

## 🟠 5. change_request drop — audit trigger + column must survive

Spec: drop **only** `audit.change_request`; keep `audit_log.change_request_id` + the `fn_audit`
trigger + the GUC (they're role-agnostic and load-bearing for auditing).
```
grep -rn "change_request_id" packages/server/src/db.ts packages/server/src/services/AuditTrailService.ts
grep -rn "app.change_request_id\|change_request_id" packages/server/migrations/*audit* packages/server/migrations/*baseline_trigger*
```
**Expected:** `audit_log.change_request_id` column and the trigger's `current_setting('app.change_request_id', true)` read still exist; only the standalone table was dropped.
**If the column/trigger were also removed:** restore them — audited writes depend on the trigger, and it safely resolves to NULL when the GUC is unset.

---

## 🟠 6. `getProcessTable` — CRM/SKP production totals must not silently become 0

CRM (3) and SKP (5) tables are archived. If they were removed from `getProcessTable` while shift
logs still resolve production through it, `calculateActualProduction` returns 0 for those shifts.
```
grep -n "getProcessTable\|prod_crm\|prod_skp\|archive\." packages/server/src/services/shiftLogService.ts
```
**Expected:** CRM/SKP shifts either resolve production via Model B (crm6) **or** still map to the
archived tables for historical shifts — not a silent `null → 0`.
**Runtime:** open a historical CRM/SKP shift and confirm `total_prod_mt` is non-zero where data exists.

---

## 🟠 7. Model A handover route fully removed

`ShiftLogService.handover` logic was removed; confirm the **route** went too (else it 500s).
```
grep -rn "/:id/handover'\|ShiftLogService.handover\|handover(" packages/server/src/routes/shiftLogRoutes.ts
```
**Expected:** no `POST /shift-logs/:id/handover` route calling the deleted logic. The only handover
write path is `/machines/handover/*`.

---

## 🟠 8. Table-count + schema sanity

Changelog claims 90 → 86. Reconcile against the actual DB.
```sql
SELECT table_schema, count(*) FROM information_schema.tables
WHERE table_schema IN ('master','coil','txn','planning','security','audit','canon','config','dpr','archive')
GROUP BY table_schema ORDER BY table_schema;
SELECT to_regclass('txn.prod_crm'), to_regclass('archive.prod_crm'),
       to_regclass('txn.order_stoppage'), to_regclass('txn.change_request'), to_regclass('txn.prod_glv');
```
**Expected:** `archive.prod_crm`/`archive.prod_skp`/`archive.prod_skp_pass` **exist**; `txn.order_stoppage`,
`audit.change_request`, `txn.prod_glv`, `txn.crm` are **gone**. The archived tables explain why the net
drop is smaller than the number of "removed" items.

---

## Final sign-off gate

All of the following green before the consolidation is "done":

- [ ] Item 1 decided (supervisor: enforce spec **or** consciously accept the two-role split).
- [ ] Item 2: 6HI outgoing handover succeeds under `VALIDATION_STRICT=true`.
- [ ] Items 4–7: all greps return the expected (zero `order_stoppage`, audit trigger intact, no dead handover route, totals non-zero).
- [ ] `npm run build` · `npm run test:unit` · `npm run arch:check` green.
- [ ] `npx kysely-codegen` regenerated and committed; no dangling types.
- [ ] Item 3 (deferred events) logged as tracked tech-debt.
