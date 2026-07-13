# Zedral CI/CD Workflow Audit & Fix List

**Date:** 2026-07-13
**Scope:** `.github/workflows/` (`ci.yml`, `deploy-aws.yml`, `deploy-production.yml`, `deploy-staging.yml`) checked against the actual monorepo (`package.json` workspaces, `Dockerfile`, `deploy/` scripts).

---

## Verdict: Yes, it is deployable

The workflows are **internally consistent and well-engineered**. Every npm script, deploy script, and Dockerfile target they reference actually exists in the repo:

- All CI commands resolve (`lint`, `build`, `test -w @m1/client`, `check:operator-bundle`, `migrate`, `test:unit`, `test:integration`, `arch:check`).
- Dockerfile exposes the `backend` and `nginx` targets the CI build job expects.
- `deploy/lib/common.sh` defines every function the remote deploy scripts call (`run_stack_deploy`, `verify_deployment_health`, `record_successful_deploy`, `validate_env_file`, `require_docker`).
- `docker-compose.prod.yml` consumes `BACKEND_IMAGE` / `NGINX_IMAGE` exactly as the deploy jobs export them.
- Integration tests self-skip if Postgres is unreachable and need **only** Postgres (no SuperTokens in the test path), so CI's single `postgres` service is sufficient.

So this is not "broken YAML." The friction you are hitting comes from a handful of **fragile gates and config/doc mismatches**, listed below by stage with the exact change for each.

---

## The single biggest source of confusion: stale documentation

**`GITHUB_ACTIONS_AUDIT.md` describes a completely different (older) architecture than the workflows that actually ship.**

| Stale doc says | Actual workflow does |
|---|---|
| `runs-on: [self-hosted, linux, zedral]` | `runs-on: ubuntu-latest` (GitHub-hosted) |
| Build on the EC2 VM via `vm-deploy.sh` | CI builds images, pushes to **GHCR**; deploy only *pulls* |
| Cloud runners never SSH in | Deploy jobs **SSH in** via `webfactory/ssh-agent` |
| Secrets: `AWS_GIT_DEPLOY_TOKEN`, `GITHUB_REPO` | Secrets: `AWS_HOST/USER/SSH_KEY`, `GHCR_TOKEN`, `FACTORY_*` |

**Fix:** Delete or rewrite `GITHUB_ACTIONS_AUDIT.md`. If you provisioned infra (self-hosted runner, VM git checkout) by following it, that setup does **not** match the current "build-once-in-GHCR, deploy-many-by-SSH" model — which by itself would produce "too many issues." Provision for the *actual* model instead (see Deploy section).

---

## CI (`ci.yml`)

### C1 — Non-deterministic `npm install -g npm@11` *(High — random CI failures)*
Every run installs the newest npm 11.x from the registry. A bad npm point release, or a registry hiccup, breaks `npm ci` on unrelated commits. This is the same class of "it failed and I changed nothing" failure.

**Fix:** Pin an exact version, in both `ci.yml` and the `Dockerfile`:
```yaml
- name: Upgrade npm (optional-deps fix)
  run: npm install -g npm@11.4.2   # pin exact, bump deliberately
```

### C2 — `npm audit --omit=dev --audit-level=critical` is a blocking gate *(High — random CI failures)*
A new **critical** advisory published upstream will fail CI on a PR that changed nothing related. You already learned this lesson with `high` (that step is non-blocking) — `critical` has the same problem.

**Fix:** Keep the scan but stop it from hard-failing unrelated work. Either make it non-blocking (report only), or pin the failure to *newly introduced* advisories. Minimal change:
```yaml
- name: npm audit (prod critical — report)
  run: npm audit --omit=dev --audit-level=critical || echo "::warning::prod-critical advisory present, review"
```
If you want to keep it blocking, add a documented allowlist file so a fresh upstream CVE can be acknowledged without editing the workflow under pressure.

### C3 — Full Docker build + Trivy runs on every PR *(High — slow + flaky PRs)*
`docker-build-push` `needs: quality`, then builds **two** images and runs Trivy on every `pull_request`, even though it only *pushes* on `push` to main. Result: each PR spends ~40 min building images it throws away, and a **new CRITICAL CVE in a base image fails the PR** (`exit-code: '1'`, `severity: CRITICAL`).

**Fix (recommended):** Only build/scan/push on `push` to `main`; keep PRs to the `quality` gate.
```yaml
docker-build-push:
  needs: quality
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```
**Fix (if you want scan coverage on PRs too):** keep the job on PRs but make Trivy non-blocking there:
```yaml
- name: Trivy scan backend image
  uses: aquasecurity/trivy-action@v0.36.0
  with:
    image-ref: zedral-backend:ci
    exit-code: ${{ github.event_name == 'push' && '1' || '0' }}
    severity: CRITICAL
    ignore-unfixed: true
    trivyignores: .trivyignore
```

### C4 — Only the backend image is Trivy-scanned *(Low)*
The nginx image is built for scan (`load: true`) but never scanned. Minor gap, worth a second Trivy step if you care about the nginx layer.

### C5 — `timeout-minutes: 35` on `quality` + `40` on docker *(Low)*
Fine, but the combined PR cost (build twice, plus 271+ server tests) is why runs feel heavy. Addressing C3 removes most of it.

---

## Docker build / Trivy / GHCR push

### D1 — GHCR push depends on token that may lack scope *(High if push fails)*
Push uses `secrets.GHCR_TOKEN || secrets.GITHUB_TOKEN`. `GITHUB_TOKEN` works **only** because the job sets `permissions: packages: write`. That block is present here — good — but if a `GHCR_TOKEN` PAT is set and it is **read-only** or expired, the `||` fallback never triggers (a set-but-invalid secret is still "truthy"), and the push 401s.

