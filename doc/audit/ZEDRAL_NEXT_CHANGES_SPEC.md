# Zedral M1 — Execution Spec (IDE-ready)

**Repo:** `zedral_test-main` (monorepo). **Read this whole "How to use" block before starting.**

This spec is written to be executed by a coding agent/IDE task-by-task. Tasks are atomic
(≈ one commit/PR each), ordered by dependency, and each has **Files**, the **exact change**,
**Verify** commands, and a **Done when** gate. Snippets show real anchors from this repo — match
them exactly. Do **not** batch multiple tasks into one commit.

### Scope (4 workstreams)
- **W1 — 4HI/2HI mills** (generalize the 6HI/`crm6_*` stack to be machine-keyed).
- **W2 — Machine-Head / Plant-Head UI** (finish incomplete ends).
- **W3 — SuperTokens auth** (staff = email+password; operators = PIN; full session migration).
- **W4 — HeadWind MDM** (device-owner kiosk + OTA for the Android APK).

### Decisions already made (baked in — do NOT re-ask; override only via the marked config point)
1. **Rolling process + 3 mills:** the three mills (**2HI, 4HI, 6HI**) all sit under one **Rolling**
   process = `process_id 31` (currently mis-coded `6HI` from an earlier rename — recode it to
   `ROLLING`). `machine_code` is the real discriminator. **2HI is skin-pass only** (temper mill, no
   rolling stage); **4HI and 6HI** do rolling + skin-pass, per `ROLLING_MILLS=['6HI','4HI']` /
   `SKIN_PASS_MILLS=['2HI','4HI','6HI']` in `utils/machineAllocation.ts` (leave that file as-is). Do
   **not** use `process_id = 3` (legacy `prod_crm` CRS form, deprecated). [W1-T2]
2. **`crm6_*` → `crm_*`:** rename with a transitional updatable **view** named `crm6_*` kept for
   one release (monorepo deploys together; the view protects the migrate-before-deploy window). [W1-T1]
3. **Per-mill behavior:** identical to 6HI except the sub-process set — **2HI = skin-pass only,
   4HI = rolling + skin-pass** — driven by existing `ROLLING_MILLS`/`SKIN_PASS_MILLS` in
   `utils/machineAllocation.ts`. No other per-mill branching.
4. **Auth:** self-hosted SuperTokens Core on the plant LAN; **full** migration to ST sessions;
   staff EmailPassword; operators badge+PIN via a **manually-created** ST session; roles/scopes in
   the access-token payload; **staged cutover** with a compat shim (W3-T2). [W3]
5. **MDM (HeadWind Free, self-hosted):** **HeadWind agent = device owner**; it provides silent OTA
   app updates + a restricted launcher showing only Zedral. Lockdown is **soft** (Free has no
   single-app Kiosk lock — pressing Home returns to a launcher that shows only Zedral, not a hard
   lockTask). The app's own COSU self-pin stays **dormant** (only active if the app itself is device
   owner, i.e., bench). [W4]
6. **Plant-Head "coming soon" pages:** wire Alerts/Defects/Production/Stoppages to live data; leave
   `IntelligenceComingSoon` as an explicit placeholder. [W2-T3]

### Guardrails (NEVER violate)
- **Do not touch the override-PIN mechanism:** `verifySupervisorOverridePin`,
  `POST /auth/supervisor-override`, client `authApi.supervisorOverride`, and their call sites in
  `FieldWrapper.tsx` / `SyncStatusBadge.tsx`. It is role-agnostic and powers the APK kiosk exit.
- **Do not edit** `packages/client/android/app/src/main/assets/public/**` (compiled web bundle).
- **Do not** upgrade Capacitor/Gradle/AGP/plugins, or add Google Play/Firebase/analytics SDKs.
- **Every migration** ships a working `exports.down`. **Every destructive DB step** is gated by an
  in-migration row/FK check.
- After any schema change, **regenerate** `packages/server/src/db-types.ts` (+ `db/types.ts`) and
  commit the regen separately.

