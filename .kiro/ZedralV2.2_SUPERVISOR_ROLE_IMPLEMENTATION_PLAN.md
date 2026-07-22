# ZedralV2.2 — Single Supervisor Account: Implementation Plan

_Goal: introduce **one clean, capability-scoped `SUPERVISOR` account** with access to exactly four features — Live dashboards (machine status), Order import, Traceability, and Order assignment — built fresh, without reviving the old rank-folded Supervisor role._

---

## 0. The core design decision (read this first)

The **old** Supervisor was deleted and folded into Machine Head. Two pieces of that still live in the code and are the source of "confusion with the old version" — they must be handled deliberately:

1. `packages/shared-validation/src/types/roles.ts` → `normalizeRoleName()` rewrites `'SUPERVISOR' → MACHINE_HEAD`. **If we don't remove this, any new Supervisor login silently becomes a Machine Head.**
2. Migration `1913000000000_remove_supervisor_role.js` **DELETEd the `security.role` row** for `SUPERVISOR` and reassigned its users to `MACHINE_HEAD`.

**Design principle:** define the new Supervisor by an **explicit capability allowlist for exactly 4 features**, *not* by rank inheritance. This matters because:
- Server guards are already allowlist-based (`requireRole([...])`) → adding `SUPERVISOR` to 4 allowlists grants exactly those 4, nothing leaks.
- The client guard (`RoleRoute`) is **rank-based** (`userRank >= minRole`). If we gave Supervisor a rank ≥ Machine Head, it would inherit *every* Machine-Head-gated page, not just our 4. So Supervisor gets a **low rank** + an **explicit `allow` escape** on only the 4 routes.

Net: **Supervisor is a peer role with a hand-picked capability set, not a tier in the hierarchy.**

---

## 1. Scope of the Supervisor account

| Capability | Server today | Client today | Supervisor gets |
|-----------|--------------|--------------|-----------------|
| **Live dashboards / machine status** | `liveRoutes` = `[MACHINE_HEAD, PLANT_HEAD, ADMIN]` | `/live`, `/machine-head-dashboard` via `MachineHeadRoute` | **READ, all lines** |
| **Order import** | `importRoutes` = `[ADMIN]`; 6HI PPC import = `[ADMIN, MACHINE_HEAD]` | `/import/rolling` via `MachineHeadRoute` | **Import + preview + commit** |
| **Traceability** | `traceabilityRoutes` = `[PLANT_HEAD, MACHINE_HEAD, ADMIN]` | `/machine-head/traceability` via `MachineHeadRoute` | **READ/search, all lines** |
| **Order assignment** | `/order-assignment` = `[MACHINE_HEAD, PLANT_HEAD, ADMIN]`; `/orders/:batchNo/allocate-machine` = `requireSixHi('WRITE')`; `/orders/transfer-machine` = `[ADMIN, MACHINE_HEAD]` | `/order-assignment` via `MachineHeadRoute` | **Assign / allocate / transfer** |

**Explicitly NOT granted:** operator shift capture, admin master-data, user management, validation-rule config, exports admin, PPC delete, etc. Supervisor is oversight + these four operational levers only.

