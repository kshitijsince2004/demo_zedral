# Zedral M1 — Fix Spec: Hold/Reject, 4HI, 2HI, Operator Profiles

**Target tree:** the mounted **`hsl_zedral-main`** folder (real, current code).
**Fingerprint:** `crm_order` + SuperTokens present · SUPERVISOR removed · machine-aware guard
(`assertMachineAccess`) present · **66 migrations**, newest `1927`. **Spec only** — no edits made.
**Verdict up front:** 4HI/2HI are **architecturally wired and functional**; the real work is Hold
hardening, the Rolling thickness display, tightening silent `6HI` fallbacks, and seeding 4HI/2HI
operators. Line numbers are from this tree — confirm before editing (folder is not git-tracked).

---

# TASK 1 — Hold (reject) functionality

## 1.1 What works (verified)
- Backend: `routes/sixHiRoutes.ts:683` `POST /orders/:batchNo/reject` → `SixHiExecutionService.rejectOrder` (requires `rejectionReason`). OK.
- Button: `components/sixHi/SixHiProductionActionRail.tsx:83` `canReject = status !== COMPLETED && !== REJECTED`; rendered L155 with `variant="warn"`. OK.
- Rail chain: `SixHiLayout.tsx:204` `onReject: () => setRejectionOpen(true)` → modal. OK when the rail is shown (rail requires `panelOrder`, and `activeBatch` includes `panelOrder?.batchNumber`).

## 1.2 Defect A — latent silent-fail on the rejection dialog *(HIGH)*
`components/sixHi/SixHiLayout.tsx`:
- L133 `const activeBatch = combinedRun?.primaryBatchNumber ?? workspaceBatch ?? panelOrder?.batchNumber ?? machineActive?.batchNumber;`
- L135 `const actionBatchNumbers = combinedRun?.batchNumbers.length ? ... : activeBatch ? [activeBatch] : [];`
- L259 the modal mounts **only** `{activeBatch && (<OrderRejectionModal .../>)}`.
- L122-127 a global store hook `requestRejectionDialog` is registered as `() => setRejectionOpen(true)` — **it ignores its `batchNo` argument** (the store types it `(batchNo: string) => void`, `store/sixHiStore.ts:87`).

**Problem:** if `requestRejectionDialog(batch)` is ever called (or `rejectionOpen` is set) while
`activeBatch` is null, the modal never mounts and `actionBatchNumbers` is `[]` → the reject POST fires
for zero batches → **silent no-op**. Currently `requestRejectionDialog` has **no callers** (latent), but
the contract mismatch + `activeBatch` gating is a real trap.

**Fix:**
1. Add explicit target state: `const [rejectionBatch, setRejectionBatch] = useState<string | null>(null)`.
2. Change the store hook to honor its argument:
   ```ts
   requestRejectionDialog: (batchNo: string) => { setRejectionBatch(batchNo); setRejectionOpen(true); },
   ```
3. Derive the reject target as `const rejectTarget = rejectionBatch ?? activeBatch;` and use it for the
   modal `batchNumber` and to build `actionBatchNumbers` (`combinedRun?.batchNumbers.length ? ... : rejectTarget ? [rejectTarget] : []`).
4. **Always mount** the modal (remove the `{activeBatch && ...}` gate at L259); inside `OrderRejectionModal`
   disable submit when no target batch, and if `actionBatchNumbers.length === 0` on submit, surface an
   error toast instead of silently resolving.
5. Reset `rejectionBatch` to null in `onClose`.

**Verify:** open Hold from the rail and from a `requestRejectionDialog(batch)` call → both POST `/reject`;
never a silent no-op.

## 1.3 Defect B — Rolling console missing thickness + variance *(HIGH; also affects 4HI)*
`components/sixHi/FourHiRollingForm.tsx` has **no** thickness display (0 refs to `ThicknessSpecs`/
`inputThk`), whereas `SharedSkinPassForm.tsx` renders the shared `components/sixHi/ThicknessSpecs.tsx`
(Pre-Stage/Input + Target + Variance from `minThkTolMm`/`maxThkTolMm`).

**Fix:** render `<ThicknessSpecs .../>` in the **main work area** of `FourHiRollingForm.tsx` (not just a
header one-liner), passing `order.inputThkMm` (pre-stage), `order.ppcThkMm` (target),
`order.minThkTolMm`/`order.maxThkTolMm` (variance). Reuse the existing component; mirror the skin-pass
layout. Confirm the same block appears in `CombinedProductionOrdersPanel.tsx` for combined 4HI runs.
**Verify:** a 4HI/6HI rolling order shows Input + Target thickness + tolerance variance in the console.

## 1.4 Defect C — error visibility *(LOW)*
`OrderRejectionModal.tsx` shows "Hold remarks are required" as an inline error that can sit above the
fold on a tablet. Scroll it into view / show as a toast, and keep the submit button disabled until
`remarks.trim()` is non-empty.

---

# TASK 2 — 4HI machine (functional; targeted fixes)

## 2.1 Verified working
Routing (`LegacyMillRedirect machine="4HI"`, `App.tsx:115`), `activeMachine` init on login
(`authStore.ts:100` `pickDefaultMachine`), machine-context sync
(`useWorkspaceBase` → `millCodeFromPath(activeMachine)` → `SixHiLayout:84 setMachineCode` → API `?machine=4HI`),
machine-aware guard (`sixHiRoutes.ts:53 requireCrmMill` → `assertMachineAccess`), 4HI tabs = rolling +
skinpass (`millConfig.ts:24`), order assignment (`/6hi/order-assignment`, `/orders/assign`,
`/orders/:batchNo/allocate-machine`). Production console = `FourHiRollingForm` (rolling) +
`SharedSkinPassForm` (skinpass). **4HI works end-to-end.**