### Standard verify commands (run from repo root unless noted)
```
npm run build && npm test && npm run arch:check
npm run smoke:api        # after server-affecting phases
# migration round-trip on a scratch DB: apply up then down
```

### Repo conventions
- Server: `packages/server/src` (Express + Kysely + node-pg-migrate `packages/server/migrations`).
- Shared types/rules: `packages/shared-validation/src`. Client: `packages/client/src` (React/Vite).
- Roles enum: `@m1/shared-validation` → `packages/shared-validation/src/types/roles.ts`
  (`OPERATOR/MACHINE_HEAD/PLANT_HEAD/ADMIN`).

---

# W1 — Add 4HI & 2HI as first-class CRM mills

Order: **W1-T1 → W1-T2 → W1-T3 → W1-T4 → W1-T5 → W1-T6 → W1-T7**. The model already exists in
`packages/server/src/utils/machineAllocation.ts` (`ROLLING_MILLS=['6HI','4HI']`,
`SKIN_PASS_MILLS=['2HI','4HI','6HI']`, `parseCrmMillCode`, `millsForSubProcess`,
`assertMachineForSubProcess`). This workstream finishes the wiring; it does not invent new logic.

## W1-T1 — Migration: rename `crm6_*` → `crm_*` (+ transitional views)

**Files:** new `packages/server/migrations/1925000000000_generalize_crm_tables.js`

