# Pipeline Reliability: Root-Cause Diagnosis, Gap Audit & Implementation Plan

_Zedral / HSL — `m1-digital-data-collection` monorepo_
_Prepared: 2026-08-07 · Scope: CI (GitHub Actions) · AWS QA · Factory Production · Dependency security_

---

## 0. TL;DR (read this first)

**The single most important correction:** the `npm audit` output you pasted is **not** what fails your pipeline. In `.github/workflows/ci.yml`, both audit steps end with `|| true` and are labelled *"report-only"*. They print a warning and a job-summary table, then always pass. So `undici` / `uuid` / `xlsx` / `exceljs` advisories are **noise in the logs, not a red X on the run.** They are worth fixing (one of them — `xlsx` — is a genuine security risk because your server parses operator-uploaded spreadsheets), but they are not the blocker.

**What actually fails your pipeline** is a *chain of unrelated, one-at-a-time breakages* across every stage — lint, unit tests, integration tests, the Docker build, DB migrations, and the QA health check. Your own `doc/AGENT_CONTEXT_LOG.md` records ~15 separate "fix X, push, it broke Y" cycles in a single day. That "many changes of the same" feeling is real and has **one meta-cause**:

> **You cannot reproduce the pipeline locally, so every fix is a blind commit-and-pray round-trip.** The repo lives in a OneDrive-synced Windows folder, which (a) generates a Windows-only lockfile that omits Linux binaries, (b) produces CRLF phantom diffs on ~140 files per change, and (c) locks `node_modules` (EBUSY) so the full test suite won't run on your machine. Every push is your only test — so you fix one layer, the next layer fails, and you push again.

Fix the *loop*, not just the symptoms. This document gives you the diagnosis, a full gap audit, and a phased plan to get to a reliably green CI → AWS QA → Factory pipeline.

---

## 1. System topology (what you have today)

**Build once, deploy many** — the architecture itself is sound:

| Stage | File | Runner | Trigger | Job |
|---|---|---|---|---|
| **CI quality** | `ci.yml` → `quality` | GitHub-hosted `ubuntu-latest` | PR + push to `main` | lint → build → client tests → operator bundle → migrate → db-codegen drift → server unit → server integration → arch → npm audit (report-only) |
| **CI images** | `ci.yml` → `docker-build-push` | GitHub-hosted | **push to `main` only** | build `backend` + `nginx` → Trivy (CRITICAL) → push to GHCR as `SHA` + `latest-main` |
| **AWS QA deploy** | `deploy-aws.yml` | **self-hosted on the QA box** (`zedral-aws-qa`) | after CI success, or manual | GHCR login → rsync `deploy/` → `remote-ghcr-deploy.sh` (compose up + migrate) → `/health` retries → auto-rollback → Playwright smoke (GitHub-hosted) |
| **Factory deploy** | `deploy-production.yml` | **self-hosted on Factory box** (`hslsmed`) | manual only | resolve/promote GHCR tag → backup DB → pull → compose up → health → rollback on fail → smoke (on box, LAN-only) |

The images are immutable and pull-only; QA and Factory never build from source. That's the right shape. **The problems are all in the plumbing, not the architecture.**

---

## 2. Root-cause analysis

Ordered by leverage — fixing the top items removes whole categories of failures.

### 2.1 META-CAUSE — the dev environment can't reproduce CI (the "blind push" loop)

Evidence, straight from `doc/AGENT_CONTEXT_LOG.md`:
- _"Local full test suite blocked by Windows EBUSY/OneDrive locks on node_modules."_
- _"Playwright Chromium download failed locally → QA `/health`+`/login`+`/api/health` 200 only."_
- _"No `gh` CLI (install blocked); cannot pull Actions artifact logs."_
- _"`gradlew` blocked by services.gradle.org SSL → used local Gradle from GitHub zip."_

Because you can't run lint + build + unit + integration + Docker build locally, **CI is your test harness.** Each red run teaches you one fact, you patch it, push, and discover the next. That is exactly why you see dozens of near-identical "fix CI" / "fix QA" commits. **This is the highest-leverage thing to fix.** You already have the tool for it — `scripts/run-ci-quality-local.sh` mirrors the CI quality job inside a `node:20` container — but the OneDrive path fights it.

### 2.2 CRLF line-ending churn — "many changes of the same"

