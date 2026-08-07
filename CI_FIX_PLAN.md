# CI Failure — Audit, Analysis & Fix Plan

**Scope:** Analysis only. No code changed. Four distinct CI failures on the current PR run.

## Summary

| # | Job | Symptom | Root cause | Severity |
|---|-----|---------|------------|----------|
| 1 | `integration` (Migrate · integration) | `Failed to resolve entry for package "@m1/shared-validation"` — 10 suites / 7 tests fail | Integration job never **builds** the workspace packages; `@m1/shared-validation` `main` points at `dist/index.js` which does not exist | Blocking |
| 2 | `unit` (Server unit) | `connect ECONNREFUSED …:5432` in `handoverDraftJsonb.test.ts` — 1 test fails | A Postgres-dependent test leaked into the **unit** suite (no DB service in that job) | Blocking |
| 3 | `secrets` (gitleaks) | `HttpError: Resource not accessible by integration` (403) on `pulls/2/commits` | Job has no `permissions:` block; default `GITHUB_TOKEN` lacks `pull-requests: read` | Blocking |
| 4 | `docker-pr` (Docker build PR) | `ENOENT: chdir '/app/packages/server' -> 'packages/server'` | Smoke command does a **relative** `chdir('packages/server')` but the image `WORKDIR` is already `/app/packages/server` | Blocking |

Issues 1, 3 and 4 are CI-config bugs (the application code is fine). Issue 2 is a test-placement bug. None of the four indicate a genuine product defect.

---

## Issue 1 — Integration tests: `@m1/shared-validation` cannot be resolved

**Symptom**
```
Error: Failed to resolve entry for package "@m1/shared-validation".
The package may have incorrect main/module/exports specified in its package.json.
```
Every failing integration suite hits this; the tests that pass do not import the package.

**Root cause**
- `packages/shared-validation/package.json` declares `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`. The `dist/` folder only exists after `npm run build` (`tsc -b`). On a clean CI checkout there is no `dist/`, so Vite/Vitest resolves the workspace symlink, reads `main`, and fails on the missing entry.
- The `unit` job (`.github/workflows/ci.yml` lines 67–71) and the `arch` job (lines 138–142) **both** build the workspace packages before testing. The `integration` job (lines 108–127) does **not** — it goes straight from migrations to `npm run test:integration` with no build step.
- Confirmed by import analysis: all four failing files (`ppcImportCoilOrder.test.ts`, `importDataIntegrity.preservation.test.ts`, `importDataIntegrity.exploration.test.ts` via the same import, `crmMillWorkflows.integration.test.ts`, `shiftLogOperator.test.ts`, etc.) import `@m1/shared-validation` as a bare specifier. The passing suites (`platform-security`, `tenantIsolation`, `machineHeadLifecycle`) import nothing from the workspace and so never trip the resolver.
- There is **no** Vitest alias / `vite-tsconfig-paths` plugin. The `paths` in `tsconfig.base.json` (which map `@m1/shared-validation` → `src`) are used by `tsc` only, not by Vitest — so the source is never substituted for the missing `dist`.

**Fix options**

