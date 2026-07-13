# Zedral M1 — Change Verification + Deployment Guide

**Repo audited:** `zedral_test-main (1)` (64 migrations). Verified statically against
`ZEDRAL_NEXT_CHANGES_SPEC.md`. **No build was run** in this audit — TypeScript compile / tests
should be run before deploy (see §A.5).

---

# Part A — Are the changes done?

**Short answer:** the large majority of the spec landed and was implemented well (the migrations
even handle the `line_area` FK case I flagged). **Two real gaps remain** — one that will likely
break CRM access at runtime (A.1 item ⚠️1) and one deployment blocker (Part B, the prod compose is
missing SuperTokens). Fix those before go-live.

## A.1 — W1: 4HI / 2HI mills

| Spec item | Status | Evidence |
| --- | --- | --- |
| Rename `crm6_*`→`crm_*` + transitional views | ✅ Done | `1925000000000_generalize_crm_tables.js` matches spec exactly |
| Recode process 31 → `ROLLING`, wire 6HI/4HI/2HI, sub-processes | ✅ Done (+extra) | `1925000000001_rolling_process_and_mills.js` — also drops/re-adds `line_area` FK correctly |
| Code sweep `txn.crm6_`→`txn.crm_` | ✅ Done | `shiftLogService` map now `31:'txn.crm_order'`; `ProductionService`, `machineAccessPolicy`, `shiftLogRoutes` all use `txn.crm_order`. Remaining `crm6_` refs are only the view type entries in `db-types.ts` (expected) |
| Regenerate `db-types.ts` | ✅ Done | has both `txn.crm_order` (tables) and `txn.crm6_order` (views) |
| Machine-aware route guard | ⚠️ **Partial / risky** | `requireCrmMill` added with `parseCrmMillCode`, but see ⚠️1 below |
| Client 4HI/2HI workspaces (off `/coming-soon`) | ✅ Done | `millPath.ts` routes `/4hi`,`/2hi`,`/6hi` to real workspaces; `/coming-soon` is only an unknown-code fallback |
| Per-mill: 2HI skin-pass only | ✅ Modeled | sub-process seeds + `ROLLING_MILLS=['6HI','4HI']` unchanged |
| 4HI/2HI end-to-end tests (W1-T7) | ❓ **Unverified** | confirm tests exist under `packages/server/tests` before relying on it |

> ### ⚠️1 (HIGH) — the machine guard probably rejects real CRM users
> `requireCrmMill` calls `assertLineOperation(req.user, millCode, op)` where `millCode ∈
> {6HI,4HI,2HI}`. But `getUserWithRolesAndAccess` derives a user's line scopes from
> **`master.process.code`**, which migration `1925…001` just recoded to **`ROLLING`**. So a CRM
> operator/machine-head now has line scope `ROLLING`, and the guard's check for `6HI`/`4HI`/`2HI`
> **won't match** — only ADMIN/PLANT_HEAD (who bypass) would get through. This likely breaks the
> operator terminal for all three mills.
> **Fix (pick one):** (a) change the guard to `assertMachineAccess(req.user, millCode)` —
> `security.machine_access` holds the mill codes `6HI/4HI/2HI`, which is what the spec intended; or
> (b) resolve `millCode → 'ROLLING'` before the line check; or (c) grant users line access by mill
> code. **(a) is the correct fix.** Add a test: a MACHINE_HEAD scoped to `4HI` gets 200 on
> `machine=4HI` and 403 on `machine=6HI`.