**Change:** rename the five tables; create `crm6_*` views over them for one release.
```js
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.crm6_order         RENAME TO crm_order;
    ALTER TABLE txn.crm6_rolling       RENAME TO crm_rolling;
    ALTER TABLE txn.crm6_rolling_pass  RENAME TO crm_rolling_pass;
    ALTER TABLE txn.crm6_skinpass      RENAME TO crm_skinpass;
    ALTER TABLE txn.crm6_shift_summary RENAME TO crm_shift_summary;

    -- transitional 1:1 updatable views (auto-updatable in Postgres); drop in a later contract migration
    CREATE VIEW txn.crm6_order         AS SELECT * FROM txn.crm_order;
    CREATE VIEW txn.crm6_rolling       AS SELECT * FROM txn.crm_rolling;
    CREATE VIEW txn.crm6_rolling_pass  AS SELECT * FROM txn.crm_rolling_pass;
    CREATE VIEW txn.crm6_skinpass      AS SELECT * FROM txn.crm_skinpass;
    CREATE VIEW txn.crm6_shift_summary AS SELECT * FROM txn.crm_shift_summary;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    DROP VIEW IF EXISTS txn.crm6_order, txn.crm6_rolling, txn.crm6_rolling_pass,
                        txn.crm6_skinpass, txn.crm6_shift_summary;
    ALTER TABLE txn.crm_order         RENAME TO crm6_order;
    ALTER TABLE txn.crm_rolling       RENAME TO crm6_rolling;
    ALTER TABLE txn.crm_rolling_pass  RENAME TO crm6_rolling_pass;
    ALTER TABLE txn.crm_skinpass      RENAME TO crm6_skinpass;
    ALTER TABLE txn.crm_shift_summary RENAME TO crm6_shift_summary;
  `);
};
```
**Verify:** migration up then down on scratch DB; `SELECT to_regclass('txn.crm_order')` non-null after up.
**Done when:** round-trip passes; `crm6_*` still selectable (via views) and `crm_*` exist as tables.

## W1-T2 — Migration: recode process 31 to `ROLLING` + wire 4HI/2HI machine identity

**Files:** new `packages/server/migrations/1925000000001_rolling_process_and_mills.js`

**Change:** recode the machine-centric process `id 31` from `6HI` → `ROLLING` (it represents the
**Rolling** process that contains all three mills, not a single mill), point `4HI`/`2HI` machines at
it, and ensure the sub-process rows. **2HI is skin-pass only** — it gets only a skin-pass sub-process.
```js
exports.up = (pgm) => {
  pgm.sql(`
    -- process 31 is the Rolling process (holds 6HI/4HI/2HI); recode away from the single-mill '6HI'
    UPDATE master.process SET code = 'ROLLING', name = 'Rolling' WHERE process_id = 31;

    -- all three mills sit under the Rolling process; machine_code is the real discriminator
    UPDATE master.machine SET process_id = 31, process_code = 'ROLLING'
     WHERE machine_code IN ('6HI','4HI','2HI');

    -- sub-processes: 6HI/4HI roll + skin-pass; 2HI skin-pass ONLY (temper mill)
    INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
      ('4HI_ROLLING',   '4HI Rolling',   '4HI'),
      ('4HI_SKIN_PASS', '4HI Skin Pass', '4HI'),
      ('2HI_SKIN_PASS', '2HI Skin Pass', '2HI')
    ON CONFLICT (sub_process_code) DO NOTHING;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE master.machine SET process_id = NULL, process_code = NULL WHERE machine_code IN ('4HI','2HI');
    UPDATE master.machine SET process_code = '6HI' WHERE machine_code = '6HI';
    UPDATE master.process SET code = '6HI', name = '6HI' WHERE process_id = 31;
  `);
};
```
**Also (same PR): fix `code='6HI'` process references.** Recoding the process can affect anything that
keyed on the process **code** `6HI` (line-access seeds, `requireModule`/routing, reports grouping by
process code). The route guard is already switched to machine-based in W1-T3, but sweep the rest:
```
grep -rn "'6HI'\|\"6HI\"\|=6HI\|code = '6HI'\|process_code" packages/server/src packages/server/migrations packages/client/src | grep -iv machine
```
For each hit that means the **process** (not a machine), use `ROLLING`; leave **machine_code**
`'6HI'` (the mill) untouched. This is the one place to be careful — machine `6HI` ≠ process `ROLLING`.

> **Config point (override):** to instead give 4HI/2HI their **own** `master.process` rows, create
> them here and set `process_id` per mill, then add them to the process-table map in W1-T4. Default is
> the single shared Rolling process above.

**Verify:** `SELECT machine_code, process_id, process_code FROM master.machine WHERE machine_code IN
('6HI','4HI','2HI')` → all `31 / ROLLING`; `SELECT code FROM master.process WHERE process_id=31` → `ROLLING`.
**Done when:** all three mills resolve the Rolling process; `resolveShiftLogMachines`
(`auth/machineAccessPolicy.ts`) maps them; no stale process-code `'6HI'` references remain.

## W1-T3 — Server: make the CRM route guard machine-aware

**Files:** `packages/server/src/routes/sixHiRoutes.ts`

**Change:** `requireSixHi` is hardcoded to `'6HI'`. Resolve the target machine and assert **machine**
access. Current code:
```ts
function requireSixHi(operation: LineAccessLevel) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      assertLineOperation(req.user, '6HI', operation);
      next();
    } catch (e) { res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' }); }
  };
}
```
Replace with (resolve machine from `req.query.machine`/`req.body.machine`, default `6HI`):
```ts
import { assertMachineAccess } from '../auth/machineAccessPolicy';
import { parseCrmMillCode } from '../utils/machineAllocation';