`git diff -w --stat` (ignoring whitespace) shows **only 4 files truly changed**, but `git diff --stat` shows **144 files / ~13,200 lines**. The other ~140 files are pure CRLF↔LF flip-flop.

Cause: `.gitattributes` normalizes only `*.ts, *.tsx, *.js, *.jsx, *.json, *.css, *.md, *.sh` and `deploy/**`. It does **not** cover the extensions that make up most of your scripts:

| Extension | Covered by `.gitattributes`? | Confirmed CRLF in tree? |
|---|---|---|
| `.mjs` (all seed/migrate/smoke scripts) | ❌ No | ✅ CRLF |
| `.cjs` (eslint configs, gen-qss-migration) | ❌ No | ✅ CRLF |
| `.sql` (seed.sql, prod-queries) | ❌ No | ✅ CRLF |
| `.py` (icon gen, encoding fixer) | ❌ No | ✅ CRLF |
| `.mdc` (cursor rules) | ❌ No | ✅ CRLF |
| `.yml` / `.yaml` (**your workflow files!**) | ❌ No | ✅ CRLF |
| `Dockerfile`, `.gradle`, `.xml`, `.conf` | ❌ No | ✅ CRLF |

Consequences: every PR is unreviewable (140-file diffs), merge conflicts explode across your three long-lived branches (`main`, `update`, `hsl_zedral_CTL/RW/Q`), and — most dangerously — a CRLF that slips into a `.sh` entrypoint or a shell heredoc breaks bash on the Linux/EC2 boxes. Your own `.gitattributes` comment warns about this, but the rule set has holes.

### 2.3 Windows-generated lockfile omits Linux natives → band-aid install script

