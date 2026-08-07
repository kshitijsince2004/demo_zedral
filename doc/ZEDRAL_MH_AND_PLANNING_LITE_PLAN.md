# Zedral — Machine-Head Line Gating + Planning-Lite Account — Implementation Plan

**Date:** 2026-08-07
**Repo:** `zedral_test-share-the-code`
**Scope:** Runs *after* the optimization + audit passes already delivered
(`AUDIT_REPORT.md`, `Zedral_Enterprise_Readiness_Assessment.docx`). This plan adds
two features and a focused production-readiness audit for **only these changes** —
it does not re-open the platform-wide perf/security backlog.

Three deliverables:

1. **Task 1** — Machine-head desk shows only the features/options relevant to the
   lines actually assigned to that head (gate nav by assigned line).
2. **Task 2** — A dedicated, minimal **Planning-Lite** account (new `PLANNER` role)
   whose *only* capability is importing plans into the respective lines.
3. **Task 3** — A production-ready audit checklist scoped to the two changes above.

Overarching guardrail (from prior locked scope): **never modify the CRM/6HI/4HI/2HI
rolling engine or the operator capture/journey flows.** All new behaviour is purely
additive and lives behind the new role and behind assigned-line guards. Migrations
stay additive + idempotent with a `down()`. Build gate after each item:
`@m1/shared-validation → @zedral/platform → @m1/server → @m1/client`.

---

## 0. Current architecture (verified, so the plan is grounded)

### Machine-head desk resolution
- The MH left-nav is chosen in `packages/client/src/components/layout/machinehead/MachineHeadNav.tsx`.
  It resolves a **desk type** from `useOperationalMachineAccess()` (the machines
  assigned to the head, filtered to operational) plus a `focus` toggle
  (`useMhDeskFocus`), via helpers in `lib/pklMhDesk.ts`, `lib/annMhDesk.ts`,
  `lib/rwdMhDesk.ts`.
- Dedicated, correctly-gated desks exist for **ANN, RWD, HRS, PKL, HRS+PKL (combined toggle)**.
  Each returns its own `*_NAV_ITEMS` list (`ANN_NAV_ITEMS`, `RWD_NAV_ITEMS`, `hrsPklNavItems()`).
- **Gap (the Task-1 problem):** any assignment that is *not* one of those recognised
  desks falls through to `withLineScopedImports(ALL_NAV_ITEMS, machines)`
  (`MachineHeadNav.tsx:405-410`). `ALL_NAV_ITEMS` (lines 65-143) unconditionally
  shows **Order Assignment, CRS Assignment, Machine Specs, PKL Specs, ANN Specs**
  regardless of which lines the head actually holds. So:
  - A **CRS-only** or **CTL-only** head sees the full generic menu (CRS + PKL Specs
    + ANN Specs + Order Assignment), most of it irrelevant.
  - A **mixed** head (e.g. a CRM mill + HRS, or HRS + ANN) gets *all* items rather
    than the union of the two lines' items.
  - Only the **Import** item is line-scoped in this fallback; specs/assignment are not.

### Import surface (already exists — Planning-Lite reuses it)
- Client panel: `packages/client/src/components/admin/PpcRollingImportPanel.tsx`
  (preview → select rows → commit). It takes `lockedSheetType` + `line`.
  `LineMhImportPage.tsx` wraps it per line (HRS/PKL/RWD/ANN); `AnnMhImportPage`,
  `RollingImportPage` do the same for ANN/CRM.
- Client service: `services/adminService.ts` → `POST /api/6hi/import/ppc/preview`,
  `.../preview/:sessionId/commit` (plus CSV path `POST /import`, `ImportService`).
- Server routes: `packages/server/src/routes/sixHiRoutes.ts:180/233` — PPC preview &
  commit. Already gated `requireRole([ADMIN, MACHINE_HEAD, SUPERVISOR])` + `denyPlantHeadPpc(...)`.