function requireCrmMill(operation: LineAccessLevel) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    const raw = String(req.body?.machine ?? req.query?.machine ?? '6HI');
    const machine = parseCrmMillCode(raw) ?? '6HI';
    try {
      assertMachineAccess(req.user, machine); // ADMIN/PLANT_HEAD carve-out already inside
      next();
    } catch (e) { res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' }); }
  };
}
const requireSixHi = requireCrmMill; // keep name to minimize churn across 42 handlers
```
**Verify:** `grep -n "assertLineOperation(req.user, '6HI'" packages/server/src/routes/sixHiRoutes.ts` → none.
**Done when:** a MACHINE_HEAD with only `4HI` in `machineAccess` gets 403 on a `machine=6HI` call and 200 on `machine=4HI`; ADMIN/PLANT_HEAD unaffected.

## W1-T4 — Server: sweep `crm6_*` table refs → `crm_*`; de-6HI the services

**Files:** `packages/server/src/services/SixHiService.ts`, `services/sixHi/*`,
`services/MachineHandoverService.ts`, `services/shiftLogService.ts`, plus any `crm6_` string.

**Change:**
1. Replace table-name strings `txn.crm6_` → `txn.crm_` across `packages/server/src` (was 148 refs).
   Do it as a literal find/replace of the table strings, not identifier names, to avoid touching
   class names like `SixHiService`.
2. `shiftLogService.ts` process-table map — update the CRM entry:
   ```ts
   // before:  31: 'txn.crm6_order',
   31: 'txn.crm_order',
   ```
3. `SixHiService.ts`: the constant `SIX_HI_PROCESS_CODE = '6HI'` and any 6HI-only lookups must use
   the request's `CrmMillCode`. Gate rolling behind `ROLLING_MILLS.includes(machine)` so a 2HI order
   never enters the rolling stage (skin-pass only).
4. `MachineHandoverService.ts`: where the snapshot reads the order table directly, keep reading
   `crm_order` (post-rename). No behavior change; just the name.
**Verify:** `grep -rn "txn.crm6_" packages/server/src` → none (views remain only in the migration).
`npm run build` green.
**Done when:** server builds; existing 6HI tests pass against `crm_*`.

## W1-T5 — Server: regenerate DB types

**Files:** `packages/server/src/db-types.ts`, `packages/server/src/db/types.ts`

**Change:** run `kysely-codegen` (project's existing script); expect `crm6_*`→`crm_*` interface
renames. Commit separately.
**Done when:** `npm run build` green; diff shows only the rename.

## W1-T6 — Client: turn on 4HI/2HI workspaces (all profiles)

**Files:** `packages/client/src/App.tsx` (2 `crm6` refs), `lib/machineRouting.ts`, `lib/millPath.ts`,
`lib/roleHome.ts`, `pages/sixHi/*`, `components/sixHi/*`, `pages/admin/UsersAdmin.tsx`.

**Change:**
1. `App.tsx`: replace the 2 `crm6` references with `crm`; ensure 4HI/2HI routes resolve to the real
   sixHi workspace instead of `MachineComingSoon`.
2. Routing already lists `CRM_MILL_CODES=['6HI','4HI','2HI']` — remove the `/coming-soon` fallback for
   these codes in `roleHome.ts`/`millPath.ts`.
3. `pages/sixHi/*` (`SixHiHub`, `SixHiCapturePage`, `SixHiOrderPage`, `SixHiQueuePage`,
   `SixHiShiftSummaryPage`, `CrmOutgoingHandoverPage`, `HandoverAcceptPage`): read the active machine
   from route/scope, pass it on every API call as `machine=<code>`.
4. `components/sixHi/*`: wire `FourHiRollingForm` into the 4HI rolling path; `SharedSkinPassForm` for
   all skin-pass flows. **Rolling UI must not render when machine ∈ SKIN_PASS-only (2HI)** — drive off
   `millsForSubProcess`/`ROLLING_MILLS`.
5. `UsersAdmin.tsx`: machine-access picker must list all three CRM mills so admins can grant
   `security.machine_access` for `4HI`/`2HI`.
**Verify:** manual/e2e — log in as an operator scoped to 4HI → full workspace loads (no "coming soon");
2HI workspace shows no rolling stage.
**Done when:** 4HI and 2HI each render a working operator workspace with the correct sub-process set.

## W1-T7 — Tests: per-mill end-to-end

**Files:** `packages/server/tests/*`, client e2e.

**Change:** add a 4HI test then a 2HI test: PPC import → queue → start order → (4HI: rolling passes →)
skin pass → end order → outgoing handover → accept; assert a MACHINE_HEAD scoped to that mill can
approve its shift and **cannot** approve another mill's.
**Done when:** new tests green; `arch:check` + `smoke:api` green.

---

# W2 — Machine-Head & Plant-Head UI (finish incomplete ends)

## W2-T1 — Remove residual SUPERVISOR dead-code

**Files:** `client/src/lib/authStore.ts:172`, `client/src/lib/roleHome.ts:24`,
`client/src/components/RoleRoute.tsx:25` (comment), `shared-validation/src/rules/overrides.ts:12` (comment).
**Change:** delete `if (role === 'SUPERVISOR') return true;` (authStore) and the dead
`case 'SUPERVISOR':` block (roleHome); fix the two stale comments to the 4-role model.
**Verify:** `grep -rn "SUPERVISOR" packages/client/src packages/shared-validation/src | grep -vi supervisorOverride` → none.
**Done when:** grep clean; `npm run build` green.

## W2-T2 — Machine-Head: enforce machine-scoping in the UI

**Files:** `pages/live/MachineHeadDashboard.tsx` (921 L),
`components/machinehead/MachineHeadOrderDetailModal.tsx`, `MachineHeadOrderSidePanel.tsx`,
`orderAssignment/OrderAssignmentPage.tsx`, `pages/plant/PlantShiftReviewPage.tsx` (199 L),
`pages/machinehead/MachineHeadCrewPage.tsx` (186 L), `components/layout/machinehead/MachineHeadNav.tsx`.
**Change:**
1. Every list/query filters by `authStore.machineAccess` (machine-wise), not line/process. After W1 a
   4HI head sees only 4HI.
2. `PlantShiftReviewPage.tsx` is the machine head's **primary approval surface**: mount under a
   `MachineHeadRoute`, filter the shift list to `machineAccess`, and confirm approve/reject/reopen hit
   the machine-wise `assertShiftLogApproval` server-side.
3. `MachineHeadCrewPage.tsx`: read/write `master.machine_crew_roster` for the head's machines; handle
   empty/loading/error states.
4. `MachineHeadNav.tsx`: every nav item routes to a live page (no `/coming-soon`); drop SUPERVISOR-era items.
**Done when:** a 4HI-only head sees/acts on only 4HI data across dashboard, orders, and shift review.

## W2-T3 — Plant-Head: wire the "coming soon" report pages

**Files:** `pages/reports/PlantAlerts.tsx`, `PlantDefects.tsx`, `PlantProduction.tsx`,
`PlantStoppages.tsx` (wire); `IntelligenceComingSoon.tsx` (leave as explicit placeholder);
data via `services/ReportingService.ts` + `routes/reportRoutes.ts`.
**Change:** bind each of the four pages to its existing reporting endpoint (production, defects,
stoppages, alerts). Remove the "coming soon" state; add loading/empty/error. Confirm 4HI/2HI data
appears once those mills produce (queries must be plant/process-wide, not 6HI-hardcoded).
**Done when:** the four pages render live data including 4HI/2HI; Intelligence remains a labeled placeholder.

## W2-T4 — Plant-Head: dashboard + handover source check

**Files:** `pages/reports/PlantHeadDashboard.tsx` (384 L), `components/plant-head/*`,
`services/ReportingService.ts`, `routes/reportRoutes.ts` (`GET /handover`).
**Change:** verify KPI strip / ops feed / quality-downtime / backlog drawer bind to live endpoints and
include the new mills; confirm handover widgets read `txn.machine_handover` (no legacy `handover_*`
column reads remain post-consolidation).
**Done when:** dashboard renders complete, mill-inclusive data with no dead widgets.

---

# W3 — SuperTokens auth (staff email+password; operators PIN; full ST sessions)

**Architecture:** self-host ST **Core** on the plant LAN against existing Postgres. Staff log in with
EmailPassword. Operators keep badge+PIN — the badge-PIN route verifies the PIN in our code (unchanged)
then **creates an ST session manually**, so the whole app runs on one session layer. Roles/`lineAccess`/
`machineAccess` are written into the access-token payload. Cut over in stages (W3-T2 shim).

## W3-T1 — Infra: run ST Core + config

**Files:** `docker-compose.yml`, `packages/server/src/config/authConfig.ts`, `.env(.example)`.
**Change:** add a `supertokens` service (image `registry.supertokens.io/supertokens/supertokens-postgresql`)
with `POSTGRESQL_CONNECTION_URI` → existing Postgres, dedicated schema. New env:
`SUPERTOKENS_CORE_URI`, `SUPERTOKENS_API_KEY`, `API_DOMAIN`, `WEBSITE_DOMAIN`. Extend `authConfig.ts` to
read them.
**Done when:** `docker compose up supertokens` healthy; server reads config.

## W3-T2 — Backend: init ST + compat-shim middleware (staged cutover)

**Files:** `packages/server/src/app.ts`, `middleware/authMiddleware.ts`; add deps `supertokens-node`.
**Change:**
1. `app.ts`: `supertokens.init({ framework:'express', supertokens:{connectionURI, apiKey}, appInfo,
   recipeList:[ EmailPassword.init(), Session.init({ /* custom claims, see W3-T3 */ }) ] })`. Add ST
   `middleware()` **before** routes and ST `errorHandler()` **after**; ensure CORS exposes ST headers
   (CORS already has `credentials:true`, line 53).
2. `authMiddleware.ts` `requireAuth`: **shim** — try ST `getSession()` first; if no ST session, fall
   back to the existing `verifyToken(Bearer)` path for the transition window. Build `req.user` from
   whichever succeeds (ST → from access-token payload; legacy → as today). This lets the 22 route
   modules cut over without a flag day. Remove the legacy branch in W3-T6.
**Verify:** existing Bearer-token requests still pass; a request with an ST session also passes.
**Done when:** both auth paths resolve `req.user`; build/test green.

## W3-T3 — Backend: custom claims + operator session; rework authRoutes

**Files:** `packages/server/src/routes/authRoutes.ts`, `services/authService.ts`,
migration `1926000000000_add_supertokens_user_id.js`.
**Change:**
1. Migration: add `security.app_user.supertokens_user_id TEXT NULL` (+ index). `down` drops it.
2. `Session.init` override `createNewSession`: merge `{ roles, lineAccess, lineScopes, machineAccess }`
   from `getUserWithRolesAndAccess(userId)` into the access-token payload.
3. `authRoutes.ts`:
   - `POST /badge-pin`: keep `validateBadgePin(badgeId, pin)`; on success call
     `Session.createNewSession(req, res, 'public', supertokens.convertToRecipeUserId(String(user.id)),
     { roles, lineAccess, lineScopes, machineAccess })` instead of `generateTokens`. **Verify the exact
     `createNewSession` signature against the installed `supertokens-node` version.**
   - `POST /token` (mock OIDC) and `POST /refresh`: **remove** (ST issues/rotates staff sessions).
   - `POST /verify-pin` and `POST /supervisor-override`: keep; read `req.user` from the ST session.
   Keep `verifySupervisorOverridePin` and `validateBadgePin`/`verifyUserPin` untouched (guardrail).
4. `authService.ts`: remove `generateTokens`/`verifyToken`; keep everything else.
**Done when:** operator badge+PIN yields a working ST session with correct claims; staff EmailPassword
login works; override-PIN endpoints unchanged.

## W3-T4 — Client: ST SDK + auth libs

**Files:** `packages/client/src/main.tsx`, `lib/apiClient.ts`, `lib/authApi.ts`, `lib/authSession.ts`,
`lib/authStore.ts`, `pages/Login.tsx`; add deps `supertokens-auth-react`, `supertokens-web-js`.
**Change:**
1. `main.tsx`: `SuperTokens.init({ recipeList:[ EmailPassword.init(), Session.init() ] })`; wrap app.
2. `apiClient.ts`: remove manual `Authorization: Bearer`; add ST session interceptor (auto refresh + CSRF).
3. `authStore.ts`/`authSession.ts`: hydrate role/lineAccess/machineAccess from
   `Session.getAccessTokenPayloadSecurely()` instead of decoding the old JWT.
4. `Login.tsx`: two paths — **staff** email+password (ST) and **operator** badge+PIN pad (POST
   `/badge-pin`, now returns via ST cookies). Default operator tablets to the PIN pad.
**Done when:** staff and operator logins both establish an ST session; role-home routing works.

## W3-T5 — Data migration: create ST users for staff

**Files:** `packages/server/scripts/*` (new `migrate-staff-to-supertokens.mjs`); seeds
`seed-*.mjs`.
**Change:** for each ADMIN/PLANT_HEAD/MACHINE_HEAD `app_user`, create an ST EmailPassword user (email +
temp password, force reset), store `supertokens_user_id`. Operators are **not** ST users. Update seeds:
staff via ST, operators via `app_user`+PIN.
**Done when:** all staff can log in via ST; operators unaffected.

## W3-T6 — Remove the legacy shim

**Files:** `middleware/authMiddleware.ts`.
**Change:** after W3-T2..T5 verified in a production-like env, delete the legacy `verifyToken(Bearer)`
fallback so only ST sessions remain.
**Verify:** `grep -rn "verifyToken\|generateTokens" packages/server/src` → none.
**Done when:** ST is the sole session layer; build/test/smoke green.

---

# W4 — HeadWind MDM for the Android APK

**Context:** Capacitor app `com.zedral.m1operator`; native at `packages/client/android`. `android/AGENTS.md`
already names HeadWind as the fleet channel. **Using HeadWind Free (self-hosted).** HeadWind enrolls as
**device owner** and gives silent OTA updates + a restricted launcher showing only Zedral. Free has **no
single-app Kiosk lock** (that's Premium), so lockdown is "soft": Home returns to a launcher that shows
only Zedral. Acceptable for company-owned, line-mounted tablets with employee operators. The app's own
COSU self-pin stays dormant (W4-T1) because HeadWind — not the app — is device owner.

## W4-T1 — APK: don't fight HeadWind for device ownership

**Files:** `packages/client/android/app/src/main/java/com/zedral/m1operator/MainActivity.java`.
**Change:** today `startLockTask()` is called unconditionally in a try/catch. Under HeadWind ownership the
app is **not** device owner, so self-pinning should be skipped to avoid fighting HeadWind's lock task.
Replace the lock-task block:
```java
// before:
DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
if (dpm != null) {
  ComponentName admin = new ComponentName(this, KioskAdminReceiver.class);
  if (dpm.isDeviceOwnerApp(getPackageName())) {
    dpm.setLockTaskPackages(admin, new String[]{ getPackageName() });
  }
}
try { startLockTask(); } catch (Exception e) { /* screen pinning */ }
```
```java
// after: only self-pin when THIS app is device owner (bench). HeadWind owns lockdown in the field.
DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
if (dpm != null && dpm.isDeviceOwnerApp(getPackageName())) {
  ComponentName admin = new ComponentName(this, KioskAdminReceiver.class);
  dpm.setLockTaskPackages(admin, new String[]{ getPackageName() });
  try { startLockTask(); } catch (Exception e) { /* ignore */ }
}
// else: managed by HeadWind (or unmanaged bench) — do not self-pin.
```
Keep `hideSystemUI()` immersive behavior unchanged. Keep `KioskAdminReceiver` for the bench/fallback path.
**Done when:** app runs without error whether or not it is device owner; no crash under HeadWind.

## W4-T2 — APK: release hygiene for OTA

**Files:** `packages/client/android/app/build.gradle`, `capacitor.config.ts` (verify only),
`res/xml/network_security_config.xml`.
**Change:** ensure `versionCode` **increments every release** (HeadWind OTA keys on it) and release
builds use the **same** env-var signing keystore across versions (HeadWind updates in place only with a
consistent key). If the plant server is HTTP-only on the LAN, scope cleartext to that single host in
`network_security_config.xml`; also allow the HeadWind server host. Confirm `appId` in
`capacitor.config.ts` (`com.zedral.m1operator`) matches the package registered in HeadWind.
**Done when:** `./gradlew assembleRelease` produces a signed APK with a bumped `versionCode`.

## W4-T3 — HeadWind server setup (ops runbook — no repo code)

**Steps (HeadWind Free, self-hosted):**
1. Install HeadWind MDM server (Ubuntu + Tomcat/Java; the **Free** self-hosted build) on the plant LAN.
2. Build signed `app-release.apk` (W4-T2); upload to HeadWind **Applications** repository (not Play Store).
3. Create a **Configuration**: add `com.zedral.m1operator` and mark it the **main/auto-launch app**;
   restrict the launcher to only this app; hide/limit status & nav bars where the Free launcher allows;
   set the engineer/admin password for maintenance. (No single-app "Kiosk mode" checkbox on Free —
   the restricted launcher is the lockdown.)
4. Enroll each tablet: factory reset → tap 6–7× on welcome (or `afw#setup`) → scan HeadWind QR → agent
   becomes **device owner** → installs APK → launcher auto-opens Zedral.
