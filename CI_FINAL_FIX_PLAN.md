# CI — Final Consolidated Fix Plan

**Scope:** Analysis only, no code changed. Supersedes `CI_FIX_PLAN.md` and `CI_FIX_PLAN_2.md` (whose four + two issues already landed in `b0214db` / `e8624be`). This plan covers the failures now visible across three runs: the `Trivy` push gate (PR #168), and dependabot PRs #173 and #175.

## The one thing to fix first

**`package-lock.json` is out of sync with `package.json`.** Commit `e8624be` edited the manifest — direct `nodemailer` pin and `overrides` (`nodemailer: 9.0.5`, `esbuild: 0.28.0`, `tar: 7.5.22`) — but the lockfile was **not** regenerated. Proof: `package.json` (and `overrides`) require `nodemailer@9.0.5`, yet `package-lock.json` still resolves `nodemailer@8.0.11`; `npm ci --dry-run` reports 133 packages to add and 9 to change. `npm ci` (used by **every** job) refuses to install against an out-of-sync lock, so it exits 1 everywhere. This single desync explains almost all of the red below. Fix it first and most of the board goes green.

## Summary

| # | Where it shows | Symptom | Root cause | Blocking? |
|---|----------------|---------|------------|-----------|
| 1 | #173 & #175: `lint`, `build`, `unit`, `integration`, `arch`, `audit`, `docker-pr` all exit 1; Docker PR dies at `npm ci` | `npm ci` fails / everything red | **Lockfile out of sync** with `package.json` (nodemailer 9.0.5 vs 8.0.11, esbuild/tar overrides not written to lock) | Yes — dominant |
| 2 | #168 push: `Docker · Trivy · Push GHCR` exit 1 | Trivy HIGH/CRITICAL on `kysely` | `kysely@0.27.6` has CVE-2026-32763 / -33468 / -44635; fixed only in **≥0.28.17**, a **breaking** upgrade | Yes |
| 3 | #168 Trivy + audit | `nodemailer@8.0.11` GHSA-p6gq-j5cr-w38f | Vulnerable nodemailer still installed | Yes — but already pinned; resolved by #1 |
| 4 | #175: `build`, `unit`, `arch`, `integration` | `This expression is not callable` (TS) | The 23-package "production-minor" group bumped `kysely` 0.27→0.28; the 0.28 query-builder API/types are **breaking** (34 server files use kysely) | Yes (that PR) |
| — | #173 npm audit job | `npm audit (report)` exit 1 | Not the audit — its first step is `npm ci` (see #1) | No (false alarm) |
| — | all jobs | Node20→24 deprecation; lint fast-refresh warnings | Actions/runtime + client exports | No (warnings) |

Issues 2 and 4 are the **same dependency** (`kysely`) seen from two sides: the CVE fix *requires* the 0.28 upgrade, and the 0.28 upgrade *breaks the build*. So the kysely work is one coordinated change, not two.

---

## Issue 1 — Lockfile out of sync (dominant, fix first)

**Root cause**
`e8624be` changed direct deps and `overrides` in `package.json` without running an install to update `package-lock.json`. `npm ci` validates that the manifest (including `overrides`) matches the lock and aborts on mismatch — so lint/build/unit/integration/arch/audit/docker all fail at their `npm ci` step. The `audit` job's exit 1 is this, not an advisory.

**Fix**
- Regenerate the lockfile on a clean checkout: run `npm install` (not `npm ci`) so the manifest pins/overrides are written into `package-lock.json`, then commit the lock. Confirm `git diff package-lock.json` shows `nodemailer` → `9.0.5`, `esbuild` natives → `0.28.x`, `tar` → `7.5.22`, and that `npm ci` then runs clean.
- Regenerate on the **same OS/npm** CI uses (Linux + npm 11.4.2) so the Linux natives are recorded and `ensure-native-bindings` stays a no-op (ties off the Run-2 ECONNRESET class).
- **Add a drift guard** so this cannot recur silently: a CI step that runs `npm ci` (already implicit) plus an explicit `npm ls --package-lock-only` / lockfile-clean check, or `npm install --package-lock-only && git diff --exit-code package-lock.json`. Fail the build if the lock would change.

**Verification**
- `npm ci` succeeds locally on a clean clone; `npm ls nodemailer` shows a single `9.0.5`, no nested `8.x`.
- Re-run #173 (or any PR) — the broad exit-1 wave clears.

---

## Issue 2 & 4 — `kysely` CVEs require a breaking 0.28 upgrade (one coordinated change)

**Root cause**
- Trivy (push-to-main gate: `severity: CRITICAL,HIGH`, `exit-code: 1`, `ignore-unfixed: true`) blocks the image because `kysely@0.27.6` carries three fixed advisories: CVE-2026-32763 (JSON-path SQL injection), CVE-2026-33468 (`sql.lit` MySQL escaping), CVE-2026-44635 (`JSONPathBuilder.key()/.at()` traversal). All three are fixed by **kysely ≥ 0.28.17**. Because they are *fixed* upstream, `ignore-unfixed: true` does **not** skip them.
- The manifest pins `kysely@^0.27.3`, so the CVEs persist. When dependabot #175 bumped kysely to 0.28 inside a 23-package group, the 0.28 query-builder API/type changes produced `This expression is not callable` across the 34 server files that import kysely — i.e., the upgrade is breaking and needs code adaptation.

**Fix (choose the path that matches urgency)**
- **Primary — do the kysely 0.28 migration properly (recommended).** Bump `kysely` to `^0.28.17` (and check `kysely-codegen@^0.20.0` for 0.28 compatibility — bump if needed), then fix the `not callable` sites (typically changed `sql`/expression-builder/JSON-path signatures). Land it as its own PR with the full unit + integration suite green. This clears the Trivy gate *and* unblocks #175. Regenerate the lockfile as part of it (Issue 1).
- **Bridge — only if an image must ship before the migration is done:** add the three kysely CVE IDs to `.trivyignore` with a comment and a tracked issue/expiry, so the push gate passes temporarily. This is an accepted-risk stopgap, **not** the fix — remove it when the 0.28 migration lands. (The three CVEs are SQL-injection classes; only acceptable short-term if you confirm the affected APIs — raw JSON-path keys, `sql.lit` with untrusted input — aren't reachable with attacker-controlled data.)

**Verification**
- `npm run build -w @m1/server` (and the whole chain) compiles with no `not callable` errors.
- Unit + integration suites pass against Postgres.
- Trivy scan of the backend image reports no HIGH/CRITICAL for kysely.

---

## Issue 3 — `nodemailer` CVE (already pinned; resolved by Issue 1)

**Root cause / status**
`nodemailer` GHSA-p6gq-j5cr-w38f (raw-option file/URL-access bypass, SSRF) is fixed in 9.0.1. The manifest already pins `nodemailer@9.0.5` (direct dep **and** override), and `supertokens-node@24.0.3` will inherit it via the override — but the **stale lock still has 8.0.11**. Regenerating the lockfile (Issue 1) makes 9.0.5 effective everywhere.

**Note:** ignore npm audit's suggestion to "install supertokens-node@9.2.3 (breaking change)" — that is a naive downgrade of your auth library; the override route keeps supertokens@24 and forces the patched nodemailer.

**Verification:** after Issue 1, `npm ls nodemailer` → `9.0.5` only; Trivy/audit no longer flag it.

---

## Dependabot PRs #173 and #175 — policy, not one-off fixes

- **#173 (typescript-eslint 8.60→8.66, dev-only):** failing purely because it sits on the out-of-sync lock (Issue 1). It will go green once main's lock is fixed and the branch rebases. No special action.
- **#175 (23-package "production-minor" group):** fails because the group silently includes the **breaking** kysely 0.28 bump (Issue 4). Recommendation: **split the group** — let the genuinely safe minors merge together, and route kysely (and any other lib that changes call signatures) to its own PR handled with the Issue 2/4 migration. In `dependabot.yml`, exclude `kysely` from the grouped rule (or give it a dedicated group) so a breaking bump never rides in with cosmetic ones. Also confirms audit-flagged `glob`/`node-pg-migrate`, `vite`/`vitest` (dev-only) advisories are handled by their own bumps.

---

## Hygiene (non-blocking — batch separately)

- **`.trivyignore` coverage:** currently only esbuild CVEs. Do **not** add kysely/nodemailer here as a permanent measure — those are fixed upstream and must be upgraded. Any temporary ignore must carry an expiry/issue.
- **Node20→24 deprecation:** `actions/checkout`/`setup-node`/`gitleaks` already moved to newer majors (good); `docker/setup-buildx-action@v3` and `docker/build-push-action@v6` still warn — bump when convenient. Separately, `@capacitor/cli@8.5.0` wants Node ≥22 while the toolchain pins Node 20 (`setup-node-npm`, Dockerfile) — plan a Node 22/24 toolchain bump as a tracked task, not urgent.
- **Lint fast-refresh warnings** (`MachineHeadDashboardPanels.tsx`, `RouteSpinner.tsx`, `ProcessPairedField.tsx`, …): move non-component exports to sibling files. Cosmetic; `lint` passes.

---

## Recommended order

1. **Issue 1 — regenerate + commit the lockfile**, add the drift guard. Unblocks #173 and the entire red wave immediately. (Minutes.)
2. **Issues 2/4 — kysely 0.28 migration** in a dedicated PR (bump + fix `not callable` sites + tests). Clears the Trivy gate and #175. (Real work; size it.)
3. **Issue 3** verifies itself once #1 lands.
4. **Dependabot policy** — split the production-minor group to keep kysely separate.
5. **Hygiene** — action bumps, Node-22 toolchain planning, lint refactor.

**Risk:** Issue 1 is low-risk and mechanical but must be regenerated on Linux + npm 11.4.2 to keep natives deterministic. The kysely migration is the only substantive code change — gate it behind the full test suite. The bridge `.trivyignore` option is accepted-risk and must be time-boxed.

**Through-line across all three plans:** every recurrence has been a **consistency gap** — a build step not mirrored across jobs (Plan 1), a `permissions` block missing a scope (Plans 1–2), and now a **manifest/lock** and a **CVE-fix/version** that drifted apart. A lockfile-drift CI guard plus the existing per-job parity would catch this whole class before it reaches a run.