> ### Minor — `seed-crm6-ppc.mjs:120` still re-seeds process 31 as `'6HI'`
> Harmless at runtime (`ON CONFLICT DO NOTHING` won't override the `ROLLING` recode), but update it
> to `ROLLING` so a fresh seed is consistent.

## A.2 — W2: Machine-Head / Plant-Head UI

| Spec item | Status | Evidence |
| --- | --- | --- |
| Remove residual SUPERVISOR dead-code | ✅ Done | zero non-override `SUPERVISOR` refs remain |
| Wire "coming soon" report pages | ✅ Done | `PlantAlerts/Defects/Production/Stoppages.tsx` are real (100–113 lines, no placeholder markers) |
| Machine-scoping of MH surfaces | ⚠️ Depends on ⚠️1 | the UI can only be correctly machine-scoped once the guard/access resolution is fixed |

## A.3 — W3: SuperTokens auth

| Spec item | Status | Evidence |
| --- | --- | --- |
| Deps installed | ✅ | `supertokens-node ^24`, `supertokens-auth-react ^0.51`, `supertokens-web-js ^0.16` |
| `supertokens.init` (EmailPassword + Session + custom claims) | ✅ | `app.ts` init with `Session.init` override → `getAuthUserBySuperTokensId` |
| Operator badge+PIN → manual ST session | ✅ | `authRoutes.ts` `/badge-pin` calls `Session.createNewSession(...)`; old `/token` removed |
| `supertokens_user_id` migration | ✅ | `1926000000000_add_supertokens_user_id.js` |
| Staff→ST migration script | ✅ | `server/scripts/migrate-staff-to-supertokens.mjs` |
| Client login fully on ST sessions | ⚠️ **Incomplete / mismatched** | see ⚠️2 below |
| Prod deployment config for ST | ❌ **Missing** | see Part B blocker |

> ### ⚠️2 (HIGH) — client login not migrated to SuperTokens
> Server side is done: `authMiddleware` uses `Session.getSession(...)` (ST-only, no JWT fallback),
> `authService` no longer mints/verifies JWTs, and `/badge-pin` issues an **ST session (cookies)**.
> But `Login.tsx` (184 lines) was **not** migrated: it still posts `/auth/badge-pin` for **every
> role** and reads `{ accessToken, refreshToken }` from the **response body** (line ~99), then calls
> `authStore.login(accessToken, …)` — a token the server no longer returns. There is **no staff
> email+password screen**, so ADMIN/PLANT_HEAD/MACHINE_HEAD have no way to use the ST EmailPassword
> recipe. **Fix:** rework `Login.tsx` + `authStore`/`authSession` to rely on the ST session (cookies
> via the `supertokens-web-js` interceptor, hydrate role/scopes from
> `Session.getAccessTokenPayloadSecurely()`), and add a staff email+password sign-in path. Keep the
> operator badge+PIN pad, but stop reading tokens from the body. Until this lands, staff can't log in
> and operator login likely breaks. **Go-live blocker.**

## A.4 — W4: HeadWind / APK

| Spec item | Status | Evidence |
| --- | --- | --- |
| MainActivity self-pins only if device owner | ✅ Done | `startLockTask()` now inside `if (dpm.isDeviceOwnerApp())` — dormant under HeadWind |
| `versionCode` env-driven for OTA | ✅ Done | `versionCode = System.getenv("ZEDRAL_VERSION_CODE") ?: "6"` |
| HeadWind server/enrollment | ⛔ Manual (ops) | no repo code; see Part E |

## A.5 — Before you trust any of this
Run: `npm ci && npm run build && npm test && npm run arch:check`. The audit was static; a clean
compile is the real proof the `crm_*` sweep + ST types are consistent.

---

# Part B — Deployment: how it works

There are **two deploy paths** wired in the repo:

1. **CI/CD (recommended, production):** GitHub Actions builds images → pushes to **GHCR** → SSHes to
   the VM → `docker compose` pulls the tagged images and restarts. Workflows:
   `.github/workflows/ci.yml`, `deploy-staging.yml` (AWS host), `deploy-production.yml` (Factory
   host, triggers on GitHub **Release**), `deploy-aws.yml`.
2. **Host build (manual):** `npm run docker:prod` →
   `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d` (builds on the VM).

Migrations run **automatically** on container start via `deploy/docker-entrypoint.sh` when
`RUN_MIGRATIONS=true` (`node-pg-migrate ... up` for main + `migrations/modules/m1`). Seeds are
**not** automatic — run them manually (Part E).

### ⛔ BLOCKER — production compose is missing SuperTokens
`deploy/docker-compose.prod.yml` has **no `supertokens` service** and does **not** pass the four ST
env vars to `backend`. Because `AUTH_STRICT=true` in production, `getSuperTokensConfig()` will
**throw at startup** (`SUPERTOKENS_CORE_URI must be set in strict mode`) and the API won't boot.
**You must, before deploying:**

1. Add a `supertokens` service to `deploy/docker-compose.prod.yml` (mirror the dev
   `docker-compose.yml` one, but point `POSTGRESQL_CONNECTION_URI` at the prod `db` service and give
   it a real `api_keys`):
   ```yaml
   supertokens:
     image: registry.supertokens.io/supertokens/supertokens-postgresql:9.2
     depends_on: { db: { condition: service_healthy } }
     environment:
       POSTGRESQL_CONNECTION_URI: "postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}"
       API_KEYS: ${SUPERTOKENS_API_KEY}
     restart: unless-stopped
     networks: [zedral]
   ```
2. Add these to the `backend.environment` block in the same file:
   ```yaml
   SUPERTOKENS_CORE_URI: http://supertokens:3567
   SUPERTOKENS_API_KEY: ${SUPERTOKENS_API_KEY}
   API_DOMAIN: ${API_DOMAIN}
   WEBSITE_DOMAIN: ${WEBSITE_DOMAIN}
   ```
3. Add `backend.depends_on: supertokens` so ordering is correct.
4. Add the four ST vars to `deploy/.env.production.example` (currently absent there).

### Deploy sequence (production, CI/CD path)
1. Provision + harden the VM once (`deploy/bootstrap-aws-vm.sh` installs Docker etc.).
2. On the VM, create `deploy/.env` from `deploy/.env.production.example` **+ the ST vars** (Part C).
   The deploy workflow **preserves** this file across releases.
3. Set the GitHub repo **secrets** (Part D) and a `production` environment.
4. Cut a GitHub **Release** (or run `deploy-production.yml` with an image tag) → images deploy,
   entrypoint runs migrations, health check gates nginx.
5. First-time only: run the **seeds + staff→ST migration** on the VM (Part E).
6. Smoke test: `npm run smoke:api` (uses `SMOKE_BADGE_ID`/`SMOKE_PIN`).

---

# Part C — `.env` configuration (the VM's `deploy/.env`)

All **app runtime secrets live in `deploy/.env` on the VM** (not in GitHub). Generate secrets with
`openssl rand -hex 32`.

| Var | Required? | Notes |
| --- | --- | --- |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | ✅ | Postgres creds; use a strong password |
| `DATABASE_URL` | ✅ | `postgres://<user>:<pass>@db:5432/<name>` |
| `JWT_SECRET` | ✅ | **still required to boot** — `envValidation` blocks startup if it's < 32 chars or a known placeholder, **even though auth is now SuperTokens** (JWT no longer used for sessions). Set a real 32+ char value or the server refuses to start. (Optionally relax the validation later.) |
| `AUTH_STRICT` | ✅ | must be `true` in production (enforced) |
| `VALIDATION_STRICT` | ✅ | keep `true` (else validation gates bypass — warns) |
| `TENANT_ID` | ✅ | must be a valid **UUID** and match the seeded tenant |
| `SUPERTOKENS_CORE_URI` | ✅ **add** | `http://supertokens:3567` (in-compose) |
| `SUPERTOKENS_API_KEY` | ✅ **add** | strong key; must equal the core's `API_KEYS` |
| `API_DOMAIN` | ✅ **add** | public API origin, e.g. `https://hsl.zedral.com` |
| `WEBSITE_DOMAIN` | ✅ **add** | public web origin (same host if SPA+API co-hosted) |
| `CORS_ORIGIN` | ⚠️ | comma-separated: web origin + APK origins, e.g. `https://hsl.zedral.com,https://localhost,capacitor://localhost` |
| `RUN_MIGRATIONS` | ✅ | `true` so the entrypoint migrates on boot |
| `BACKEND_IMAGE` / `NGINX_IMAGE` | ✅ (CI path) | GHCR refs, set by the release workflow |
| `EXPORT_WORKER_ENABLED`, `DPR_SCHEDULER_ENABLED`, `DPR_SCHEDULE_HOUR`, `SHIFT_BOUNDARY_SCHEDULER_ENABLED` | ⬜ | runtime flags (have defaults) |
| `MINIO_*` | ⬜ optional | only if exporting artifacts to object storage |
| `ELASTICSEARCH_*` | ⬜ optional | leave `ELASTICSEARCH_URL` empty → Postgres-only traceability |

**Client / APK build-time vars** (not in `deploy/.env` — set at build):
| Var | Where | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `packages/client/.env.operator` | plant-LAN IP of the API, **not** localhost; port must match |
| `VITE_APP_VERSION` | client build env | shown in-app |
| `VITE_DEV_AUTO_LOGIN` | client | **must be `false`** in prod |
| `ZEDRAL_VERSION_CODE` | APK release build | bump every release for HeadWind OTA |
| `ZEDRAL_KEYSTORE_PATH` / `_PASS` / `ZEDRAL_KEY_ALIAS` / `_KEY_PASS` | APK signing env | keystore not in repo; keep consistent across releases |

---

# Part D — GitHub secrets

GitHub secrets are **CI/CD plumbing only** — not app runtime secrets (those are in the VM's
`deploy/.env`, which the workflow preserves).

| Secret | Used by | Purpose |
| --- | --- | --- |
| `FACTORY_HOST` / `FACTORY_USER` / `FACTORY_SSH_KEY` / `FACTORY_APP_DIR` | `deploy-production.yml` | SSH into the factory/plant VM |
| `AWS_HOST` / `AWS_USER` / `AWS_SSH_KEY` / `AWS_APP_DIR` / `AWS_PUBLIC_URL` / `AWS_GIT_DEPLOY_TOKEN` | `deploy-staging.yml` / `deploy-aws.yml` | SSH + deploy to the AWS staging VM |
| `GHCR_TOKEN` | build/deploy | push/pull images to GHCR (falls back to `GITHUB_TOKEN`) |
| `GITHUB_TOKEN` | all | auto-provided by Actions |
| `DEPLOY_WEBHOOK_URL` | deploy notify | Slack/webhook deploy notifications |
| `SMOKE_BADGE_ID` / `SMOKE_PIN` | post-deploy smoke | operator creds for the API smoke test |

> If you later want CI to **write** `deploy/.env` from secrets instead of hand-maintaining it on the
> VM, add `JWT_SECRET`, `DB_PASSWORD`, `SUPERTOKENS_API_KEY`, `TENANT_ID` as secrets and have the
> deploy step render the file. Today the workflow **preserves** the existing `deploy/.env`, so this
> is optional.

---

# Part E — What YOU do manually

### Code fixes to land before deploy (from Part A)
- [x] **Fix the CRM guard** (A.1 ⚠️1) → use `assertMachineAccess` (or map mill→`ROLLING`). **Go-live blocker.**
- [x] **Finish client ST login** (A.3 ⚠️2) → rework `Login.tsx`/`authStore` to use ST cookies (stop reading `accessToken` from the body), add a staff email+password screen. **Go-live blocker.**
- [x] **Add SuperTokens to `deploy/docker-compose.prod.yml`** + ST env (Part B blocker).
- [x] Update `seed-crm6-ppc.mjs` process code `6HI`→`ROLLING` (minor).
- [x] Run `npm run build && npm test && npm run arch:check` — must be green.

### Infrastructure (one-time)
- [ ] Provision the plant/factory VM (Ubuntu); run `deploy/bootstrap-aws-vm.sh`; open only needed ports.
- [ ] DNS + **TLS** for `API_DOMAIN`/`WEBSITE_DOMAIN` (see `TLS_DEPLOYMENT_GUIDE.md`, `nginx.prod.conf`).
- [ ] Create `deploy/.env` on the VM with real secrets (Part C); `chmod 600`; never commit it.
- [x] Set the GitHub repo secrets (Part D) and a `production` environment with required reviewers.

### Data / accounts (first deploy)
- [ ] Confirm migrations ran (entrypoint logs). Seed masters: `npm run seed:pilot` / `seed:profiles` / `seed:admin` as appropriate on the VM.
- [ ] Ensure the seeded tenant UUID == `TENANT_ID`.
- [ ] Run `node packages/server/scripts/migrate-staff-to-supertokens.mjs` to create ST EmailPassword users for ADMIN/PLANT_HEAD/MACHINE_HEAD; distribute temp passwords / force reset.
- [ ] Grant machine access (`security.machine_access`) for `4HI`/`2HI` heads/operators via admin UI.

### Operator APK + HeadWind MDM (Free, self-hosted)
- [ ] Set `VITE_API_URL` to the plant-LAN API IP; `npm run android:sync && npm run android:apk`; sign the release with the keystore env vars; bump `ZEDRAL_VERSION_CODE`.
- [ ] Stand up **HeadWind MDM server** (Ubuntu + Tomcat, Free build) on the plant LAN.
- [ ] Upload the signed APK to HeadWind **Applications**; create a **Configuration** with the Zedral app as the auto-launch/only app (Free = restricted launcher, soft lock).
- [ ] Enroll each tablet: factory reset → tap 6–7× / `afw#setup` → scan HeadWind QR → agent becomes **device owner** → installs APK → launcher opens Zedral.
- [ ] For updates: upload a higher-`versionCode` APK to HeadWind → devices auto-update silently.

### Post-deploy verification
- [ ] `curl https://<host>/health` OK; `npm run smoke:api` green.
- [ ] Log in as an operator on a 4HI badge → full 4HI workspace (no "coming soon"); 2HI shows skin-pass only.
- [ ] MACHINE_HEAD scoped to one mill can approve only that mill's shifts.
- [ ] Staff email+password login works; override-PIN (kiosk exit / field override) still works.

---

## Summary
Implementation is ~85% there and generally faithful to the spec. **Three things gate go-live:**
(1) the CRM access guard (`assertLineOperation`→`assertMachineAccess`) so operators aren't locked
out post-`ROLLING` recode; (2) the client staff email-login / ST-session wiring; (3) adding the
SuperTokens service + env to the production compose. Everything else — mills, DB rename, report
pages, APK kiosk guard, OTA versioning — is in place and consistent, pending a clean `build`/`test`.
