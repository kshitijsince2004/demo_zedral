# Zedral M1 — Enhancements Spec (IDE-ready)

Execution-ready tasks for 7 enhancements, grounded in the current `zedral_test-main` code. Each
task lists **Files**, the **exact change**, **Verify**, and a **Done when** gate. One commit per
task; don't batch.

## Decisions locked
| Item | Decision |
| --- | --- |
| 1 User management | Wire create/update/disable/reset to **SuperTokens** (staff email+password); keep operator PIN |
| 2 Session limit | **Both**: explicit auth-session timeout **and** one active session per user (new login revokes old) |
| 3 Shift Review (MH) | **Keep** and polish — it's the machine-head approval surface |
| 4 Order traceability | Reuse the existing search page; **expose to Machine Head** (nav + route) |
| 5 Rolling thickness | Show **Pre-Stage/Input Thickness + Variance** in the rolling console, reusing the skin-pass block; handle combined orders |
| 6 Validation rules | **Full engine upgrade**: multiple rules/field, cross-field + %-of-field + range + conditional, per-process scope, evaluator + admin UI |
| 7 Draft autosave | **Local-only** reusable hook (Capacitor Preferences / localStorage), debounced, silent |

## Guardrails
- Don't touch the override-PIN mechanism (`verifySupervisorOverridePin`, `/auth/supervisor-override`).
- Every migration reversible (`exports.down`). Regenerate `db-types.ts` after schema changes.
- Green gate per task: `npm run build && npm test && npm run arch:check`.
- Depends on the earlier fixes (`ZEDRAL_FIX_GUARD_AND_LOGIN.md`): item 1 assumes staff email login exists; do that first.

---

# Item 1 — User management ↔ SuperTokens

**Problem (verified):** `userRoutes` (guarded `[ADMIN, PLANT_HEAD]`) → `UserService.create/update` writes
`security.app_user` + `pin_hash` only. **No ST account, no email/password, no `supertokens_user_id`.**
So staff created in the UI cannot use the email login. Operators (PIN) are fine.

### 1.1 Backend — create ST EmailPassword users for staff
**Files:** `packages/server/src/services/UserService.ts`, `routes/userRoutes.ts`.
- Add `email?: string` and `password?: string` to `UpsertUserInput`.
- In `UserService.create`, after inserting `app_user`, **if the role is staff** (ADMIN/PLANT_HEAD/MACHINE_HEAD)
  and an email is given:
  ```ts
  import EmailPassword from 'supertokens-node/recipe/emailpassword';
  // …after app_user insert + replaceRole:
  if (isStaffRole(input.role) && input.email) {
    const signUp = await EmailPassword.signUp('public', input.email.trim(), input.password || genTempPassword());
    if (signUp.status === 'OK') {
      await db.updateTable('security.app_user')
        .set({ supertokens_user_id: signUp.user.id })
        .where('user_id', '=', created.user_id).execute();
    } else if (signUp.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
      throw new Error('Email already registered');
    }
  }
  ```
- In `UserService.update`: if email changes → `EmailPassword.updateEmailOrPassword`; expose a
  **password reset** path (`updateEmailOrPassword({ recipeUserId, password })`).
- On **disable** (status→DISABLED): revoke ST sessions —
  `Session.revokeAllSessionsForUser(supertokens_user_id)`.
- Add `genTempPassword()` + `isStaffRole()` helpers.

**Verify:** create a MACHINE_HEAD with email → row has `supertokens_user_id`; that email can sign in.
**Done when:** staff created via API get a working ST login; operators unchanged.

### 1.2 Client — email/password fields for staff roles
**Files:** `packages/client/src/pages/admin/UsersAdmin.tsx`.
- When the selected role is staff, show **Email** (required) and **Temp password** (optional →
  auto-generate) inputs; keep the PIN field for operators. Send `email`/`password` in the create/update
  payload. Add a "Reset password" action on staff rows.