- **Per-line enforcement already exists**: the preview/commit handlers call
  `assertLineOperation(req.user!, lineScope, 'WRITE')` (`sixHiRoutes.ts:185`, `:240`)
  when a `line` scope is present. This is the hook Planning-Lite plugs into.
- `parseImportLineScope()` (`PPCImportService.ts:81-85`) currently accepts **only
  HRS/PKL/RWD/ANN** — CTL and CRM/ROLLING/SKIN_PASS are *not* line-scoped today.

### Roles / auth
- Canonical roles: `packages/shared-validation/src/types/roles.ts` (`UserRole` enum +
  `ROLE_RANK` + `ROLE_LABELS`). Persisted in `security.role` / `security.user_role`;
  resolved by `UserService.ts` (`resolveRoleId`, `replaceRole`, `isStaffRole`).
- Server gate: `middleware/authMiddleware.ts` `requireRole()` (ADMIN always passes).
- Line write gate: `auth/lineAccessPolicy.ts` `assertLineOperation()` — **note:** its
  `WRITE` branch only allows `OPERATOR` or `MACHINE_HEAD` (`lineAccessPolicy.ts:96-107`).
  A raw new role would be rejected here → see Task 2, §2.3 for the chosen fix.
- Client route guards: `components/RoleRoute.tsx` (rank-based, with an `allow[]`
  capability escape hatch — already used to scope SUPERVISOR). Landing routes in
  `lib/roleHome.ts` `getRoleHomePath()`.
- Role migration template to copy: `migrations/1933000000000_reintroduce_supervisor_role.js`.

---

## Task 1 — Gate machine-head nav by assigned line

**Goal:** the desk shows exactly the union of features for the lines a head is
assigned, and nothing else. No behavioural change for the already-correct
ANN/RWD/HRS/PKL/HRS+PKL desks.

### 1.1 Design — a line-capability registry (data-driven, replaces the if/else leakage)
Introduce a single source of truth mapping a **line code → its nav items**, then
build the menu as the ordered union over the head's assigned lines. This replaces
the `ALL_NAV_ITEMS` fallback with a computed list.

New file `packages/client/src/lib/mhLineCapabilities.ts`:

```ts
// line code -> nav item ids that line contributes
export const LINE_NAV: Record<LineCode, DeskNavItemId[]> = {
  HRS: ['live', 'crew', 'shift-review', 'import', 'dpr-export', 'traceability'],
  PKL: ['live', 'crew', 'shift-review', 'pkl-specs', 'import', 'dpr-export', 'traceability'],
  ANN: ['ann-live', 'ann-batching', 'ann-report', 'crew', 'shift-review',
        'ann-import', 'dpr-export', 'traceability', 'ann-specs'],
  RWD: ['rwd-live', 'order-assignment', 'crew', 'shift-review', 'import',
        'dpr-export', 'traceability'],
  CRS: ['live', 'crs-assignment', 'crew', 'shift-review', 'import',
        'dpr-export', 'traceability'],           // gated set, was leaking via ALL_NAV
  CTL: ['live', 'crew', 'shift-review', 'import', 'dpr-export', 'traceability'],
  // CRM mills keep the existing rolling desk items (6HI/4HI/2HI):
  '6HI': ['live', 'order-assignment', 'machine-specs', 'import', 'dpr-export', 'traceability'],
  '4HI': [ /* same as 6HI */ ],
  '2HI': ['rwd-live', 'order-assignment', 'crew', 'shift-review', 'import', ...], // 2HI = RWD machine
};
```

- Keep a canonical item catalogue (id → `DeskNavItem`) so each id resolves to one
  definition; the menu is `orderedUnion(assignedLines.flatMap(l => LINE_NAV[l]))`
  de-duplicated, preserving a fixed display order.
- **Import** stays line-scoped exactly as `withLineScopedImports` does today (one
  item per importable assigned line).
- **Specs / assignment items become conditional**: `pkl-specs` only if PKL assigned;
  `ann-specs` only if ANN assigned; `crs-assignment` only if CRS assigned;
  `order-assignment` only if a line that does assignment (RWD/CRM) is assigned;
  `machine-specs` only for CRM mills.

