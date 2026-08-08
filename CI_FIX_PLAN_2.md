# CI Failure — Audit, Analysis & Fix Plan (Run 2)

**Scope:** Analysis only. No code changed. Covers the failures in the latest run, which is *after* commit `b0214db` ("Fix four CI blockers…") — the first plan's four fixes have already landed. These are the next failures behind them.

## Summary

| # | Job / workflow | Symptom | Root cause | Blocking? | Nature |
|---|----------------|---------|------------|-----------|--------|
| A | `integration` (and any job running the native-bindings step) | `npm error code ECONNRESET … network aborted` during `ensure-native-bindings.mjs` → exit 1 | Every CI run does a **live `npm install`** of `@esbuild/linux-x64` with no retry/timeout; a transient registry blip kills the job | Yes (intermittent) | Infra fragility |
| B | `runner-health` → *Check self-hosted runners* | `remote: Repository not found` on `actions/checkout`, exit 128 | Job's `permissions:` block lists only `actions: read`, so `contents` defaults to **none** — checkout can't read the repo | Yes (this workflow) | Config bug |
| C | `audit` (npm audit report) | 21 advisories (1 critical, 14 high, 5 moderate, 1 low) | Vulnerable deps: `postcss`, `react-router(-dom)`, `tar`, `supertokens-node`→`nodemailer` | No (report-only, `|| true`) | Security hygiene |
| — | All jobs | "Node.js 20 is deprecated … forced to run on Node.js 24" | Actions pinned to Node20 runtime; GitHub now forces Node24 | No (warning) | Hygiene |
| — | `lint` | "Fast refresh only works when a file only exports components" | Client files export non-components alongside components | No (warning) | Hygiene |

Issue A is the one that failed the current pipeline; it is **intermittent** and will keep recurring at random until the live network install is removed. Issue B fails the scheduled `runner-health` workflow every time. Issue C did not fail CI (the job is non-blocking) but carries a critical advisory worth clearing.

---

## Issue A — `ensure-native-bindings.mjs` fails with `ECONNRESET` (network)

**Symptom**
```
[ensure-native-bindings] installing for linux-gnu: @esbuild/linux-x64@0.21.5
…
npm error code ECONNRESET
npm error network aborted
Error: Process completed with exit code 1
```
Only `@esbuild/linux-x64` was reported missing; the other four natives (rolldown/rollup/lightningcss/oxide) were already present.

