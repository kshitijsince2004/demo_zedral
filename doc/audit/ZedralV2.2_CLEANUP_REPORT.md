# ZedralV2.2 — Codebase Cleanup & Removal Report

_Analysis date: 2026-07-21. Based on the uploaded `ZedralV2.2_new.zip`._

## How this was analyzed

- Extracted the full repo (excluding `node_modules` / `.git` from the source graph).
- Built a **static import graph** across the whole monorepo (`packages/{client,server,platform,connectors,shared-validation,modules}`), resolving relative imports **and** the workspace path aliases (`@m1/shared-validation`, `@zedral/*`) from `tsconfig.base.json` and the Vite alias.
- Ran reachability from real entry points (`main.tsx`, `operator/main.tsx`, each package `index.ts`, `app.ts`, migrations, scripts, tests, config files) → anything unreachable is a dead-file candidate.
- **Every dead candidate was re-verified** with a repo-wide grep for its symbol/basename to eliminate false positives from dynamic/string references.
- Cross-checked client `/api/*` calls against server route mounts (via `app.ts`, Vite proxy, nginx).
- Content-hashed all text files to find exact duplicates.

**Bottom line: removals below do not affect runtime behavior.** Everything in the "Safe to delete" sections is either unreferenced source, generated output, crash junk, or duplicated archives. Nothing on a live import path is touched.

---

## TL;DR — biggest wins

| # | What | Size | Category |
|---|------|------|----------|
| 1 | `packages/client/android/app/build` + `.gradle` + `build` (generated) | **~275 MB** | Build output |
| 2 | `doc/audit/ZEDRAL_CENTRAL/` (nested self-duplicate + committed `.zip`s + apk) | **58 MB** | Duplicate/archive bloat |
| 3 | `packages/client/android.rar` (a whole zip of the `android/` folder) | **20 MB** | Duplicate archive |
| 4 | 31 JVM crash dumps `hs_err_pid*.log` / `replay_pid*.log` + `debug.log` | **~22 MB** | Crash junk |
| 5 | 21 dead source files in `packages/client` + `packages/server` | small | Dead code |
| 6 | 35 macOS junk items (`__MACOSX/`, `._*`, `.DS_Store`) | small | OS junk |

> Note: most of the junk (logs, apk, rar, dist, `.env`) is **already matched by `.gitignore`**, meaning it is likely untracked cruft that got swept into the zip rather than committed history. Clean it from the working tree; where it *is* committed (see §7), use `git rm --cached`.

---

## 1. Dead source code — safe to delete (verified 0 references)

These files are never imported anywhere in the reachable graph, and a repo-wide symbol grep confirmed zero real usages.

### Client (`packages/client/src/`) — 19 files
```
components/analytics/AnalyticsMetric.tsx
components/dpr/SourceMapReview.tsx
components/dpr/TemplateImport.tsx
components/dpr/index.tsx
components/forms/CrewSubForm.tsx            ← dead cluster (see below)
components/layout/operator/WorkspaceLayout.tsx
components/live/HandoverOverviewPanel.tsx
components/sixHi/FloatingControls.tsx
components/sixHi/OrderStoppagePanel.tsx
components/sixHi/OrderStoppageTable.tsx
components/sixHi/ProductionActionBar.tsx
components/sixHi/ProductionHeader.tsx
components/sixHi/RollChangePanel.tsx
components/ui/PulseDot.tsx
components/ui/StatusIndicator.tsx
hooks/useEffectiveRuleset.ts
hooks/useNumericCapture.ts                  ← dead cluster
hooks/useGloveModeClasses.ts                ← dead cluster
store/syncQueue.ts
```
**Dead cluster:** `CrewSubForm.tsx` → imports `useNumericCapture.ts` → imports `useGloveModeClasses.ts`. None of the three is reachable from any live page, so the whole island is safe to remove together. (`useGloveModeClasses` *looks* used by a grep, but its only importers are the other two dead files.)

### Server (`packages/server/src/`) — 2 files
```
db/withTenant.ts       (unused helper)
utils/logger.ts        (unused; server logs via platform structuredLog)
```