### 1.2 Refactor `MachineHeadNav.tsx`
- Keep the existing specialised branches (ANN/RWD/HRS/PKL/combined) **unchanged** —
  they already produce the correct list and carry the toggle logic.
- Replace *only* the final fallback (`MachineHeadNav.tsx:405-410`, the `role ? withLineScopedImports(ALL_NAV_ITEMS,…)` branch) with the registry-driven union.
- Supervisor branch (`SUPERVISOR_NAV_IDS` filter) is untouched.
- `MachineHeadShell.tsx` line switcher already lists `machines` and routes per
  desk; extend its `<select>`/routing map so CRS/CTL/mixed pick a sensible live
  landing (default `/live`) — no new desk types required.

### 1.3 CRS/CTL note
Per your answer, we are **not** building dedicated CRS/CTL desks in this pass — we
are gating the generic menu so a CRS/CTL head sees a clean, relevant subset. (Their
capture bodies still fall back to the CRM handover form; that pre-existing issue is
documented and out of scope here.)

### 1.4 Tests / non-regression
- Unit tests for `mhLineCapabilities` union: single line, mixed pair, CRS-only,
  CTL-only, CRM+HRS → asserts item id set.
- Snapshot/RTL test of `MachineHeadNav` for each of: ANN, RWD, HRS, PKL, HRS+PKL
  (unchanged), plus new cases CRS-only, CTL-only, HRS+ANN.
- Manual: confirm ANN/RWD/HRS/PKL desks render byte-identical nav to today.

---

## Task 2 — Planning-Lite account (new `PLANNER` role)

**Goal:** a one-time, minimal account that can *only* import plans for the lines it's
scoped to (all lines: HRS, PKL, ANN, RWD, CTL, and CRM/Rolling + Skin Pass). It must
not reach any operator/MH/plant/admin screen or any mutation other than plan import.

### 2.1 Add the role (additive, isolated)
- `shared-validation/src/types/roles.ts`: add `PLANNER = 'PLANNER'`; give it
  `ROLE_RANK[PLANNER] = 0` (so it inherits **nothing** by rank — capability-scoped
  like SUPERVISOR); add `ROLE_LABELS[PLANNER] = 'Planning'`.
- Migration `19xx…_add_planner_role.js` (copy `1933000000000_reintroduce_supervisor_role.js`):
  idempotent insert of `security.role('PLANNER')`; `down()` removes it. No changes to
  existing rows.
- `UserService.isStaffRole()` (`UserService.ts:37`): add `'PLANNER'` so it's treated
  as a staff/email login (Planning-Lite signs in with email + password like SUPERVISOR).

### 2.2 Server — allow PLANNER on import routes *only*
- `routes/sixHiRoutes.ts` — add `UserRole.PLANNER` to the `requireRole([...])` on the
  three PPC endpoints only: `/import/ppc/preview` (`:180`), `/import/ppc/preview/:sessionId/machines` (`:211`), `/import/ppc/preview/:sessionId/commit` (`:233`).
  Do **not** add it to `/orders/transfer-machine` or any capture route.
- `routes/importRoutes.ts` — add `UserRole.PLANNER` to the `requireRole` on `POST /`
  and the batch read routes (CSV plan path), leaving everything else as-is.
- Everything PLANNER is *not* explicitly granted stays denied by default (all other
  routers keep their existing `requireRole`/`m1Guard`).

### 2.3 Server — the `assertLineOperation` WRITE-gate nuance (important)
The preview/commit handlers call `assertLineOperation(user, lineScope, 'WRITE')`, whose
WRITE branch today only permits OPERATOR/MACHINE_HEAD (`lineAccessPolicy.ts:96-107`).
Two options — **recommended: Option A** (narrow, no blast radius):