- Keep the existing machine-access picker (it already persists via `MachineAccessService`).

**Verify:** admin creates a plant-head with email+password → they log in via the Staff tab.
**Done when:** the UI can fully provision a staff account (email login) and an operator (PIN) in one place.

---

# Item 2 — Session timeout + one active session per user

### 2.1 Auth-session timeout (explicit lifetimes)
SuperTokens token lifetimes are **core config**, not SDK. Set them on the `supertokens` service.
**Files:** `docker-compose.yml`, `deploy/docker-compose.prod.yml` (the supertokens service).
```yaml
environment:
  ACCESS_TOKEN_VALIDITY: 900        # 15 min (seconds) — restore old behavior
  REFRESH_TOKEN_VALIDITY: 10080     # 7 days (minutes)
```
(Confirm units against the SuperTokens core version — access is seconds, refresh is minutes.)
**Done when:** access tokens expire in 15 min and silently refresh until the 7-day refresh expires.

### 2.2 One active session per user (concurrency)
Revoke a user's other sessions when a new one is created, in the `createNewSession` hook already in
`app.ts`.
**Files:** `packages/server/src/app.ts` (the `Session.init({ override: { functions … createNewSession }})`).
```ts
// inside createNewSession override, BEFORE calling the original:
const existing = await Session.getAllSessionHandlesForUser(input.userId);
// original creates the new session; then revoke the old handles:
const newSession = await originalImplementation.createNewSession(input);
await Promise.all(existing.map((h) => Session.revokeSession(h)));
return newSession;
```
> Applies to staff **and** operators. If a plant genuinely needs one operator on two devices, scope
> this to staff roles only (check `input.userContext`/claims).

**Verify:** log in as the same user on two browsers → the first is signed out on the second login.
**Done when:** a second login invalidates the first; single active session per user.

---

# Item 3 — Machine-Head Shift Review (keep + polish)

**Status:** functional — `/machine-head/shift-review` (`PlantShiftReviewPage`), in `MachineHeadNav`,
approve via `PUT /shift-logs/:id/approve`, reject with note. **Do not remove.** Polish only:
**Files:** `packages/client/src/pages/plant/PlantShiftReviewPage.tsx`.
- Ensure the SUBMITTED list is **filtered to the head's `machineAccess`** (machine-wise) and that
  approve/reject/reopen go through `assertShiftLogApproval` server-side (they should post-supervisor-refactor).
- Add loading/empty/error states and a reopen action if missing.
**Done when:** a 4HI head sees/acts on only 4HI submitted shifts; approvals audited.

---

# Item 4 — Order traceability for Machine Head

**Status:** ~done for Plant Head. `TraceabilityService.search` already returns `machineJourney`
(step→process→machine→status), and `PlantOrderTracking.tsx` renders search + a "Machine Journey" table.
Backend `/traceability` already allows `MACHINE_HEAD`. **Just expose it to the machine head.**

**Files:** `packages/client/src/components/layout/machinehead/MachineHeadNav.tsx`,
`packages/client/src/App.tsx`, (optional) rename `PlantOrderTracking` → shared `OrderTraceabilityPage`.
- Add a nav item (e.g. `id: 'traceability', label: 'Order Tracing', path: '/machine-head/traceability'`).
- Add the route under `MachineHeadRoute` rendering the same page:
  ```tsx
  <Route path="/machine-head/traceability" element={<MachineHeadRoute><PlantOrderTracking /></MachineHeadRoute>} />
  ```
- Confirm the page's machine-journey/workflow section is prominent (it is) and that the machine head's
  search is not plant-scoped in a way that hides their orders.
**Done when:** a machine head has an "Order Tracing" left-menu item, searches by order/batch/coil, and
sees full details + the process/machine workflow.

---

# Item 5 — Rolling: input thickness + variance from PPC