**Line scope:** all lines/mills (single oversight account, like Plant Head's read reach) — via *implicit all-machine* access rather than per-line assignment.

---

## 2. Workstream A — Shared role model (`packages/shared-validation`)

File: `src/types/roles.ts`

1. Add to the enum:
   ```ts
   export enum UserRole {
     OPERATOR = 'OPERATOR',
     SUPERVISOR = 'SUPERVISOR',   // new — capability-scoped oversight
     MACHINE_HEAD = 'MACHINE_HEAD',
     PLANT_HEAD = 'PLANT_HEAD',
     ADMIN = 'ADMIN',
   }
   ```
2. `ROLE_RANK`: give it a **low rank so it does NOT inherit MH/Plant/Admin pages**. Rank is only used for `pickPrimaryRole` and the client `RoleRoute` inheritance check — Supervisor's real access comes from allowlists, so a low rank is correct:
   ```ts
   [UserRole.OPERATOR]: 0,
   [UserRole.SUPERVISOR]: 0,   // peer, not a tier; gated by explicit allow-lists
   [UserRole.MACHINE_HEAD]: 1,
   [UserRole.PLANT_HEAD]: 2,
   [UserRole.ADMIN]: 3,
   ```
3. `ROLE_LABELS`: add `[UserRole.SUPERVISOR]: 'Supervisor'`.
4. **Remove the legacy fold** in `normalizeRoleName()` — delete the `if (upper === 'SUPERVISOR') return UserRole.MACHINE_HEAD;` line so `SUPERVISOR` resolves to itself.

> ⚠️ Because migration `1913` already moved every old supervisor user to Machine Head, removing the fold is safe — there are no lingering `SUPERVISOR` users to accidentally re-empower. Confirm with a quick `SELECT` before deploy (§7).

Rebuild `@m1/shared-validation` (it's consumed by both client and server; `npm run build -w @m1/shared-validation`).

---

## 3. Workstream B — Server authorization (`packages/server`)

Add `UserRole.SUPERVISOR` to the allowlists on **exactly** the four feature groups. `requireRole` already lets ADMIN through and does a set-intersection, so these edits are surgical.

1. **Live** — `src/routes/liveRoutes.ts` (the `router.use(requireRole([...]))` block): add `UserRole.SUPERVISOR`.
2. **Traceability** — `src/routes/traceabilityRoutes.ts` `GET /` and `GET /suggest`: add `UserRole.SUPERVISOR`.
3. **Import** — `src/routes/importRoutes.ts` (POST import, `/:batchId`, `/:batchId/error-rows`): add `UserRole.SUPERVISOR`. Also in `src/routes/sixHiRoutes.ts` the PPC import chain: `/import/ppc`, `/import/ppc/preview`, `/import/ppc/preview/:sessionId/machines`, `/import/ppc/preview/:sessionId/commit` → add `SUPERVISOR` to each `requireRole([...])`.
4. **Assignment** — `src/routes/sixHiRoutes.ts`:
   - `/order-assignment` (`requireRole([MACHINE_HEAD, PLANT_HEAD, ADMIN])`) → add `SUPERVISOR`.
   - `/orders/transfer-machine` (`requireRole([ADMIN, MACHINE_HEAD])`) → add `SUPERVISOR`.
   - `/orders/:batchNo/allocate-machine` uses **`requireSixHi('WRITE')`** (= `requireCrmMill`, a *mill-scope* guard, not a role list). To grant assignment **without** also granting every other `requireSixHi('WRITE')` master-data route, do **not** blanket-grant mill WRITE. Instead, either (a) add an explicit `requireRole([...SUPERVISOR])` in front of the allocate handler, or (b) extend `requireCrmMill` so `SUPERVISOR` is authorized for allocation specifically. Prefer (a) for a tight blast radius.

5. **Machine/line scope** — Supervisor needs to *see* all mills for the live + assignment reads:
   - `src/auth/machineAccessPolicy.ts` and `src/auth/lineAccessPolicy.ts`: treat `SUPERVISOR` like `PLANT_HEAD` for **READ across all lines** (add it to the "implicit all, read" branches). Do **not** add it to write-all branches — assignment writes are granted per-endpoint in step 4.
   - This lets mill-scoped read handlers (`requireSixHi('READ')`, live views) resolve for a Supervisor with no per-line assignment rows.

**Guard test to keep it honest:** Supervisor must be *denied* on a sample of out-of-scope routes (operator capture POST, `/admin/*` master-data, user routes, validation-rules). Add these negative cases to `tests/auth/lineAccessPolicy.test.ts` / `platform-config-authz.test.ts`.

---

## 4. Workstream C — Database (`packages/server/migrations`)

New migration `19xxxxxxxxxxx_reintroduce_supervisor_role.js` (forward-only, the inverse of `1913`):

```sql
-- up
INSERT INTO security.role (role_id, role_name, description)
VALUES (gen_random_uuid(), 'SUPERVISOR', 'Oversight: live dashboards, import, traceability, assignment')
ON CONFLICT (role_name) DO NOTHING;
```
- No CHECK-constraint/enum work needed — roles are **rows in `security.role`**, so this is a clean insert (verified against migration `1913`, which DELETEd the row).
- Do **not** auto-reassign the old users back; migration `1913` intentionally moved them to Machine Head. The new Supervisor is a *fresh, single account* (§5).
- `down`: `DELETE FROM security.role WHERE role_name='SUPERVISOR';`

---

## 5. Workstream D — Client (`packages/client`)

1. **Role guard escape** — `src/components/RoleRoute.tsx`: add an optional `allow?: UserRole[]` that ORs with the rank check, so we can grant Supervisor *specific* pages without changing the hierarchy:
   ```tsx
   const passesRank = userRank != null && requiredRank != null && userRank >= requiredRank;
   const passesAllow = allow?.includes(role as UserRole) ?? false;
   if (!passesRank && !passesAllow) return <AccessDenied .../>;
   ```
   Add a convenience wrapper `SupervisorOrAbove` or just pass `allow={[UserRole.SUPERVISOR]}` on the 4 routes.
2. **Gate exactly the 4 pages** in `src/App.tsx` — wrap each with the allow escape:
   - `/live` + `/machine-head-dashboard` (LiveDashboard / MachineHeadDashboard)
   - `/import/rolling` (RollingImportPage)
   - `/machine-head/traceability` (PlantOrderTracking)
   - `/order-assignment` (OrderAssignmentPage) and the nested `order-assignment` panel
   e.g. `<RoleRoute minRole={UserRole.MACHINE_HEAD} allow={[UserRole.SUPERVISOR]}>`.
3. **Landing page** — `src/lib/roleHome.ts`: add `case 'SUPERVISOR': return '/live';` (or a dedicated supervisor overview).
4. **Implicit all-machines** — `src/lib/accessOptions.ts` `hasImplicitAllMachines()`: include `'SUPERVISOR'` so machine-scoped client logic and dashboards show all mills.
5. **Navigation/menu** — show only the 4 features for a Supervisor session; hide capture, admin, user-management, config. (Wherever the sidebar/menu is built from role.)
6. **Admin user form** — `accessOptions.ts` / admin user-management UI: allow selecting `SUPERVISOR` as a role when creating the one account (label "Supervisor").

---

## 6. Workstream E — Auth & seed (SuperTokens)

1. Register `SUPERVISOR` in the auth role system (wherever roles are created for SuperTokens — mirror how `MACHINE_HEAD`/`PLANT_HEAD` are set up).
2. Seed **one** Supervisor account: add to `scripts/seed-login-profiles.mjs` (or a small `seed-supervisor.mjs`) with the badge/PIN or credential flow the other roles use. Wire an npm script `seed:supervisor` if you want it repeatable.
3. Confirm the login/redirect flow (`authSession`, `pickPrimaryRole`) sends a Supervisor to `/live`.

---

## 7. Sequencing, verification & rollout

**Order of work**
1. A (shared role model) → build shared-validation.
2. C (DB migration) + E (auth role + seed).
3. B (server allowlists + scope).
4. D (client guards + nav + landing).
5. Tests, then feature-verify the one account.

**Pre-deploy safety check**
```sql
-- Expect 0 rows; confirms no stale supervisor users before removing the legacy fold
SELECT u.user_id FROM security.user_role ur
JOIN security.role r ON r.role_id = ur.role_id
WHERE r.role_name = 'SUPERVISOR';
```

**Test matrix (must pass)**
- ✅ Supervisor can: load live/machine-status, run an import (preview→commit), search traceability, assign/allocate/transfer an order.
- ⛔ Supervisor is denied: operator capture write, `/admin/*`, user management, validation-rules, exports admin, PPC delete.
- ⛔ A user with **only** the string `SUPERVISOR` no longer resolves to Machine Head anywhere (grep for `normalizeRoleName` callers).
- Regression gate: `npm run test`, `npm run arch:check`, `npm run e2e:smoke` green.

**Rollout**
- Ship behind the normal deploy; the single account is created by seed/admin. Because access is allowlist-scoped, blast radius is limited to the 4 routes.
- Keep the DB `down` migration and the `allow`-list edits easily revertible.

---

## 8. Files touched (checklist)

**shared-validation:** `src/types/roles.ts`
**server:** `routes/liveRoutes.ts`, `routes/traceabilityRoutes.ts`, `routes/importRoutes.ts`, `routes/sixHiRoutes.ts`, `auth/machineAccessPolicy.ts`, `auth/lineAccessPolicy.ts`, new `migrations/19xxxxx_reintroduce_supervisor_role.js`, `scripts/seed-login-profiles.mjs` (+ optional `seed-supervisor.mjs`), auth/SuperTokens role setup
**client:** `components/RoleRoute.tsx`, `App.tsx`, `lib/roleHome.ts`, `lib/accessOptions.ts`, nav/menu component, admin user form
**tests:** `tests/auth/lineAccessPolicy.test.ts`, `tests/platform-config-authz.test.ts`, an e2e for the supervisor journey

---

### Why this won't get tangled with the old version
- The old Supervisor was **rank-folded into Machine Head**; the new one is a **peer role gated by explicit 4-feature allowlists** — a fundamentally different mechanism.
- The single line that caused the old behavior (`normalizeRoleName` fold) is removed, and the DB role is re-created cleanly rather than resurrecting old user assignments.
- Low rank + `allow`-escape guarantees Supervisor gets **exactly** the four features and never silently inherits Machine-Head or Plant-Head screens.