- **Option A (chosen): dedicated import authorizer.** Add
  `assertPlanImportAccess(user, line)` in a new `auth/planImportPolicy.ts`: allows
  ADMIN, or MACHINE_HEAD/SUPERVISOR with a line scope, or **PLANNER** with a matching
  line scope. Call it in the two handlers *instead of/in addition to* the existing
  `assertLineOperation` when the actor is PLANNER. This keeps `assertLineOperation`
  (used across many production paths) completely untouched.
- Option B (rejected): add PLANNER to `canWriteRole` in `assertLineOperation` — simpler
  but widens line-WRITE meaning for every caller; higher regression risk.

### 2.4 Server — extend line coverage to "all lines"
- `PPCImportService.parseImportLineScope()` (`:81-85`): add `'CTL'` to the accepted
  set so CTL plans are line-scoped like the others. Add a `CTL` entry to the
  process-map (`LINE_ROUTE`/config near `:75-78`) mirroring HRS/PKL.
- **CRM / ROLLING / SKIN_PASS:** these import *without* a line scope (machine is chosen
  during preview), so no `assertLineOperation` runs — PLANNER just needs the
  `requireRole` grant from §2.2. Confirm PLANNER can reach `previewRollingXlsx` with
  `sheetType=ROLLING|SKIN_PASS` and that machine-allocation preview still works.
- Net: PLANNER covers HRS, PKL, ANN, RWD, CTL (line-scoped) + CRM Rolling/Skin-Pass
  (machine-scoped).

### 2.5 Client — a pure Planning-Lite import hub
- New landing `pages/planning/PlanningImportHub.tsx`: a minimal shell (no MH nav) with
  one tab/selector per importable sheet type, each rendering the existing
  `PpcRollingImportPanel` with the right `lockedSheetType`/`line`. Reuse — do not fork.
- `lib/roleHome.ts` `getRoleHomePath()`: add `case 'PLANNER': return '/planning/import'`.
- Routing (`App`/router table): register `/planning/import` behind
  `RoleRoute minRole={PLANNER} allow={[UserRole.PLANNER]}` (or a thin `PlannerRoute`
  wrapper). PLANNER must **not** be added to any MH/Plant/Admin `allow[]` list.
- `RoleHomeRedirect` already routes by `getRoleHomePath`, so PLANNER lands on the hub.
- Optional: hide global chrome (top nav, role switcher) for PLANNER so the account is
  visually "import only".

### 2.6 The one-time account itself
- New seed script `scripts/seed-planner.mjs` (mirror `seed-supervisor.mjs`): create a
  single user `planning@zedral.local` with role `PLANNER`, **no machineAccess**, and
  `lineAccess = [HRS, PKL, ANN, RWD, CTL]` at WRITE level (CRM needs no line scope).
  Add `"seed:planner"` to `packages/server/package.json`. Idempotent (upsert by email).
- This is the "one-time acc" — created once via the seed (or via Admin → Users, which
  already supports role + lineAccess through `UserService`).

### 2.7 Non-regression guarantees for Task 2
- PLANNER appears in exactly: `roles.ts`, one migration, `isStaffRole`, three
  `requireRole` lists, one new `planImportPolicy`, `parseImportLineScope` (CTL),
  `roleHome`, one route, one page, one seed. Nothing else.
- Existing operator/MH/CRM flows: unchanged (no shared function edited except the
  additive `requireRole` lists and `parseImportLineScope` CTL addition).

---

## Task 3 — Production-ready audit (scoped to these two changes)

Run after Tasks 1–2 land. This is a *delta* audit; platform-wide findings from the
enterprise-readiness assessment are tracked separately.

**Authorization / least-privilege**
- [x] Enumerate every route and confirm PLANNER is authorized on **only** the PPC/CSV
      import endpoints. Add a negative test: PLANNER → 403 on capture, handover,
      order-assignment, admin, reports, exports.
      *(Automated via `plannerRole.test.ts` allowlist/denylist mirrors; live HTTP 403 not run.)*