5. OTA: upload a higher `versionCode` APK to HeadWind → devices auto-update silently (device owner).
**Done when:** a factory-reset tablet enrolls via QR, boots into Zedral via the HeadWind launcher (only
Zedral is reachable), and updates silently from HeadWind. Zero Google account; plant LAN only.
> **Lockdown note:** Free = soft lock (Home returns to the Zedral-only launcher). If you later need a
> hard single-app lock (operator physically cannot leave the app), that requires HeadWind Premium's
> Kiosk mode **or** flipping to app-as-device-owner (W4-T1's self-pin path) — but the latter gives up
> HeadWind's silent OTA. Not needed for the employee-operated plant-floor case.

---

# Cross-workstream order & branching
- **W1 + W2** = one branch (they share machine-scoping); do first.
- **W3** = its own branch (largest, riskiest); regression-test operator PIN before merge; use the W3-T2 shim.
- **W4** = parallel; only small, safe APK changes (W4-T1/T2) plus the ops runbook (W4-T3).

# Suggested commit sequence
1. `chore(db): rename crm6_*→crm_* with transitional views` (W1-T1)
2. `feat(crm): wire 4HI/2HI machine identity` (W1-T2)
3. `refactor(crm): machine-aware route guard` (W1-T3)
4. `refactor(crm): sweep crm6_*→crm_*, de-6HI services` (W1-T4) + `chore: regen db-types` (W1-T5)
5. `feat(client): enable 4HI/2HI workspaces` (W1-T6) + tests (W1-T7)
6. `chore(ui): remove residual SUPERVISOR` (W2-T1)
7. `fix(mh): machine-scope MH surfaces` (W2-T2)
8. `feat(ph): wire coming-soon report pages` (W2-T3) + dashboard check (W2-T4)
9. `feat(auth): ST core + shim middleware` (W3-T1/T2) → claims+routes (W3-T3) → client (W3-T4) → migrate (W3-T5) → drop shim (W3-T6)
10. `fix(apk): defer device ownership to HeadWind` (W4-T1) + `chore(apk): OTA release hygiene` (W4-T2)

---

## Sources
- [SuperTokens — backend setup / self-hosting](https://supertokens.com/docs/quickstart/backend-setup)
- [SuperTokens — architecture & concepts](https://supertokens.com/docs/authentication/enterprise/important-concepts)
- [SuperTokens — sessions / access-token payload](https://supertokens.com/docs/post-authentication/session-management/access-session-data)
- [HeadWind MDM — kiosk mode (COSU)](https://h-mdm.com/kiosk-mode/)
- [HeadWind MDM — quick start / enrollment](https://h-mdm.com/quick-start/)
- [HeadWind MDM server (GitHub)](https://github.com/h-mdm/hmdm-server)