**Fix:** Decide on one auth path. For same-repo pushes, drop the PAT and rely on `GITHUB_TOKEN` + `packages: write` (already granted). If you keep `GHCR_TOKEN`, it must be a PAT with `write:packages`, and confirm the package's visibility/permissions allow it.

### D2 — First-ever production deploy will fail tag inspection *(Medium — expected but surprising)*
`deploy-production.yml` → `resolve-images` runs `docker buildx imagetools inspect …/backend:<tag>`. If CI has never pushed that tag yet, the inspect fails hard. Not a bug, but it looks like one on day one.

**Fix:** Document the order — CI must push images (merge to main) **before** the first `Deploy Production` run. Optionally add a clearer error message around the inspect.

### D3 — `latest-main` has no OCI revision fallback races *(Low)*
The revision-label extraction (`sed -n 's/.*revision:…'`) depends on the label being present. It is set in CI's build labels — good — but if someone pushes a tag out-of-band without that label, checkout silently falls back to the workflow SHA. Acceptable; just be aware.

---

## Deploy (AWS QA `deploy-aws.yml` + Production `deploy-production.yml`)

### E1 — `ssh-keyscan` assumes port 22 *(Medium if non-standard port)*
```yaml
run: ssh-keyscan -H "${AWS_HOST}" >> ~/.ssh/known_hosts
```
If either server listens on a non-standard SSH port, keyscan records nothing and every subsequent `ssh`/`rsync` fails host-key verification.

**Fix:** Add a port secret and use it:
```yaml
run: ssh-keyscan -p "${AWS_SSH_PORT:-22}" -H "${AWS_HOST}" >> ~/.ssh/known_hosts
```
…and pass `-p` to the `ssh`/`rsync` calls (`rsync -e "ssh -p ${PORT}"`). Do the same in `deploy-production.yml`.

### E2 — Auto-rollback is a no-op on the first failed deploy *(Medium)*
`rollback-images.sh` restores `deploy/.previous-good-images`. On the very first deploy there is no previous checkpoint, so a failed first deploy "rolls back" to nothing and the health check still fails — looks like the rollback is broken.

**Fix:** Have `rollback-images.sh` detect a missing checkpoint and emit a clear message ("no previous image to roll back to — this is the first deploy") instead of failing opaquely. Logic change in the script, not the workflow.

### E3 — Environment-scoped secrets must exist at the right level *(High — most likely your deploy failures)*
Deploy jobs declare `environment: staging` / `environment: production`. Secrets referenced in those jobs are resolved from **that environment first**. If you added `AWS_HOST`, `FACTORY_HOST`, etc. only as **repo** secrets and never created the `staging` / `production` environments (or created the environments but put the secrets at repo level with an environment that shadows them), the preflight step fails with "Missing secrets."

**Fix / checklist:** Settings → Environments → create `staging` and `production`. Put the deploy secrets there:
- **staging:** `AWS_HOST` (or `AWS_EC2_HOST`), `AWS_USER`, `AWS_SSH_KEY`, `AWS_APP_DIR`, `AWS_PUBLIC_URL`, `SMOKE_BADGE_ID`, `SMOKE_PIN`, `DEPLOY_WEBHOOK_URL`.
- **production:** `FACTORY_HOST`, `FACTORY_USER`, `FACTORY_SSH_KEY`, `FACTORY_APP_DIR`, `FACTORY_PUBLIC_URL`, `SMOKE_BADGE_ID`, `SMOKE_PIN`, `DEPLOY_WEBHOOK_URL`.
- **repo-level (shared):** `GHCR_TOKEN` (if used).

Do **not** enable required reviewers on the environments (the workflow comments confirm this is intentional for GitHub Free).

### E4 — `deploy-aws.yml` auto-trigger only fires from `push`-to-main CI *(By design — verify expectation)*
The `workflow_run` deploy only proceeds when `workflow_run.conclusion == 'success'` **and** `head_branch == 'main'`. PR CI runs never deploy (correct), and images are only pushed on push-to-main (correct), so the two line up. If you expected QA to deploy from a branch or a PR, it never will — that is intentional, not a bug.

### E5 — Production smoke default is `skip_smoke: 'true'` *(Low — intentional)*
Production smoke is off by default (needs `FACTORY_PUBLIC_URL`). Fine, but it means a "successful" production deploy has had no end-to-end check unless you flip it on. Turn `skip_smoke=false` once `FACTORY_PUBLIC_URL` is set.

### E6 — `deploy-staging.yml` intentionally fails *(No action)*
It is a retired stub that exits 1 to redirect operators to `deploy-aws.yml`. If you see this "failing," that is expected — it is a signpost, not a deploy.

---

## Priority order to get green

1. **E3** — create `staging` + `production` environments and place the SSH/host secrets there. (Most likely cause of deploy preflight failures.)
2. **Delete/rewrite `GITHUB_ACTIONS_AUDIT.md`** and provision infra for the GHCR-pull model, not the old self-hosted-runner model.
3. **C3** — gate the Docker build/Trivy/push job to `push` on `main` (kills most PR flakiness and cost).
4. **C1 + C2** — pin `npm@<exact>`; make the critical `npm audit` non-blocking (kills "random" CI reds).
5. **D1** — settle GHCR auth on one path (`GITHUB_TOKEN` + `packages: write`, or a valid `write:packages` PAT).
6. **E1** — add SSH port handling if either server uses a non-standard port.
7. **E2** — friendlier first-deploy rollback message.

Items 1–4 alone should turn the pipeline from "too many issues" to reliably green. None of them require changing your application code — they are workflow gates and GitHub config.