- **A (recommended) — build the packages in the integration job.** Mirror what `unit`/`arch` already do. In `.github/workflows/ci.yml`, in the `integration` job, add before the `Server integration tests` step (line 126):
  ```yaml
      - run: npm run build -w @m1/shared-validation
      - run: npm run build -w @zedral/platform
      - run: npm run build -w @zedral/connectors
      - run: npm run build -w @zedral/m1-collection
      - run: npm run build -w @m1/server
  ```
  Lowest risk, consistent with the rest of the file. (Building only `@m1/shared-validation` would fix today's error, but building all five keeps integration consistent with unit/arch and pre-empts the same failure if another integration test imports `@zedral/*` later.)

- **B (more durable) — resolve workspace packages from source in tests.** Add `vite-tsconfig-paths` (or an explicit `resolve.alias`) to `vitest.integration.config.ts` and `vitest.unit.config.ts` so `@m1/shared-validation` → `packages/shared-validation/src/index.ts`. Removes the build-before-test coupling for *all* test jobs. Larger change; touches test infra; verify it doesn't mask a real packaging error.

- **C — package-level `exports` with a source condition.** Add an `exports` map to each package pointing a `development`/`import` condition at `src`. Broadest blast radius; not recommended just for CI.

**Recommendation:** Option A. It is a 5-line, pattern-matching change and the safest.

**Verification**
- Re-run the `integration` job; confirm the 10 suites collect and the 7 tests execute against Postgres.
- Locally: `npm run build -w @m1/shared-validation && npm run test:integration -w @m1/server` with a DB up.

---

## Issue 2 — Unit job: Postgres `ECONNREFUSED` from `handoverDraftJsonb.test.ts`

**Symptom**
```
AggregateError … connect ECONNREFUSED ::1:5432 / 127.0.0.1:5432
 at ensureOperatorUserId (tests/handoverDraftJsonb.test.ts:26)
```
Unit result: `1 failed | 537 passed`. This is the only unit failure.

**Root cause**
- `packages/server/tests/handoverDraftJsonb.test.ts` opens a real `pg` Pool and hits Postgres (its own comment says *"This test hits a real Postgres…"*).
- The `unit` job runs `vitest run -c vitest.unit.config.ts` and has **no** Postgres service. `vitest.unit.config.ts` excludes DB tests via the `integrationPatterns` list, but this file is **not** in that list and is **not** named `*.integration.test.ts`, so it runs in the unit suite and cannot connect.
- Correct home is the integration suite, which has the Postgres service and whose runner (`scripts/run-integration-tests.mjs`) skips gracefully when no DB is reachable.

**Fix options**

- **A (recommended) — rename to the integration convention.** Rename `handoverDraftJsonb.test.ts` → `handoverDraftJsonb.integration.test.ts`. Both configs already glob `tests/**/*.integration.test.ts` (excluded from unit, included in integration). Zero config edits; matches existing DB tests. Update any references (none expected).

- **B — list it explicitly.** Add `tests/handoverDraftJsonb.test.ts` to `integrationPatterns` in `vitest.unit.config.ts` *and* to `include` in `vitest.integration.config.ts`. Works, but two edits and easy to forget the pair.

- **C — guard/skip.** Wrap in `describe.skipIf(process.env.VITEST_DB_AVAILABLE !== '1')`. Keeps it in the unit file but makes it a no-op without a DB — reduces coverage silently; not preferred.

**Recommendation:** Option A (rename). Convention-aligned, self-documenting, no config drift.

**Verification**
- `unit` job: `537 passed`, 0 failed, file no longer collected.
- `integration` job: the renamed suite runs and passes with the DB service (it self-creates its `app_user` fixture, so it needs only migrations).

---

## Issue 3 — Secrets (gitleaks): 403 `Resource not accessible by integration`

**Symptom**
```
RequestError [HttpError]: Resource not accessible by integration
 GET https://api.github.com/repos/…/pulls/2/commits  → 403
 x-accepted-github-permissions: pull_requests=read
```

**Root cause**
- On `pull_request`, `gitleaks/gitleaks-action@v2` lists the PR's commits, which needs `pull-requests: read`.
- `.github/workflows/ci.yml` has **no top-level `permissions:`** and the `secrets` job (lines 145–155) sets none, so it inherits the repo/org default `GITHUB_TOKEN`. With the modern default (read-only `contents`), `pull-requests` is not granted → 403. The log confirms this is **not** a licensing issue ("individual user… No license key is required").

**Fix options**

- **A (recommended) — grant least-privilege on the job.** Add to the `secrets` job:
  ```yaml
    secrets:
      name: Secrets (gitleaks)
      runs-on: ubuntu-latest
      timeout-minutes: 10
      permissions:
        contents: read
        pull-requests: read
      steps:
        …
  ```
  Matches the documented requirement and the pattern already used by the `docker-*` jobs (which set their own `permissions`).

- **B — drop the PR-commits API entirely.** Replace the action with the gitleaks CLI (`gitleaks detect --source . --redact` over the checkout, `fetch-depth: 0` already set). No `pull-requests` permission needed and works identically on forks; slightly more YAML.

- **Note:** If PRs from forks must be scanned, prefer B — a fork PR's `GITHUB_TOKEN` is read-only regardless of the `permissions` block, so A can still 403 for fork PRs. For same-repo branch PRs, A is sufficient.

**Recommendation:** Option A for same-repo PRs; adopt B if external-fork PRs need scanning.

**Verification**
- Re-run on a PR; the `secrets` job lists commits and completes. The gitleaks summary shows a scan result rather than an HttpError.

---

## Issue 4 — Docker build (PR): `chdir … ENOENT`

**Symptom**
```
Error: ENOENT: no such file or directory, chdir '/app/packages/server' -> 'packages/server'
 at process.wrappedChdir …  (from `docker run … node -e "process.chdir('packages/server'); …"`)
```

**Root cause**
- The `backend` image sets `WORKDIR /app/packages/server` as its final working directory (`Dockerfile` line 75).
- The `docker-pr` smoke step (`ci.yml` lines 203–206) runs `--entrypoint node … -e "process.chdir('packages/server'); require('zod'); …"`. Because the container cwd is **already** `/app/packages/server`, the *relative* `chdir('packages/server')` resolves to `/app/packages/server/packages/server`, which doesn't exist → ENOENT.
- The Dockerfile's own build-time smokes (lines 45 and 72) use the same `chdir('packages/server')` but run while `WORKDIR` is `/app`, so they succeed. The CI step copied that snippet without accounting for the different cwd of the final image.
- The `chdir` is not even necessary: prod deps are hoisted to `/app/node_modules`, and Node's `require` resolution walks up from `/app/packages/server` to `/app/node_modules`, so `zod`/`pg`/`express` resolve from the server directory already.

**Fix options** (edit the `docker-pr` → *Runtime require smoke* step in `ci.yml`)

- **A (recommended) — drop the `chdir`.** cwd is already the server package:
  ```yaml
      - name: Runtime require smoke
        run: |
          docker run --rm --entrypoint node zedral-backend:pr -e \
            "require('zod'); require('pg'); require('express'); console.log('pr image ok')"
  ```

- **B — make the `chdir` absolute** (robust to any future WORKDIR change):
  ```yaml
            "process.chdir('/app/packages/server'); require('zod'); require('pg'); require('express'); console.log('pr image ok')"
  ```

- **C — force cwd via docker flag:** add `-w /app` to `docker run` so the existing relative `chdir` matches. Works, but leaves the fragile relative path in place.

**Recommendation:** Option B (absolute path) — it verifies resolution from the exact runtime directory and can't drift if `WORKDIR` changes. Option A is equally valid and simpler.

**Verification**
- Re-run `docker-pr`; the smoke prints `pr image ok`. (Optional: apply the same absolute-path treatment to the Dockerfile smokes on lines 45 and 72 for consistency, though those currently work.)

---

## Suggested rollout order

All four are independent and can land in one PR. Recommended sequence for easy review:

1. **Issue 4** — one-line `ci.yml` edit; unblocks the PR docker smoke.
2. **Issue 3** — add `permissions` block to the `secrets` job.
3. **Issue 2** — rename the test file (moves it to the DB-backed job).
4. **Issue 1** — add the five build steps to the `integration` job.

**Risk:** Low across the board. Every change either mirrors an existing pattern in the same workflow (1, 3) or removes an incorrect assumption (2, 4). No application/runtime code is touched.

**Cross-cutting observation (optional follow-up):** the `unit`, `arch`, and (after fix) `integration` jobs each repeat the same five `npm run build -w …` lines. Consider extracting a `build-workspaces` composite action or a single `npm run build:libs` script to keep them in sync and prevent this class of drift from recurring.