Because you `npm install` on Windows, the lockfile historically dropped Linux-only optional binaries (`@rollup/rollup-linux-x64-gnu`, `@rolldown/binding-linux-*`, `lightningcss-linux-*`, `@tailwindcss/oxide-linux-*`, `@esbuild/linux-x64`). npm `<11.3` then skips cross-OS optionals entirely (npm/cli#4828). To survive this you carry **three** compensating hacks:

1. Root `package.json` pins both Windows **and** Linux natives in `optionalDependencies` (forces them into the lockfile — currently 26 Linux entries are present, so it's working *for now*).
2. `npm install -g npm@11.4.2` in **both** `ci.yml` and the `Dockerfile` before every install.
3. `scripts/ensure-native-bindings.mjs`, which runs `npm install --no-save --no-package-lock` at build time to patch any still-missing native.

This works, but it is fragile: it defeats the reproducibility guarantee of `npm ci`, adds a network install mid-build (a flake surface), and every dependency bump risks the pins drifting out of sync with the real transitive versions. The clean fix is to **generate the lockfile on Linux** (or in a container) so the natives are native, not bolted on.

### 2.4 Monorepo prod-pruning fragility — the `zod` saga

Four commits (`df0946c`, `9ff967f`, `ccc3e81`, plus log entries) were spent on one bug: the backend Docker image crashed at runtime with `Cannot find module 'zod'`. Root cause chain:
- `zod` was declared only on `@m1/shared-validation`, but `packages/server` imports it directly.
- The lockfile had a root `zod@4` marked `dev:true` (pulled by `kysely-codegen`/`eslint`), so `npm ci --omit=dev` dropped it.
- Workspace hoisting + `npm prune --omit=dev` then left no `zod` that Node's resolver could see from the server's compiled `dist`.

You fixed it (declare `zod` as a real prod dep on the server, pin `zod@3.25.76` via root `overrides`, prune-from-builder instead of a second workspace `ci`). But **the class of bug remains**: any prod dependency that is imported directly but only *declared* transitively will vanish in the pruned image and only surface at container boot on QA — i.e. *after* merge. There is no PR-time check that the production image can actually `require()` what it imports.

### 2.5 Migration ordering chaos — the `--no-check-order` band-aid

`packages/server/scripts/run-migrate.mjs` now passes `--no-check-order` on every up/down. This was added because QA rejected a mid-timeline migration (`193301_quality_spec_sheet` arriving after `193400` had already run). You have **123 migrations** with timestamp prefixes authored across parallel branches, so timestamps collide and arrive out of order. `--no-check-order` silences the guard, but it also removes your only protection against a genuinely mis-ordered migration. Combined with divergent branches, this is a latent data-integrity risk, not just a CI annoyance.

### 2.6 Migration role/permission coupling

QA crash-looped with `permission denied for schema public` / `CREATE pgmigrations denied` because the old entrypoint migrated using the **app** role (`m1_app`, which is intentionally RLS-restricted) instead of the **bootstrap** owner (`m1_user`). You fixed the entrypoint to prefer `MIGRATE_DATABASE_URL` and refuse app-role migrations — good — but the fix lives in a shell entrypoint that (a) isn't covered by CI and (b) depends on operators setting `deploy/.env` `DB_USER` correctly on each box. It's correct but under-guarded.

### 2.7 QA deploy instability

Multiple log entries: QA backend "unhealthy in ~14s", `compose --force-recreate` bouncing `db`/`redis`/`supertokens` on every deploy, health grace too short. You've since removed force-recreate, set `start_period: 120s`, and made nginx `depends_on: service_started`. The remaining structural issue: **migrations run inside the backend container at boot** (`RUN_MIGRATIONS=true`). A slow or failing migration therefore manifests as a *health-check failure*, triggering a rollback — instead of failing loudly as a discrete "migration" step. You're diagnosing DB problems through the wrong lens (container health) because migration and app-start are fused.

### 2.8 Flaky / poorly-isolated tests

Log: _"CRM cleanup scoped to mill artifacts (no global wipe of `shift_log`/`coil`/`ANN` → shared-suite FK noise)"_ and _"flaky unit tests."_ Integration tests share one Postgres and were doing broad table wipes, so tests contaminated each other (FK violations depending on execution order). Partly fixed by scoping cleanup, but the pattern (shared mutable DB, order-dependent fixtures) will keep producing intermittent reds.

### 2.9 Dependency security — what's real vs. what's noise

| Package | How it enters | Severity | Reality |
|---|---|---|---|
| **undici** 7.27.2 | transitive: `@elastic/elasticsearch` → `@elastic/transport` (**prod**); `jsdom` (dev) | Moderate/High advisories | **Real but easy.** `@elastic/transport` allows `^7.19.1`, so a patch bump inside 7.x is non-breaking. `npm audit fix` (no `--force`) resolves it. |
| **uuid** `<11.1.1` | nested inside `exceljs` (your root `uuid` is `^14`, which is fine) | Moderate (buffer bounds in v3/v5/v6 when `buf` passed) | **Real but low-risk.** exceljs uses uuid v4 without a `buf`, so it's not exploitable there. Fix with an `overrides` pin — **do not** run `npm audit fix --force` (it downgrades exceljs to 3.4.0, a breaking change). |
| **xlsx** (SheetJS) 0.18.5 | direct prod dep; parses uploaded plan spreadsheets | **High** — prototype pollution (GHSA-4r6h-8v6p-xvw6) + ReDoS (GHSA-5pgg-2g8v-p4x9) | **The one that matters.** "No fix on npm" because SheetJS only publishes patched builds on their own CDN. Your server parses **operator-uploaded** `.xlsx` (`ctlPlanXlsxParser`, `linePlanXlsxCore`, `rewindingPlanXlsxParser`, `rollingPlanXlsxParser`) — untrusted input into a prototype-pollution-vulnerable parser. See §5 for the decision. |
| **exceljs** 4.4.0 | direct prod dep; used for **export** (5 renderers) | (only via nested uuid) | Fine once the nested uuid is overridden. |

Note you ship **two** Excel libraries: `xlsx` (SheetJS) for *parsing* imports and `exceljs` for *exporting*. Consolidating onto `exceljs` for both would eliminate the vulnerable package entirely (covered in §5).

---

## 3. Gap audit (beyond the active fires)

### CI
- **G1 — Docker build only runs on `main`.** Every Dockerfile / prod-dependency break (the whole zod saga) is invisible until *after* merge. There is no PR-time signal that the production image builds and boots. **Highest-value gap.**
- **G2 — One giant serial `quality` job (35-min timeout).** Lint, build, migrate, unit, integration, and arch run in sequence, so a lint typo costs you the whole cold-install before you learn about it, and root-causing a red run means scrolling one long log.
- **G3 — `ensure-native-bindings.mjs` runs a live `npm install` mid-CI.** Reproducibility hole + network flake surface.
- **G4 — No automated dependency updates** (no Dependabot/Renovate visible), so security bumps are manual and land in big risky batches.
- **G5 — No secret scanning** (gitleaks/trufflehog) in CI. `.env` is correctly gitignored today, but nothing prevents a future accidental commit.
- **G6 — No SBOM / provenance / image signing.** Trivy scans only `CRITICAL` with `ignore-unfixed:true`, so HIGH image vulns pass silently.

### AWS QA / Factory
- **G7 — Migrations fused to backend boot** (§2.7): DB failures masquerade as health failures.
- **G8 — Self-hosted runner is a single point of failure.** If the QA/Factory box or its runner is offline, deploys queue or hang with no alert. No runner-health monitoring.
- **G9 — `rsync --delete` into `APP_DIR/deploy`** is correct but unforgiving; a bad exclude list could remove `.env` or checkpoints. Worth a guard/dry-run assertion.
- **G10 — Deploy correctness depends on hand-set `deploy/.env` on each box** (`DB_USER` must be bootstrap, not app; `BACKEND_IMAGE`/`NGINX_IMAGE` set). No preflight that validates the `.env` before compose up.
- **G11 — No migration reversibility test.** You never prove `down` works; a bad rollback is discovered during an incident.

### Security
- **G12 — Untrusted-input prototype pollution via SheetJS** (§2.9) — the real one.
- **G13 — Trivy severity gate is CRITICAL-only** — HIGH CVEs ship.

### Process / branching
- **G14 — Three long-lived divergent branches** (`main`, `update`, `hsl_zedral_CTL/RW/Q`) amplify both the CRLF churn and the migration-ordering collisions. Merges become archaeology.
- **G15 — No branch protection requiring green CI + Docker build before merge** (inferred from the merge-then-discover pattern).

---

## 4. Implementation plan (phased, prioritized)

Each item has an **effort** estimate and a **done-when** acceptance check. Do the phases in order; Phase 0 alone will stop most of the pain.

### Phase 0 — Stop the bleeding: make the loop reproducible (½–1 day) — **do this first**

**0.1 — Kill CRLF churn permanently.** Replace `.gitattributes` with a catch-all, then renormalize in one dedicated commit.
```gitattributes
# Normalize everything to LF in the repo; let Git handle checkout on Windows.
* text=auto eol=lf

# Binary types must never be touched.
*.png binary
*.jpg binary
*.apk binary
*.keystore binary
*.jar binary
*.ico binary
```
Then, on a clean tree:
```bash
git add --renormalize .
git commit -m "chore: normalize all line endings to LF (kill CRLF phantom diffs)"
```
Also set, once per machine: `git config --global core.autocrlf false`.
**Done when:** `git diff --stat` and `git diff -w --stat` report the *same* file count on your next change.

**0.2 — Get the repo off OneDrive.** Move the working copy to a non-synced path (e.g. `C:\dev\hsl_zedral`) **or**, better, develop inside **WSL2** (Ubuntu) where the Linux toolchain matches CI exactly. This removes EBUSY `node_modules` locks, sync churn, and the Windows-lockfile problem in one move.
**Done when:** `npm ci` + `npm run build` + `npm run test:unit -w @m1/server` all complete locally without EBUSY.

**0.3 — Adopt the local CI mirror as a pre-push gate.** You already have `scripts/run-ci-quality-local.sh` (runs the full quality job in a `node:20` container). Make running it green a precondition for pushing. Add a short `CONTRIBUTING.md` "before you push" checklist.
**Done when:** a red CI run becomes the exception, because you saw it locally first.

**0.4 — Regenerate the lockfile on Linux.** Inside WSL2 or the container, delete `node_modules` + `package-lock.json`, `npm install`, commit the result. Keep the `optionalDependencies` native pins as belt-and-suspenders, but the lockfile should now natively contain the Linux binaries so `ensure-native-bindings.mjs` becomes a no-op in CI.
**Done when:** CI's "Ensure native bindings" step prints `OK` with nothing to install.

### Phase 1 — Make CI honest and catch prod-image breaks pre-merge (1–2 days)

**1.1 — Build (and boot-check) the Docker image on PRs.** Add a PR-triggered job that builds the `backend` target `push: false` and runs the same `require('zod'); require('pg'); require('express')` smoke you already do in the Dockerfile. This catches the entire zod/prune class *before* merge. (Reuse the existing `docker/build-push-action` with `cache-from: type=gha`.)
**Done when:** a deliberately-broken prod dep fails a PR, not a post-merge QA deploy.

**1.2 — Split `quality` into parallel jobs.** `lint` · `build+typecheck` · `unit` · `integration (needs postgres service)` · `arch`. Faster feedback, and a red job names the failing layer immediately. Keep the 35-min budget per job, not for the whole thing.
**Done when:** median PR feedback drops and failures are attributable at a glance.

**1.3 — Normalize the npm-version hack.** Once 0.4 lands, pin the runner to an npm that respects cross-OS optionals via `.nvmrc` / `packageManager` field (or keep the `npm install -g npm@11.4.2` but document *why* in one place, not two).
**Done when:** the global npm upgrade exists in exactly one documented location.

**1.4 — Add a `migrations up→down→up` job** against the CI Postgres to prove reversibility across the whole chain.
**Done when:** a non-reversible migration fails CI.

### Phase 2 — Dependency & security remediation (1 day)

**2.1 — undici:** run `npm audit fix` (NOT `--force`). It bumps undici within 7.x (non-breaking; `@elastic/transport` allows `^7.19.1`). If you prefer determinism, add a root override to the patched line and verify.
**Done when:** `npm audit --omit=dev` no longer lists undici.

**2.2 — exceljs nested uuid:** add an override instead of the breaking `--force` downgrade:
```jsonc
"overrides": {
  "tar": "7.5.19",
  "zod": "3.25.76",
  "exceljs": { "uuid": "^11.1.1" }   // exceljs uses uuid v4; ≥11.1.1 is API-compatible — verify build
}
```
**Done when:** `npm ls uuid` shows no `<11.1.1`, and `npm run build -w @m1/server` + export tests still pass.

**2.3 — xlsx (SheetJS):** decide between the two paths in **§5** and execute. This is the only *real* security exposure in the set.

**2.4 — Add Dependabot (or Renovate)** for weekly, reviewable dependency PRs so security bumps arrive small and continuously instead of in scary batches.

**2.5 — Add `gitleaks` secret scanning** as a fast CI job.

**2.6 — Tighten Trivy** to also fail on `HIGH` for the **backend** image (keep `ignore-unfixed: true`), or at minimum surface HIGH in the job summary.
**Done when:** a newly-introduced HIGH image CVE is visible on the PR.

### Phase 3 — Migration correctness (1–2 days)

**3.1 — Restore ordering discipline.** Either (a) adopt a strict "always author with a timestamp newer than the max applied" rule enforced by a tiny CI lint that flags out-of-order files, or (b) renumber going forward and keep `--no-check-order` only for the historical baseline. The goal: retire blanket `--no-check-order` so a genuinely mis-ordered migration is caught again.
**Done when:** CI fails if a new migration's timestamp predates an already-applied one on a clean DB.

**3.2 — Separate migration from backend boot.** Introduce a one-shot `migrate` step/service in the deploy that runs *before* `backend` starts (you already have `MIGRATE_DATABASE_URL` and a bootstrap-role guard). Backend then starts already-migrated. A failed migration fails as "migrate," not as a health-check flake + rollback.
**Done when:** a bad migration on QA shows up as a failed migrate step with clear logs, and the backend never enters a crash-loop for DB-schema reasons.

**3.3 — Document the migration runbook** (you have `repair-migration-history.mjs` and `reconcile-*` scripts) so mid-timeline gaps have a known, safe recovery instead of ad-hoc `--no-check-order`.

### Phase 4 — Deploy / QA hardening (1–2 days)

**4.1 — Runner health monitoring.** Alert (via the existing `DEPLOY_WEBHOOK_URL`) if the `zedral-aws-qa` or `hslsmed` runner goes offline, so a stuck deploy is visible.
**4.2 — `.env` preflight.** Before `compose up`, assert required keys exist and `DB_USER` is the bootstrap role, `BACKEND_IMAGE`/`NGINX_IMAGE` are set — fail fast with a clear message (closes G10).
**4.3 — Cache Playwright browsers** in the smoke job; add `--retries=2` and trace-on-failure so smoke flakes don't trigger false rollbacks.
**4.4 — Keep and test the rollback path.** You have `rollback-images.sh` + `.last-good-*` checkpoints; add a periodic (or manual) drill that a rollback actually restores service.

### Phase 5 — Governance (½ day, ongoing)

**5.1 — Branch protection on `main`:** require the new PR jobs (lint, build, unit, integration, arch, **docker-build**) green before merge; require linear history (rebase-merge) to tame migration-order collisions.
**5.2 — Collapse the long-lived branches.** Get `update` and `hsl_zedral_CTL/RW/Q` merged or deleted; keep short-lived feature branches. This, plus Phase 0.1, ends the phantom-diff/merge-conflict tax (closes G14).

---

## 5. The `xlsx` (SheetJS) decision — both paths

Your server parses **operator-uploaded** `.xlsx` files through SheetJS 0.18.5, which has an unpatched (on npm) prototype-pollution + ReDoS advisory. Because the input is untrusted, this is a legitimate risk, not just audit noise. Two ways to resolve it:

### Path A — Remediate (recommended for a factory-facing product)
Remove the vulnerable package. Two sub-options:
- **A1 — Consolidate on `exceljs`.** You already use `exceljs` for all *exports*. Reimplement the 4 parser modules (`ctlPlanXlsxParser`, `linePlanXlsxCore`, `rewindingPlanXlsxParser`, `rollingPlanXlsxParser`) on `exceljs`'s reader. One Excel library for read + write; the vulnerable package is deleted from the tree.
- **A2 — Pin the official patched SheetJS build** from `https://cdn.sheetjs.com` (SheetJS ships fixes there, not on npm). Keeps your parsing code identical; changes only the install source (a git/URL dependency + lockfile entry).

**Trade-off:** A1 is the most work (rewrite + re-test 4 parsers against real operator files) but gives you one dependency, a clean audit, and no external CDN reliance. A2 is far less code but adds a non-npm install source to maintain. Either fully removes the advisory.

### Path B — Accept + harden
Keep `xlsx` report-only in CI, and mitigate at the boundary:
- Add explicit input hardening around every parse: enforce file-size/row/cell caps (kills the ReDoS blast radius), and `Object.freeze(Object.prototype)` / a prototype-pollution guard around the parse call.
- Add a documented, dated **risk-acceptance note** (owner, review date) so the exception is a decision, not an oversight.

**Trade-off:** fastest and no code churn, but the vulnerable package remains in the production image and the mitigation is defense-in-depth rather than elimination. Acceptable only if uploads are restricted to trusted, authenticated operator roles (which they appear to be) and you revisit on a fixed schedule.

**Recommendation:** A1 if you can spare the parser rewrite; A2 as the fast, full remediation; B only as a stopgap with a scheduled review.

---

## 6. Definition of done — "green pipeline" checklist

- [ ] `git diff --stat` == `git diff -w --stat` on a normal change (no CRLF churn).
- [ ] `npm ci` + full quality run completes locally (off OneDrive / in WSL2) before every push.
- [ ] CI's native-bindings step is a no-op (lockfile already Linux-complete).
- [ ] A prod-dependency break (e.g. a missing `require`) fails a **PR**, not a post-merge QA deploy.
- [ ] `npm audit --omit=dev` shows no undici / uuid findings; xlsx resolved per §5.
- [ ] Migrations run as a discrete pre-start step; a bad migration reads as a failed migrate, never a health-check crash-loop.
- [ ] `main` is branch-protected on the full job matrix incl. docker-build; history is linear.
- [ ] QA auto-deploy after CI is green and stable across ≥5 consecutive merges with no manual intervention.

---

## 7. Suggested execution order (fastest path to stable)

1. **Phase 0** (CRLF + off-OneDrive + local mirror + Linux lockfile) — removes the churn and the blind-push loop. _Biggest single win._
2. **Phase 1.1** (Docker build on PRs) — stops the "breaks only appear on main/QA" class.
3. **Phase 2.1–2.2** (undici + exceljs overrides) — clears the audit log noise in minutes.
4. **Phase 3.2** (migrate-before-boot) — ends the QA crash-loop-on-migration pattern.
5. Everything else as capacity allows.

Do #1 and #2 and the daily whack-a-mole should largely stop; the rest is hardening toward a genuinely hands-off pipeline.