**Root cause**
- `scripts/ensure-native-bindings.mjs` checks each platform-native optional dep via `require.resolve`; if missing it runs `npm install --no-save --no-package-lock <pkg>` at CI time (lines 90–94). That is a **live network call on every run**, and it is **not hardened**: no `fetch-retries`, no timeout, no retry loop, no `--prefer-offline`. A single transient `ECONNRESET` from the registry fails the whole step — and the step is a required early step in `lint`, `build`, `unit`, `integration`, and `arch`.
- Why the live install is even triggered: `@esbuild/linux-x64@0.21.5` **is** in `package-lock.json` (marked `optional: true`, `os: linux`, `cpu: x64`), but `npm ci` does not materialise it into `node_modules/@esbuild/linux-x64` on the Linux runner. The lockfile is Windows-authored (the script's own header cites npm/cli#4828), and the tree carries a **split esbuild**: root pins `esbuild@0.21.5` (needs `@esbuild/linux-x64@0.21.5`) while `tsx` nests `esbuild@0.28.0` (needs `@esbuild/linux-x64@0.28.0`). npm skips the 0.21.5 native, so the workaround script fetches it live — every run.
- Net: correctness depends on a network round-trip that isn't retried. This is why the failure is intermittent rather than deterministic.

**Fix options** (root-cause first, per "no patch work")

- **A1 (recommended) — make the native deterministic so the live install disappears.** Get `@esbuild/linux-x64` materialised by `npm ci` so `ensure-native-bindings` becomes a pure verifier that never touches the network. Approaches, best first:
  - Regenerate/normalise `package-lock.json` so Linux + Windows natives are both recorded and installable cross-platform (generate on Linux, or `npm install --package-lock-only` with `--os=linux --cpu=x64` then commit). Verify `npm ci` on a clean Linux checkout leaves `node_modules/@esbuild/linux-x64` present with **no** follow-up install.
  - Or resolve the esbuild version split (align `tsx`/root on one esbuild major via an `overrides` entry) so a single esbuild + its native is installed deterministically.
- **A2 (defense-in-depth, pair with A1) — harden the fallback install.** Add a root `.npmrc` with `fetch-retries=5`, `fetch-retry-mintimeout=20000`, `fetch-retry-maxtimeout=120000`, `fetch-timeout=300000`, and wrap the `spawnSync` in a small retry loop with `--prefer-offline`. This makes any *remaining* live install survive a transient blip and reuse the warm `~/.npm` cache that `actions/setup-node` already restores. Keep even after A1, as a safety net.
- **A3 (weakest, not recommended alone) — `continue-on-error` on the step.** Masks the failure; the client build would then fail later, deeper in the pipeline. Explicitly rejected as patch work.

**Recommendation:** A1 as the actual fix, plus A2 as a permanent safety net. Do **not** ship A3.

**Verification**
- On a clean Linux checkout: `npm ci` then `node scripts/ensure-native-bindings.mjs` prints `OK (linux-gnu)` with **no** install line (confirms no network needed).
- Re-run the `integration` job 3–5× to confirm the intermittent ECONNRESET no longer appears.
- Confirm `npm run build -w @m1/client` still succeeds (the natives are what the client build needs).

---

## Issue B — `runner-health`: `actions/checkout` fails "Repository not found" (exit 128)

**Symptom**
```
remote: Repository not found.
fatal: repository 'https://github.com/kshitijsince2004/hsl_zedral/' not found
Error: The process '/usr/bin/git' failed with exit code 128
```
The repo exists (it is `origin`, and every other job checks it out fine in the same period), so this is not a deletion/rename.

**Root cause**
- `.github/workflows/runner-health.yml` sets a job-level `permissions:` block containing **only** `actions: read` (lines 14–15). GitHub's rule: once you specify *any* permission scope, every unspecified scope is set to **none**. So `contents` is `none`.
- `actions/checkout` needs `contents: read` to clone. With `contents: none`, the token is unauthorised and GitHub masks the 403 as **"Repository not found"** (404) — the same footgun class as the gitleaks `pull-requests: read` fix in Run 1, just a different scope.
- Secondary (next failure after checkout is fixed): the step `gh api repos/…/actions/runners` lists **self-hosted runners**, which requires the **`administration: read`** permission — not covered by `actions: read`. Under `set -euo pipefail` this will fail the job with a 403 once checkout succeeds.

**Fix options**

- **B1 (recommended) — grant the scopes the job actually uses:**
  ```yaml
      permissions:
        contents: read        # actions/checkout
        administration: read  # GET /repos/{}/actions/runners (self-hosted runner list)
  ```
  Drop `actions: read` (unused here). This fixes both the checkout and the pending runners-API 403 in one change.
- **B2 — avoid checkout entirely.** The runner list only needs `gh api`; the checkout exists to reach `deploy/scripts/notify-deploy.sh`. If that notify path is inlined (curl to `DEPLOY_WEBHOOK_URL`), the `contents: read`/checkout requirement goes away, leaving just `administration: read`. Smaller attack surface, slightly more YAML.
- **Note on tokens:** if repo self-hosted-runner administration is restricted at the org level, the default `GITHUB_TOKEN` may still be denied the runners endpoint even with `administration: read`; in that case a fine-grained PAT with *Administration: read* is required. Verify after B1; escalate to a PAT only if the 403 persists.

**Recommendation:** B1. Re-run via `workflow_dispatch` to validate without waiting for the 6-hour cron.

**Verification**
- Manually dispatch `Runner health`; checkout succeeds and the step prints the runner table (or the intended "offline" warning), not exit 128.

---

## Issue C — npm audit: 21 advisories (1 critical / 14 high) — non-blocking

**Status:** The `audit` job is report-only (`|| true`, writes to the step summary) and did **not** fail CI. Included because "no patch work" implies clearing the debt properly rather than ignoring it.

**Named advisories in the log**
- `postcss <=8.5.22` (high) — path traversal via `sourceMappingURL`. **Fix available** (`npm audit fix`), non-breaking.
- `react-router 6.0.0–8.2.0` / `react-router-dom` (high, multiple: open redirect, XSS, DoS, CSRF). **Fix available**; confirm whether it stays within v6 or needs a v7 bump — treat as a deliberate dependency upgrade, not `--force`.
- `tar <=7.5.20` (moderate) — uncontrolled recursion DoS. **Fix available**; note the root `overrides` already pins `tar@7.5.19`, so bump that override.
- `supertokens-node >=9.3.0` → depends on vulnerable `nodemailer` (transitive). Needs a `supertokens-node` upgrade or a targeted `overrides` on `nodemailer`; verify auth flows after.
- The **1 critical** is not named in the high+ excerpt — run `npm audit --omit=dev --audit-level=critical` locally to identify and prioritise it first.

**Fix options**

- **C1 (recommended) — staged remediation, verified per group:** (1) `npm audit fix` for the non-breaking set (`postcss`, `tar` override bump); (2) evaluate `react-router`/`react-router-dom` as an intentional minor/major upgrade with a client smoke + e2e pass; (3) address `nodemailer`-via-`supertokens-node` by upgrading supertokens (preferred) or a scoped `overrides` (stopgap) with an auth smoke; (4) identify and clear the critical explicitly. Re-run `npm audit` to confirm counts drop.
- **C2 — keep report-only, triage later.** Acceptable since the job is non-blocking, but leaves a critical advisory outstanding. If chosen, at least resolve the single critical now.

**Recommendation:** C1, sequenced so each dependency bump is verified independently (avoids `npm audit fix --force` regressions).

---

## Hygiene (non-blocking, no failure — batch when convenient)

- **Node 20 → forced Node 24:** `actions/checkout@v4`, `actions/setup-node@v4`, `gitleaks/gitleaks-action@v2` still declare the Node20 runtime and GitHub is force-running them on Node24. Bump these actions to their current major/patch that ships the Node24 runtime to silence the warnings and de-risk the eventual removal. The composite `setup-node-npm` still pins **Node 20** for the toolchain itself (`node-version: 20`) — separate concern; the `@capacitor/cli@8.5.0` EBADENGINE warning wants Node ≥22, so a future Node bump for the build is worth planning but is not urgent.
- **Lint fast-refresh warnings:** files like `MachineHeadDashboardPanels.tsx`, `RouteSpinner.tsx`, `ProcessPairedField.tsx` export constants/functions next to components. Move shared non-component exports into sibling files to clear the `react-refresh/only-export-components` warnings. Cosmetic; the `lint` job passed.

---

## Suggested rollout order

1. **Issue B** — two-line `permissions` change; unblocks the scheduled `runner-health` workflow immediately (validate via `workflow_dispatch`).
2. **Issue A** — the intermittent pipeline-killer. Land A1 (deterministic native) + A2 (`.npmrc` retries) together; verify with repeated integration re-runs.
3. **Issue C** — staged dependency remediation; start with the single critical, then the `audit fix`-able set.
4. **Hygiene** — action version bumps and lint refactors, batched separately.

**Risk:** B is trivial and mirrors an existing pattern. A1 touches the lockfile — verify `npm ci` on both Linux and Windows still resolves cleanly before merge; A2 is additive and safe. C should be staged so each bump is independently smoke-tested. Hygiene items are cosmetic.

**Cross-cutting note:** Issues B (Run 2) and gitleaks (Run 1) are the **same root cause** — an explicit `permissions:` block that omits a scope a step needs. Consider a repo convention: whenever a job declares `permissions`, it must include `contents: read` if it checks out, and audit each `permissions` block against the APIs its steps call.