### ⚠️ Do NOT delete (looked orphan, but isn't)
- `packages/server/src/types/puppeteer.d.ts` — an **ambient type declaration** (`declare module 'puppeteer'`). It's loaded by TypeScript, not `import`ed, and it types `export/render/PdfRenderer.ts`. Keep it.

---

## 2. Broken references / broken endpoints

| File | Broken import | Verdict |
|------|---------------|---------|
| `packages/server/scripts/validate-dpr-audit.ts` | `../src/dpr/geometry/blockGeometry` — **`src/dpr/` does not exist** | Broken → dead script, delete |
| `packages/server/scripts/debug-xlsx-commit.mjs` | `../dist/utils/rollingPlanXlsxParser.js` — points at gitignored build output | Fragile debug throwaway, delete |

**API endpoints:** cross-checked client `/api/*` calls vs. server route mounts. The `/api` prefix is stripped consistently by the Vite dev proxy (`rewrite: /^\/api/ → ''`) and by nginx (`proxy_pass …:3000/`), and every mounted route (`/6hi`, `/live`, `/machines`, `/import`, `/exports`, …) has a matching client caller. **No broken endpoints found.**

---

## 3. Empty / placeholder files (0 bytes)

Not imported anywhere; pointless stubs.
```
schema.sql                                        (root, 0 bytes — schema lives in migrations/)
packages/server/src/export/index.ts               (0 bytes)
packages/server/src/export/aggregation/index.ts   (0 bytes)
packages/server/src/export/layouts/index.ts       (0 bytes)
```

---

## 4. Duplicate & archival doc bloat — safe to delete

**`doc/audit/ZEDRAL_CENTRAL/` (58 MB)** is a dumped, un-cleaned archive folder. It contains:
- A **full nested self-copy**: `doc/audit/ZEDRAL_CENTRAL/ZEDRAL_CENTRAL/` duplicates the parent byte-for-byte (every `.md`, the apk, the zips — all present twice).
- **Committed archives *and* their extracted contents side by side**: `Zedral_v1.zip` (9.9 MB), `Dev_Handover.zip` (3.9 MB), `M1_Technical_Blueprint (1).zip` (2 MB) — each also unpacked into a sibling folder.
- `hmdm-6.36-os.apk` (6.3 MB, third-party MDM binary) — present twice.
- `__MACOSX/` folders full of AppleDouble `._*` files (pure macOS zip artifacts).
- Triplicated docs: `ZEDRAL_FULL_AUDIT.md`, `SUPERVISOR_REMOVAL_SPEC.md`, `DB_AUDIT.md`, `CONSOLIDATION_PLAN.md`, `POST_CONSOLIDATION_VERIFICATION.md` each exist in 3 copies.

**Recommendation:** keep at most one clean copy of the actual `.md` design docs you still want; delete the `.zip`s, the `.apk`, the `__MACOSX`/`._*` files, and the entire nested `ZEDRAL_CENTRAL/ZEDRAL_CENTRAL/` duplicate. Realistically the whole `ZEDRAL_CENTRAL` tree can move out of the repo into shared storage.

**Other duplicate:** `extracted_data.json` (1.4 MB) exists in both `packages/server/scripts/seed-zedral-demo/` and `.kiro/specs/dpr-manager/seed data/`. Keep the one the seed script actually reads (`scripts/seed-zedral-demo/`); the `.kiro/` copy is an AI-assistant spec artifact.

---

## 5. Build outputs, crash dumps & OS junk — safe to delete

All generated or transient; none belongs in source control.

**Generated Android build (~275 MB):**
```
packages/client/android/app/build/     (258 MB)
packages/client/android/.gradle/       (17 MB)
packages/client/android/build/         (148 KB)
```
**APKs (built artifacts):**
```
packages/client/android/app/build/outputs/apk/release/app-release.apk   (19 MB)
packages/client/android/app/build/intermediates/apk/debug/app-debug.apk (15 MB)
Zedral-M1-Operator-debug.apk (root)
```
**Duplicate archive:** `packages/client/android.rar` (20 MB — a rar of the very `android/` folder next to it).