## 2.2 Fixes for 4HI
1. **Rolling thickness** — Task 1 §1.3 (the rolling console is 4HI's primary capture surface).
2. **Silent `6HI` fallback in the guard** — `sixHiRoutes.ts:57`
   `String(req.body?.machine ?? req.query?.machine ?? '6HI')`. If a 4HI client call omits the `machine`
   param, it silently reads/writes **6HI**. Change the default to **required**: return `400
   'machine param required'` when absent (or resolve from the session's active machine), so a missing
   param can't cross mills. Audit every client 4HI call passes `machine`.
3. **Silent coercion in assign** — `sixHiRoutes.ts:123`
   `(['6HI','4HI','2HI'].includes(a.machineCode) ? a.machineCode : '6HI')`. Replace the `: '6HI'` fallback
   with a validation error so a bad machineCode is rejected, not silently sent to 6HI.

---

# TASK 3 — 2HI machine (functional; skin-pass-only correct)

## 3.1 Verified working
Same wiring as 4HI, plus **2HI skin-pass-only is correctly enforced**: `millConfig.ts:23`
`if (machine === '2HI') return ['skinpass']`, `millSupportsRolling` (L28) excludes 2HI,
`normalizeMillTab` (L36-37) forces `skinpass` even if the URL says `rolling`. `ROLLING_MILLS`/
`SKIN_PASS_MILLS` (`utils/machineAllocation.ts:5-6`) exclude 2HI from rolling. **2HI works end-to-end
for skin-pass.**

## 3.2 Fixes for 2HI
1. The two **silent `6HI` fallbacks** (Task 2 §2.2.2/2.2.3) matter more for 2HI — a dropped `machine`
   param would silently hit 6HI (a rolling mill), which is nonsensical for a 2HI terminal. Same fix.
2. **Guard rolling endpoints against 2HI** — server-side, reject rolling actions (start rolling,
   rolling pass save) when `machine === '2HI'` via `assertMachineForSubProcess('ROLLING', machine)`
   (`utils/machineAllocation.ts:20`) so a crafted request can't create a 2HI rolling order. Confirm
   `/orders/:batchNo/rolling` and pass endpoints call it.
3. Confirm the 2HI shift-summary/handover path works with no rolling data (skin-pass-only snapshot).

---

# TASK 4 — 4HI/2HI operator profiles (the real loose end)

## 4.1 Verified working
Access gates: `components/MillAccessGate.tsx:18` `canAccessMachine(role, machineAccess, machine)` and
`HandoverAcceptGate.tsx:30` block operators without the machine. A CRM operator **with** 4HI (or 2HI)
`machine_access` lands correctly and is scoped.

## 4.2 The loose end — no 4HI/2HI operator persona
`server/scripts/seed-pilot-users.mjs:47-48`:
- `operator` (badge 3000) → `machines: ['6HI']` **only**.
- `machinehead` (4000) → `['6HI','4HI','2HI']` (a head, not a line operator).
So **no operator account can run 4HI or 2HI production**; only the machine head has access, and there's
no seeded 4HI/2HI operator to validate the profile.

**Fix:**
1. **Seed operators** — add to `seed-pilot-users.mjs`: e.g. `{ username:'operator4hi', emp_code:'3004',
   role_id:1, lines:['ROLLING'], machines:['4HI'] }` and `{ username:'operator2hi', emp_code:'3002',
   role_id:1, lines:['ROLLING'], machines:['2HI'] }`. (`security.machine_access` is the scoping axis.)
2. **Admin path** — confirm `UsersAdmin` + `MachineAssignmentPage` (`/machine-access`) can grant 4HI/2HI
   to any operator (the machine picker must list all three CRM mills — verify `lib/accessOptions.ts` /
   `MACHINE_OPTIONS`).
3. **Landing check** — a 4HI-only operator: `pickDefaultMachine` → `4HI`, `resolvePrimaryMachinePath` →
   scope home, workspace resolves `machine=4HI`. Verify `preferCrmMachine` doesn't force `6HI` for a
   4HI-only user (it shouldn't — 6HI isn't in their access). Add a quick test.

---

# Anomaly summary + suggested order
| # | Anomaly | Severity | Where |
| --- | --- | --- | --- |
| A | Rejection dialog silent-fail + `requestRejectionDialog` ignores `batchNo` | HIGH | `SixHiLayout.tsx:122-135,259`, `sixHiStore.ts:87` |
| B | Rolling console missing thickness + variance (hits 6HI **and** 4HI) | HIGH | `FourHiRollingForm.tsx`, `ThicknessSpecs.tsx`, `CombinedProductionOrdersPanel.tsx` |
| C | Silent `6HI` fallback on missing `machine` param | MED | `sixHiRoutes.ts:57,123` |
| D | 2HI rolling not server-guarded | MED | `sixHiRoutes.ts` rolling endpoints + `assertMachineForSubProcess` |
| E | No seeded 4HI/2HI operator persona | MED | `seed-pilot-users.mjs:47-48` |
| F | Reject "remarks required" error off-screen on tablet | LOW | `OrderRejectionModal.tsx` |

**Order:** F/B (UI, quick) → A (Hold hardening) → C/D (guard tightening) → E (seed + admin verify).
Green gate: `npm run build && npm test` after each.