**Status:** data exists. `ppc_batch`/`crm_order` carry `input_thk_mm` (pre-stage), `min_thk_tol_mm`,
`max_thk_tol_mm`; `SixHiOrderDetail` exposes `inputThkMm`, `minThkTolMm`, `maxThkTolMm`. The skin-pass
form already renders "Pre-Stage Thickness + Thickness Variance" (`SkinPassThicknessSpecs` in
`SharedSkinPassForm.tsx`). Rolling console doesn't.

**Files:** `packages/client/src/components/sixHi/FourHiRollingForm.tsx` + the rolling production
header/console; reuse/extract `SkinPassThicknessSpecs`; `CombinedProductionOrdersPanel.tsx` +
`lib/combinedWeightAllocation.ts`.
1. **Extract** the thickness/variance block from `SharedSkinPassForm.tsx` into a shared component
   `ThicknessSpecs` (props: `inputThkMm`, `ppcThkMm`/target, `minThkTolMm`, `maxThkTolMm`).
2. **Render it in the rolling console** for rolling mills (6HI/4HI): show **Input (Pre-Stage) Thickness**
   = `order.inputThkMm`, **Target Thickness** = `order.ppcThkMm`, **Variance** = tol pos/neg from
   `order.maxThkTolMm`/`order.minThkTolMm`.
3. **Combined orders:** in `CombinedProductionOrdersPanel`, show per-order input thickness + variance
   using the same shared component (mirror the skin-pass combined handling).
> Note: `SixHiService` line ~288 computes `inputThk` per sub-process — ensure the **rolling** path reads
> the PPC `input_thk_mm` (pre-stage), not a skin-pass offset.
**Done when:** the rolling production console shows input/pre-stage thickness + variance for single and
combined orders, sourced from PPC.

---

# Item 6 — Configurable validation engine upgrade (industrial-grade)

**Current model (limits):** `config.validation_rule` has **`field_id` as PK** (one rule per field);
`configurableRuleEvaluator.ts` handles only single-field types (RANGE/ENUM/STEP/PATTERN/REQUIRED) with
static `params`. It **cannot** express cross-field rules like *"actual weight ≥ 97% of PPC target
weight"* (references another field, as a percentage), nor multiple rules per field, nor per-process
scoping.

### 6.1 Schema — multiple rules, cross-field, scoping
**Files:** new migration `packages/server/migrations/19xx_validation_rules_v2.js`.
- New PK `rule_id` (uuid/serial); keep `field_id` as a **non-unique** column; add:
  `process_code VARCHAR NULL` (scope; null = all), `machine_code VARCHAR NULL`,
  `applies_when JSONB NULL` (conditional predicate), `active BOOLEAN DEFAULT true`.
- Keep `rule_type`, `severity` (BLOCK/WARN), `params JSONB`. Migrate existing rows (each becomes one
  `rule_id`). `down` restores the single-PK table.

### 6.2 Rule types + evaluator (cross-field aware)
**Files:** `packages/shared-validation/src/rules/configurableRuleEvaluator.ts`,
`rules/runner.ts`, `types/validation.ts`, `rules/fieldRegistry.ts`.
- Change the evaluator signature to receive the **whole record** (not just one value):
  `evaluate(rule, value, record, context)`.
- Add rule types:
  - `MIN_PCT_OF_FIELD` / `MAX_PCT_OF_FIELD` — `params: { ofField, pct }` →
    e.g. `actual_weight_mt` with `{ ofField: 'ppc_weight_mt', pct: 97 }` blocks `< 97%`.
  - `COMPARE_FIELD` — `params: { op: '<'|'<='|'>'|'>=', field }` (e.g. output_thk < input_thk).
  - `CONDITIONAL` — `applies_when` predicate gates any base rule (e.g. only for `sub_process=ROLLING`).
  - keep RANGE/ENUM/STEP/PATTERN/REQUIRED.