**JVM crash dumps & logs (~22 MB, 31 files):**
```
hs_err_pid21004.log, hs_err_pid32216.log, hs_err_pid44308.log   (root)
packages/client/android/hs_err_pid*.log  (12 files)
packages/client/android/replay_pid*.log  (10 files)
debug.log (root)
packages/client/android/.kotlin/errors/errors-*.log
```
**CI artifacts (regenerated each run):**
```
artifacts/ci-*.log, artifacts/ci-results.txt, artifacts/audit-*.txt
```
**Editor/tool temp:**
```
packages/client/vitest.config.ts.timestamp-1783503688688-39034fcf50bd5.mjs
```
**macOS junk (35 items):** all `__MACOSX/` dirs, `._*` AppleDouble files, `.DS_Store`.

---

## 6. Security — should not be in the repo

Remove from the working tree and rotate if they were ever pushed:
```
packages/client/android/keystore.credentials.local   ← signing credentials
packages/client/android/local.properties             ← machine-local SDK paths
.env                                                  ← already gitignored; present in the zip
```

---

## 7. Fix `.gitignore` so this doesn't recur

The Android build folder has **no** `.gitignore` (Capacitor normally ships one). Add:
```gitignore
# Android generated
packages/client/android/build/
packages/client/android/app/build/
packages/client/android/.gradle/
packages/client/android/.kotlin/
packages/client/android/local.properties
packages/client/android/*.log
packages/client/android/**/hs_err_pid*.log
packages/client/android/**/replay_pid*.log
packages/client/android/keystore.credentials.local

# OS / archive junk
__MACOSX/
._*
.DS_Store
*.rar
```
(`*.log`, `*.apk`, `*.rar`, dist, node_modules, `.env*` are already covered — these files being in the zip just means they were never cleaned from the working tree.)

---

## 8. Review candidates — likely obsolete, but confirm before deleting

These are **not** on any runtime path, but they may be intentionally-kept one-off ops tooling. Recommend a quick human confirm rather than blind deletion.

**One-off / debug scripts (`packages/server/scripts/`, not wired into `package.json`):**
```
fix-dpr-lock.mjs, fix-dpr-lock-2.mjs, fix-audit-log.mjs, fix-export-job.mjs
debug-db.mjs, debug-xlsx-commit.mjs (broken)
migrate_phase8.ts, migrate_phase11.ts, migrate_phase12.ts   (one-time, already applied)
migrate-staff-to-supertokens.mjs, migrate-config.js
validate-dpr-audit.ts (broken), validate-crm-errors.ts, validate-reattribution.ts
audit-pgmigrations.mjs, audit-shift-attribution.mjs
ensure-m1-app-role.mjs, clear-demo-data.mjs, build-dpr-blank-master.js
set_user_pins.js, query.ts
```
Scripts **actually referenced** by `package.json` (keep): `api-smoke`, `pilot-smoke`, `clear-order-data`, `clear-pilot-data`, `ensure-crew-table`, `reindex-traceability`, `repair-migration-history`, `reset-pilot-pins`, `run-integration-tests`, all `seed-*` used by seed scripts.

**Root status/report docs (one-time, likely stale — archive if no longer needed):**
```
PRODUCTION_READINESS_REPORT.md (27 KB), FINAL_PRODUCTION_APPROVAL.md,
PRODUCTION_BLOCKER_VALIDATION.md, SMOKE_TEST_CHECKLIST.md,
PLANT_HEAD_DASHBOARD_TEST_AUDIT.md, GITHUB_ACTIONS_AUDIT.md,
ENVIRONMENT_VALIDATION.md, PROJECT_STRUCTURE.md (31 KB, may be outdated)
```

---

## 9. Suggested execution order (safe → verify)

1. Delete §5 (build/crash/OS junk) + §3 (empty files) + §6 (secrets) + §4 archives — zero code impact, reclaims ~370 MB.
2. Delete §1 dead source + §2 broken scripts.
3. Run the build + test suite to confirm green:
   `npm run build` · `npm run test` · `npm run arch:check` · `npm run e2e:smoke`
4. Apply §7 `.gitignore` and, for anything already committed, `git rm --cached <path>`.
5. Triage §8 with the team, then remove.

_All §1–§6 items were verified as unreferenced/generated; step 3 is the final safety gate before committing._