- [x] PLANNER cannot import a line outside its `lineAccess` (line-scope test: scoped to
      HRS, attempt PKL/CTL → 403 via `assertPlanImportAccess`).
      *(`planImportPolicy.test.ts`)*
- [x] PLANNER cannot escalate: `ROLE_RANK[PLANNER]=0`, no `allow[]` membership beyond
      the import route; `RoleRoute` denies MH/Plant/Admin pages.
      *(`/planning/import` uses `minRole=ADMIN` + `allow=[PLANNER]` only.)*
- [x] `denyPlantHeadPpc` still applies (PLANNER ≠ PLANT_HEAD; PH still blocked).

**Data-integrity / import fail-safe (reuse existing dedup invariants)**
- [ ] Re-import regression per `ZEDRAL_IMPORT_FAILSAFE_AND_DEDUP_PLAN.md`: HRS complete
      → advance PKL → PLANNER re-imports PKL → **no duplicate** (journey-aware skip).
      *(Existing `importFailsafeDedup` suite covers path; PLANNER uses same service.)*
- [ ] CTL now line-scoped: confirm CTL preview classifies new/already-in-line/advanced
      correctly and commit is idempotent.
- [ ] CRM Rolling/Skin-Pass import via PLANNER produces identical batches to the
      ADMIN/SUPERVISOR path (no divergent code path).
      *(Same `PPCImportService` + `requireRole` only — no fork.)*

**Task-1 correctness**
- [x] Nav union snapshot tests pass; ANN/RWD/HRS/PKL/HRS+PKL desks unchanged.
      *(`mhLineCapabilities.test.ts` — 7 passed.)*
- [x] CRS-only / CTL-only / mixed heads show only relevant items (no PKL/ANN Specs or
      CRS Assignment leakage).

**Build / arch gates**
- [ ] `npm run build` green across the workspace chain.
- [ ] `npm run arch:check` (dependency-cruiser + arch tests) green — new files respect
      layer boundaries (client `lib` has no server import; `planImportPolicy` in server
      auth layer).
- [ ] Migration up/down tested; `down()` cleanly removes PLANNER.
- [x] `npm audit` delta = 0 new vulns (no new deps introduced).

**Ops**
- [x] Seed script idempotent; document the Planning-Lite credential handoff.
      *`npm run seed:planner` → `planning@zedral.local` / `SEED_STAFF_PASSWORD` (default `Password123!`).*
- [ ] Audit-log check: PLANNER import actions appear in the audit module with role +
      line.

---

## Sequencing & build gates

1. **Task 1** (client-only, zero backend risk) → build `@m1/client` → nav tests.
2. **Task 2a** role plumbing: `roles.ts` + migration + `isStaffRole` → build
   `@m1/shared-validation` → `@m1/server`.
3. **Task 2b** server import grants + `planImportPolicy` + CTL scope → build `@m1/server`
   → route auth tests.
4. **Task 2c** client hub + routing + roleHome → build `@m1/client`.
5. **Task 2d** seed script + create the one-time account.
6. **Task 3** full delta audit + regression suite.

Build gate after each: `@m1/shared-validation → @zedral/platform → @m1/server → @m1/client`.

## Risk register / open items
- **R1 (low):** `assertLineOperation` reuse vs. dedicated authorizer — Option A chosen
  to avoid widening production WRITE semantics. Confirm no other caller expects PLANNER.
- **R2 (low):** CRM import has no line scope — PLANNER relies on `requireRole` alone
  there; verify machine-allocation preview (`/preview/:sessionId/machines`) is safe for
  a non-MH actor (it edits only the in-memory preview session, not production).
- **R3 (info):** Windows UTF-16 hazard when editing `.ts` — see
  `zedral-windows-utf16-editing`; keep edits UTF-8.
- **OQ:** Should PLANNER be single-tenant only for now? (Recommend yes for the pilot.)
- **OQ:** Should the hub expose CRM machine-reassignment during preview, or import-only
  (recommend import-only to keep the account "pure")?