- `runner.ts`: load **all active rules** for the record's process/machine, evaluate each with record
  context, collect BLOCK/WARN. Preserve override semantics (WARN clearable by MACHINE_HEAD/ADMIN).

### 6.3 Service + admin UI
**Files:** `server/src/services/ValidationConfigService.ts`, `routes/validationRulesRoutes.ts`,
`client/src/pages/admin/ValidationRulesAdmin.tsx`.
- Service: CRUD by `rule_id` (not field), list multiple rules/field, filter by process/machine, bump
  ruleset version on change (mechanism exists).
- Admin UI: rule builder — pick field, rule type, params (incl. **"% of field"** with a field picker),
  severity, process/machine scope, optional condition; list/edit/disable multiple rules per field.

### 6.4 Seed the example rule
Add the CRM weight-floor as config (not hardcoded):
`field_id=actual_weight_mt, type=MIN_PCT_OF_FIELD, params={ofField:'ppc_weight_mt', pct:97}, severity=BLOCK,
process_code=ROLLING` (and one for skin-pass).
**Verify:** entering actual weight < 97% of PPC target on a rolling order is **blocked**; 97%+ passes;
WARN rules are override-clearable.
**Done when:** cross-field/%/scoped/multi rules are configurable in the admin UI and enforced at submit.

---

# Item 7 — Local draft autosave for forms

**Feasible now:** forms use `react-hook-form`; a Capacitor SQLite/Preferences layer exists
(`operator/db/sqlite.ts`), plus an offline sync engine. Do a **local-only** reusable hook — no backend.

### 7.1 The hook
**Files:** new `packages/client/src/lib/useFormDraft.ts`.
```ts
// Debounced autosave of RHF values to device storage; restore on mount; clear on submit.
export function useFormDraft(form, key: string, opts = { debounceMs: 800 }) {
  // 1. on mount: read draft for `key` (Capacitor Preferences.get, fallback localStorage) → form.reset(draft)
  // 2. form.watch(): debounce → Preferences.set(key, JSON) ; silent (no UI)
  // 3. expose clearDraft() to call in onSubmitSuccess
}
```
- Storage key = `draft:<formId>:<orderId|shiftId>:<userId>` so drafts are per-form/order/user.
- Use Capacitor `Preferences` on device, `localStorage` on web (feature-detect). Cap size; JSON only.
- Silent by design (no toast); optional tiny "Draft saved" indicator if you want later.

### 7.2 Wire into the high-value forms
**Files:** `FourHiRollingForm.tsx`, `SharedSkinPassForm.tsx`, `pages/capture/GenericCapturePage.tsx`,
`CrmOutgoingHandoverPage.tsx`, and other multi-field operator forms.
- Call `const { clearDraft } = useFormDraft(form, draftKey)`; call `clearDraft()` after a successful submit.
**Verify:** fill a rolling form, hit browser back / refresh / kill the app → reopen → fields restored;
submit → draft cleared.
**Done when:** operator input survives accidental back/refresh/app-kill on the key forms, invisibly.

---

# Suggested order
1. **Item 1** (needs the staff-login fix first) — provisioning must work before anything else.
2. **Item 2** (small, isolated auth config).
3. **Item 4** (tiny — nav+route), **Item 3** (polish), **Item 5** (UI reuse) — quick wins.
4. **Item 7** (hook + wiring) — cross-cutting but self-contained.
5. **Item 6** (validation engine) — largest; its own branch, schema→evaluator→service→UI→seed.

## Sources
- [SuperTokens — user/session management (revokeAllSessionsForUser, getAllSessionHandlesForUser)](https://supertokens.com/docs/post-authentication/session-management/revoke-sessions)
- [SuperTokens — access/refresh token lifetime (core config)](https://supertokens.com/docs/post-authentication/session-management/session-expiry)
- [SuperTokens — EmailPassword sign up / update email or password](https://supertokens.com/docs/authentication/email-password/introduction)
