# Spec: Fix all CI/CD audit issues + move deploy to self-hosted runners

**Audience:** IDE coding agent (Cursor / Copilot / Claude Code).
**Repo:** `hsl_zedral` (monorepo, `npm workspaces`).
**Two goals in one pass:**
1. Fix every issue from the workflow audit (CI reliability, Docker/GHCR, deploy).
2. Convert the deploy pipeline to **self-hosted runners on each server, deploying locally (no SSH)**.

Apply everything below exactly. Only workflow files, `deploy/setup-github-runner.sh`, `deploy/scripts/rollback-images.sh`, and two docs change. Do **not** modify application code, `Dockerfile`, `docker-compose.prod.yml`, or `deploy/lib/common.sh`.

---

## Fixed decisions (do not re-derive)

- **CI stays GitHub-hosted** (`ubuntu-latest`). Only *reliability* fixes are applied to `ci.yml`.
- **Deploy runs locally on a self-hosted runner that lives on each server.** Remove all SSH (`webfactory/ssh-agent`, `ssh-keyscan`, `ssh user@host`, rsync-over-SSH). `rsync` becomes a local copy into `APP_DIR`.
- **Two runners**, one per server, by label: AWS QA → `aws-qa`; Factory → `factory`.
- **GHCR auth = `GITHUB_TOKEN`** with job `permissions.packages` (read for pull, write for push). Drop the `GHCR_TOKEN` PAT fallback — a set-but-invalid PAT silently wins over `GITHUB_TOKEN` (audit D1). Use a PAT only for a cross-org registry (documented at the end).
- **QA** smoke stays GitHub-hosted (hits `https://qa.zedral.com` via Cloudflare). **Factory** is **LAN-only**, so its smoke runs on the self-hosted Factory runner against `http://127.0.0.1` — no internet exposure, no Cloudflare. A separate self-hosted job rolls back on smoke failure in both.

---

## Files to change

| File | Action | Fixes |
|------|--------|-------|
| `.github/workflows/ci.yml` | Targeted edits (Part 1) | C1, C2, C3, C4, D1 |
| `.github/workflows/deploy-aws.yml` | Full replace (Part 2) | D1, E1, E3, E4, self-hosted |
| `.github/workflows/deploy-production.yml` | Full replace (Part 3) | D1, D2, E1, E3, E5, self-hosted |
| `.github/workflows/deploy-staging.yml` | Leave as-is | E6 (intentional retired stub) |
| `deploy/scripts/rollback-images.sh` | One-line edit (Part 4) | E2 |
| `deploy/setup-github-runner.sh` | Full replace (Part 5) | self-hosted |
| `GITHUB_ACTIONS_AUDIT.md` | Rewrite architecture (Part 6) | stale-doc |
| `deploy/README.md` | Update runner section (Part 6) | stale-doc |

---

## Part 1 — `ci.yml` reliability fixes (GitHub-hosted, unchanged runner)

### 1a. C1 — pin npm exactly (both CI and Dockerfile use `npm@11`)
Find:
```yaml
      - name: Upgrade npm (optional-deps fix)
        run: npm install -g npm@11
```
Replace with (pin an exact version; bump deliberately, not every run):
```yaml
      - name: Upgrade npm (optional-deps fix)
        run: npm install -g npm@11.4.2
```
> The `Dockerfile` also runs `npm install -g npm@11` (two places). Pin those to the **same** `11.4.2` for build parity. (Dockerfile edit permitted only for this pin.)

### 1b. C2 — make the prod-critical `npm audit` non-blocking (report only)
Find:
```yaml
      - name: npm audit (prod critical — blocking)
        run: npm audit --omit=dev --audit-level=critical
```
Replace with:
```yaml
      - name: npm audit (prod critical — report, non-blocking)
        run: |
          npm audit --omit=dev --audit-level=critical 2>&1 | tee audit-critical.txt || true
          if grep -q 'critical' audit-critical.txt; then
            echo "::warning::Prod-critical advisory present — review audit-critical.txt (not blocking the build)."
          fi
```
> Rationale: a freshly-published upstream CVE must not red-fail unrelated PRs. Security review happens via the report + the Trivy image scan, not a hard npm gate.

### 1c. C3 — only build/scan/push Docker images on push to `main`
On the `docker-build-push` job, add an `if` so PRs stop doing two throwaway image builds + a blocking Trivy scan:
```yaml
  docker-build-push:
    name: Docker build · Trivy · Push GHCR
    runs-on: ubuntu-latest
    needs: quality
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    timeout-minutes: 40
    permissions:
      contents: read
      packages: write
```
> This removes the "new base-image CRITICAL CVE fails an unrelated PR" problem and cuts PR time. PRs keep the full `quality` gate (lint/build/test/arch). Since the whole job now only runs on `main` push, the per-step `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` guards on the Login and Push steps are now redundant but harmless — leave them.

### 1d. C4 — also Trivy-scan the nginx image (optional but recommended)
After the existing "Trivy scan backend image" step, add:
```yaml
      - name: Trivy scan nginx image
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: zedral-nginx:ci
          format: table
          exit-code: '1'
          severity: CRITICAL
          ignore-unfixed: true
          trivyignores: .trivyignore
```

### 1e. D1 — GHCR login uses GITHUB_TOKEN
In `ci.yml`'s "Login to GHCR" step, change the password line:
```yaml
          password: ${{ secrets.GITHUB_TOKEN }}
```
(The job already has `permissions: packages: write`, which is what `GITHUB_TOKEN` needs to push.)

**No other CI changes.** `quality` job, services, migrations, unit/integration/arch steps stay exactly as they are.

---

## Part 2 — full replacement for `.github/workflows/deploy-aws.yml`

```yaml
name: Deploy AWS QA

# Self-hosted runner model: the runner lives ON the AWS QA server.
# Deploy runs docker/compose LOCALLY on that box — no SSH, ssh-agent, keyscan, or rsync-over-SSH.
# Still pull-only: uses the SAME commit SHA images CI pushed to GHCR. Never builds source.

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      image_tag:
        description: GHCR image tag (git SHA). Leave empty to use latest-main.
        required: false
        type: string
        default: ''
      skip_migrate:
        description: Skip DB migrations
        required: false
        default: 'false'
        type: choice
        options: ['false', 'true']
      skip_smoke:
        description: Skip Playwright smoke tests
        required: false
        default: 'false'
        type: choice
        options: ['false', 'true']

concurrency:
  group: deploy-aws-qa
  cancel-in-progress: false

env:
  IMAGE_PREFIX: ghcr.io/${{ github.repository }}

jobs:
  # ── Resolve which GHCR tag to deploy (GitHub-hosted; only needs GHCR API) ─────
  resolve:
    name: Resolve CI image tag
    runs-on: ubuntu-latest
    if: |
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'workflow_run' &&
       github.event.workflow_run.conclusion == 'success' &&
       github.event.workflow_run.head_branch == 'main')
    outputs:
      image_tag: ${{ steps.meta.outputs.tag }}
      backend_image: ${{ steps.meta.outputs.backend }}
      nginx_image: ${{ steps.meta.outputs.nginx }}
      commit_sha: ${{ steps.meta.outputs.sha }}
    permissions:
      contents: read
      packages: read

    steps:
      - name: Login to GHCR (for OCI revision on non-SHA tags)
        if: github.event_name == 'workflow_dispatch'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Resolve tag from CI or dispatch
        id: meta
        run: |
          set -euo pipefail
          if [ "${{ github.event_name }}" = "workflow_run" ]; then
            TAG="${{ github.event.workflow_run.head_sha }}"
            SHA="${TAG}"
          elif [ -n "${{ github.event.inputs.image_tag }}" ]; then
            TAG="${{ github.event.inputs.image_tag }}"
            if [[ "${TAG}" =~ ^[0-9a-f]{40}$ ]]; then
              SHA="${TAG}"
            else
              SHA="$(docker buildx imagetools inspect "${IMAGE_PREFIX}/backend:${TAG}" 2>/dev/null \
                | sed -n 's/.*org\.opencontainers\.image\.revision: *\([0-9a-f]\{40\}\).*/\1/p' \
                | head -1 || true)"
              if [ -z "${SHA}" ]; then
                SHA="${{ github.sha }}"
                echo "::warning::No OCI revision on tag=${TAG}; using workflow SHA ${SHA}"
              fi
            fi
          else
            TAG="latest-main"
            SHA="$(docker buildx imagetools inspect "${IMAGE_PREFIX}/backend:latest-main" 2>/dev/null \
              | sed -n 's/.*org\.opencontainers\.image\.revision: *\([0-9a-f]\{40\}\).*/\1/p' \
              | head -1 || true)"
            if [ -z "${SHA}" ]; then
              SHA="${{ github.sha }}"
            fi
          fi
          echo "tag=${TAG}" >> "$GITHUB_OUTPUT"
          echo "sha=${SHA}" >> "$GITHUB_OUTPUT"
          echo "backend=${IMAGE_PREFIX}/backend:${TAG}" >> "$GITHUB_OUTPUT"
          echo "nginx=${IMAGE_PREFIX}/nginx:${TAG}" >> "$GITHUB_OUTPUT"
          echo "Deploying backend=${IMAGE_PREFIX}/backend:${TAG} (checkout ${SHA})"

  # ── Deploy runs ON the AWS QA box (self-hosted runner, label: aws-qa) ─────────
  deploy:
    name: Deploy to AWS QA (self-hosted)
    needs: resolve
    runs-on: [self-hosted, linux, aws-qa]
    timeout-minutes: 30
    environment: staging
    permissions:
      contents: read
      packages: read

    steps:
      - name: Checkout deploy scripts
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.resolve.outputs.commit_sha }}

      - name: Resolve APP_DIR
        id: appdir
        env:
          APP_DIR: ${{ secrets.AWS_APP_DIR }}
        run: |
          if [ -z "${APP_DIR:-}" ] || [ "${APP_DIR}" = "/" ]; then APP_DIR="/opt/zedral"; fi
          echo "dir=${APP_DIR}" >> "$GITHUB_OUTPUT"
          echo "APP_DIR=${APP_DIR}"

      - name: Notify started
        env:
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          bash deploy/scripts/notify-deploy.sh started \
            "AWS QA deploy tag=${{ needs.resolve.outputs.image_tag }}"

      - name: Login to GHCR (local docker daemon)
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Sync deploy/ into APP_DIR (preserve remote .env + checkpoints)
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
        run: |
          set -euo pipefail
          mkdir -p "${APP_DIR}/deploy"
          rsync -az --delete \
            --exclude '.env' \
            --exclude '.last-good-*' \
            --exclude '.previous-good-*' \
            ./deploy/ "${APP_DIR}/deploy/"

      - name: Pull GHCR images · compose up · migrate
        id: deploy
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
          BACKEND_IMAGE: ${{ needs.resolve.outputs.backend_image }}
          NGINX_IMAGE: ${{ needs.resolve.outputs.nginx_image }}
          SKIP_MIGRATE: ${{ github.event.inputs.skip_migrate == 'true' && 'true' || 'false' }}
        run: |
          set -euo pipefail
          export BACKEND_IMAGE NGINX_IMAGE SKIP_MIGRATE \
                 APP_BASE="${APP_DIR}" RUN_BACKUP=false
          bash "${APP_DIR}/deploy/scripts/remote-ghcr-deploy.sh"

      - name: Local health check (curl /health)
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
        run: |
          set -euo pipefail
          for attempt in 1 2 3 4 5 6; do
            if curl -fsS http://127.0.0.1/health | head -c 200; then
              echo ''; echo 'Health check passed'; exit 0
            fi
            echo "Attempt ${attempt}/6 failed — retrying in 10s…"
            sleep 10
          done
          echo 'Health check failed'
          docker compose -f "${APP_DIR}/deploy/docker-compose.prod.yml" \
            --env-file "${APP_DIR}/deploy/.env" logs --tail 80 backend nginx || true
          exit 1

      - name: Collect logs on failure
        if: failure()
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
        run: |
          mkdir -p artifacts
          docker compose -f "${APP_DIR}/deploy/docker-compose.prod.yml" \
            --env-file "${APP_DIR}/deploy/.env" logs --tail 200 backend nginx db \
            > artifacts/docker-logs.txt || true

      - name: Upload failure logs
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: aws-qa-deploy-logs
          path: artifacts/
          if-no-files-found: ignore

      - name: Auto rollback images on deploy failure
        if: failure()
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          export APP_BASE="${APP_DIR}"
          bash "${APP_DIR}/deploy/scripts/rollback-images.sh" || true
          bash deploy/scripts/notify-deploy.sh rollback \
            "AWS QA auto-rollback after deploy failure (${{ needs.resolve.outputs.image_tag }})"

  # ── Smoke stays GitHub-hosted: only needs network to the public URL ──────────
  smoke:
    name: Playwright smoke tests
    needs: [resolve, deploy]
    if: ${{ github.event_name != 'workflow_dispatch' || github.event.inputs.skip_smoke != 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 25
    environment: staging

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.resolve.outputs.commit_sha }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: e2e/package-lock.json

      - name: Install e2e deps
        working-directory: e2e
        run: npm ci

      - name: Install Playwright browsers
        working-directory: e2e
        run: npx playwright install --with-deps chromium

      - name: Run smoke suite
        working-directory: e2e
        env:
          BASE_URL: ${{ secrets.AWS_PUBLIC_URL }}
          SMOKE_BADGE_ID: ${{ secrets.SMOKE_BADGE_ID }}
          SMOKE_PIN: ${{ secrets.SMOKE_PIN }}
        run: |
          if [ -z "${BASE_URL}" ]; then
            echo "::error::AWS_PUBLIC_URL secret required for Playwright smoke"
            exit 1
          fi
          npx playwright test --reporter=list,html,json

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-smoke-report
          path: e2e/playwright-report/
          if-no-files-found: ignore

  # ── Rollback on smoke failure runs ON the box (self-hosted; no SSH needed) ────
  rollback-on-smoke-failure:
    name: Rollback QA on smoke failure
    needs: [resolve, deploy, smoke]
    if: ${{ failure() && needs.deploy.result == 'success' }}
    runs-on: [self-hosted, linux, aws-qa]
    environment: staging
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.resolve.outputs.commit_sha }}

      - name: Roll back to previous images (local)
        env:
          APP_DIR: ${{ secrets.AWS_APP_DIR }}
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          set -euo pipefail
          if [ -z "${APP_DIR:-}" ] || [ "${APP_DIR}" = "/" ]; then APP_DIR="/opt/zedral"; fi
          export APP_BASE="${APP_DIR}"
          bash "${APP_DIR}/deploy/scripts/rollback-images.sh" || true
          bash deploy/scripts/notify-deploy.sh rollback \
            "AWS QA rolled back after smoke failure (${{ needs.resolve.outputs.image_tag }})"

  # ── Report (GitHub-hosted) ───────────────────────────────────────────────────
  report:
    name: QA deployment report
    needs: [resolve, deploy, smoke]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Write report
        env:
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          mkdir -p artifacts
          {
            echo "# AWS QA deployment report"
            echo ""
            echo "- Image tag: \`${{ needs.resolve.outputs.image_tag }}\`"
            echo "- Backend: \`${{ needs.resolve.outputs.backend_image }}\`"
            echo "- Nginx: \`${{ needs.resolve.outputs.nginx_image }}\`"
            echo "- Deploy: \`${{ needs.deploy.result }}\`"
            echo "- Smoke: \`${{ needs.smoke.result }}\`"
            echo "- Time: $(date -u -Is)"
            echo ""
            echo "Ready for manual QA. When satisfied, open **Actions → Deploy Production (Factory) → Run workflow** with the same SHA (or \`latest-main\` / \`vX.Y.Z\`)."
          } > artifacts/qa-report.md
          cat artifacts/qa-report.md

          if [ "${{ needs.deploy.result }}" = "success" ] && { [ "${{ needs.smoke.result }}" = "success" ] || [ "${{ needs.smoke.result }}" = "skipped" ]; }; then
            bash deploy/scripts/notify-deploy.sh success "AWS QA OK ${{ needs.resolve.outputs.image_tag }}"
          else
            bash deploy/scripts/notify-deploy.sh failed "AWS QA FAILED tag=${{ needs.resolve.outputs.image_tag }} deploy=${{ needs.deploy.result }} smoke=${{ needs.smoke.result }}"
            exit 1
          fi

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: aws-qa-deployment-report
          path: artifacts/qa-report.md
```

---

## Part 3 — full replacement for `.github/workflows/deploy-production.yml`

```yaml
name: Deploy Production (Factory)

# Self-hosted runner model: the runner lives ON the Factory production server.
# Manual gate = Actions → Deploy Production (Factory) → Run workflow.
# Never builds. Pulls whatever GHCR tag you enter (SHA / latest-main / vX.Y.Z) and
# runs docker/compose LOCALLY on the Factory box — no SSH, ssh-agent, keyscan, or rsync-over-SSH.

on:
  workflow_dispatch:
    inputs:
      image_tag:
        description: 'GHCR tag to deploy (latest-main | full git SHA | v1.3.0)'
        required: true
        type: string
        default: latest-main
      promote_as:
        description: 'Optional — also tag this digest as SemVer (e.g. v1.3.0) before deploy'
        required: false
        type: string
        default: ''
      skip_migrate:
        description: Skip DB migrations
        required: false
        default: 'false'
        type: choice
        options: ['false', 'true']
      skip_smoke:
        description: Skip Playwright smoke (needs FACTORY_PUBLIC_URL)
        required: false
        default: 'true'
        type: choice
        options: ['false', 'true']

concurrency:
  group: deploy-production
  cancel-in-progress: false

env:
  IMAGE_PREFIX: ghcr.io/${{ github.repository }}

jobs:
  # ── Resolve / optional promote (GitHub-hosted; only needs GHCR API) ───────────
  resolve-images:
    name: Resolve image tag (no rebuild)
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      backend_image: ${{ steps.meta.outputs.backend }}
      nginx_image: ${{ steps.meta.outputs.nginx }}
      image_tag: ${{ steps.meta.outputs.tag }}
      checkout_ref: ${{ steps.meta.outputs.checkout }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Resolve / optional promote
        id: meta
        run: |
          set -euo pipefail
          SRC="$(echo -n '${{ github.event.inputs.image_tag }}' | tr -d '[:space:]')"
          PROMOTE="$(echo -n '${{ github.event.inputs.promote_as }}' | tr -d '[:space:]')"
          if [ -z "${SRC}" ]; then
            echo "::error::image_tag is empty"
            exit 1
          fi

          # D2: clear, actionable error if the tag was never pushed by CI
          echo "Inspecting source images for tag=${SRC}"
          if ! docker buildx imagetools inspect "${IMAGE_PREFIX}/backend:${SRC}" >/dev/null 2>&1; then
            echo "::error::${IMAGE_PREFIX}/backend:${SRC} not found in GHCR. Has CI pushed this tag yet? Merge to main (CI pushes SHA + latest-main) before deploying."
            exit 1
          fi
          docker buildx imagetools inspect "${IMAGE_PREFIX}/nginx:${SRC}" >/dev/null

          DEPLOY_TAG="${SRC}"
          if [ -n "${PROMOTE}" ]; then
            echo "Promoting ${SRC} → ${PROMOTE} (identical digests, no rebuild)"
            docker buildx imagetools create \
              --tag "${IMAGE_PREFIX}/backend:${PROMOTE}" \
              "${IMAGE_PREFIX}/backend:${SRC}"
            docker buildx imagetools create \
              --tag "${IMAGE_PREFIX}/nginx:${PROMOTE}" \
              "${IMAGE_PREFIX}/nginx:${SRC}"
            DEPLOY_TAG="${PROMOTE}"
          fi

          CHECKOUT=""
          if [[ "${SRC}" =~ ^[0-9a-f]{40}$ ]]; then
            CHECKOUT="${SRC}"
          else
            CHECKOUT="$(docker buildx imagetools inspect "${IMAGE_PREFIX}/backend:${SRC}" 2>/dev/null \
              | sed -n 's/.*org\.opencontainers\.image\.revision: *\([0-9a-f]\{40\}\).*/\1/p' \
              | head -1 || true)"
            if [ -z "${CHECKOUT}" ]; then
              CHECKOUT="${{ github.sha }}"
              echo "::warning::No OCI revision on tag=${SRC}; checking out workflow SHA ${CHECKOUT}"
            fi
          fi

          echo "tag=${DEPLOY_TAG}" >> "$GITHUB_OUTPUT"
          echo "checkout=${CHECKOUT}" >> "$GITHUB_OUTPUT"
          echo "backend=${IMAGE_PREFIX}/backend:${DEPLOY_TAG}" >> "$GITHUB_OUTPUT"
          echo "nginx=${IMAGE_PREFIX}/nginx:${DEPLOY_TAG}" >> "$GITHUB_OUTPUT"
          echo "Factory will pull tag=${DEPLOY_TAG} (checkout ${CHECKOUT})"

      - name: Notify started
        env:
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          bash deploy/scripts/notify-deploy.sh started \
            "Production (manual) tag=${{ steps.meta.outputs.tag }} → Factory"

  # ── Deploy runs ON the Factory box (self-hosted runner, label: factory) ───────
  deploy-factory:
    name: Deploy to Factory (self-hosted)
    needs: resolve-images
    runs-on: [self-hosted, linux, factory]
    timeout-minutes: 45
    environment: production
    permissions:
      contents: read
      packages: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.resolve-images.outputs.checkout_ref }}

      - name: Resolve APP_DIR
        id: appdir
        env:
          APP_DIR: ${{ secrets.FACTORY_APP_DIR }}
        run: |
          if [ -z "${APP_DIR:-}" ] || [ "${APP_DIR}" = "/" ]; then APP_DIR="/opt/zedral"; fi
          echo "dir=${APP_DIR}" >> "$GITHUB_OUTPUT"
          echo "APP_DIR=${APP_DIR}"

      - name: Login to GHCR (local docker daemon)
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Sync deploy/ into APP_DIR (preserve .env + image checkpoints)
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
        run: |
          set -euo pipefail
          mkdir -p "${APP_DIR}/deploy"
          rsync -az --delete \
            --exclude '.env' \
            --exclude '.last-good-*' \
            --exclude '.previous-good-*' \
            ./deploy/ "${APP_DIR}/deploy/"

      - name: Backup DB · verify · pull images · deploy (local)
        id: deploy
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
          BACKEND_IMAGE: ${{ needs.resolve-images.outputs.backend_image }}
          NGINX_IMAGE: ${{ needs.resolve-images.outputs.nginx_image }}
          SKIP_MIGRATE: ${{ github.event.inputs.skip_migrate == 'true' && 'true' || 'false' }}
        run: |
          set -euo pipefail
          export BACKEND_IMAGE NGINX_IMAGE SKIP_MIGRATE \
                 APP_BASE="${APP_DIR}" RUN_BACKUP=true VERIFY_BACKUP=true
          bash "${APP_DIR}/deploy/scripts/remote-ghcr-deploy.sh"

      - name: Health check (curl /health)
        run: |
          set -euo pipefail
          for attempt in 1 2 3 4 5 6 8 10; do
            if curl -fsS http://127.0.0.1/health | head -c 200; then
              echo ''; echo 'Factory health check passed'; exit 0
            fi
            echo "Attempt ${attempt} failed — retrying in 10s…"
            sleep 10
          done
          echo 'Factory health check failed'
          exit 1

      - name: Verify containers
        run: docker ps --filter name=zedral- --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

      - name: Collect logs on failure
        if: failure()
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
        run: |
          mkdir -p artifacts
          docker compose -f "${APP_DIR}/deploy/docker-compose.prod.yml" \
            --env-file "${APP_DIR}/deploy/.env" logs --tail 200 > artifacts/factory-docker-logs.txt || true
          curl -fsS http://127.0.0.1/health > artifacts/factory-health.txt 2>&1 || true

      - name: Upload failure artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: factory-deploy-logs
          path: artifacts/
          if-no-files-found: ignore

      - name: Automatic image rollback
        if: failure()
        env:
          APP_DIR: ${{ steps.appdir.outputs.dir }}
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          export APP_BASE="${APP_DIR}"
          bash "${APP_DIR}/deploy/scripts/rollback-images.sh" || true
          bash deploy/scripts/notify-deploy.sh rollback \
            "Factory auto-rollback after failed deploy (${{ needs.resolve-images.outputs.image_tag }})"

      - name: Notify success
        if: success()
        env:
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          bash deploy/scripts/notify-deploy.sh success \
            "Factory production OK tag=${{ needs.resolve-images.outputs.image_tag }}"

      - name: Notify failure
        if: failure()
        env:
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          bash deploy/scripts/notify-deploy.sh failed \
            "Factory production FAILED tag=${{ needs.resolve-images.outputs.image_tag }}"

  # ── Factory is LAN-only: run smoke ON the box against localhost (no internet) ──
  smoke:
    name: Playwright smoke (Factory)
    needs: [resolve-images, deploy-factory]
    if: ${{ github.event.inputs.skip_smoke != 'true' }}
    runs-on: [self-hosted, linux, factory]
    timeout-minutes: 25
    environment: production

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.resolve-images.outputs.checkout_ref }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: e2e/package-lock.json

      - name: Install e2e deps
        working-directory: e2e
        run: npm ci

      # One-time on the Factory box this needs sudo/apt. If the runner user cannot
      # sudo, pre-install chromium once manually and delete this step.
      - name: Install Playwright browsers
        working-directory: e2e
        run: npx playwright install --with-deps chromium

      - name: Run smoke suite (against local nginx)
        working-directory: e2e
        env:
          BASE_URL: http://127.0.0.1
          SMOKE_BADGE_ID: ${{ secrets.SMOKE_BADGE_ID }}
          SMOKE_PIN: ${{ secrets.SMOKE_PIN }}
        run: npx playwright test --reporter=list,html,json

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: factory-playwright-smoke-report
          path: e2e/playwright-report/
          if-no-files-found: ignore

  # ── Rollback on smoke failure runs ON the box (self-hosted; no SSH needed) ────
  rollback-on-smoke-failure:
    name: Rollback Factory on smoke failure
    needs: [resolve-images, deploy-factory, smoke]
    if: ${{ failure() && needs.deploy-factory.result == 'success' }}
    runs-on: [self-hosted, linux, factory]
    environment: production
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.resolve-images.outputs.checkout_ref }}

      - name: Roll back to previous images (local)
        env:
          APP_DIR: ${{ secrets.FACTORY_APP_DIR }}
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
        run: |
          set -euo pipefail
          if [ -z "${APP_DIR:-}" ] || [ "${APP_DIR}" = "/" ]; then APP_DIR="/opt/zedral"; fi
          export APP_BASE="${APP_DIR}"
          bash "${APP_DIR}/deploy/scripts/rollback-images.sh" || true
          bash deploy/scripts/notify-deploy.sh rollback \
            "Factory rolled back after smoke failure (${{ needs.resolve-images.outputs.image_tag }})"
```

---

## Part 4 — `deploy/scripts/rollback-images.sh` (E2: friendly first-deploy message)

Find:
```bash
PREV="${REPO_ROOT}/deploy/.previous-good-images"
if [ ! -f "${PREV}" ]; then
  die "No previous image checkpoint at ${PREV}. Cannot roll back."
fi
```
Replace with:
```bash
PREV="${REPO_ROOT}/deploy/.previous-good-images"
if [ ! -f "${PREV}" ]; then
  log "No previous image checkpoint at ${PREV} — nothing to roll back to."
  log "This is expected on the FIRST deploy (no known-good release yet). Skipping rollback."
  exit 0
fi
```
> Turns a confusing hard failure on the first-ever deploy into a clear, non-fatal message.

---

## Part 5 — full replacement for `deploy/setup-github-runner.sh`

```bash
#!/usr/bin/env bash
# One-time GitHub Actions self-hosted runner installer for a Zedral deploy VM.
# The runner lives ON the target server; deploy jobs then run docker/compose LOCALLY
# (no inbound SSH from GitHub). Keep the Security Group locked down (port 22 → ops IP only).
#
# Run this ONCE PER SERVER, giving each its own environment label:
#
#   AWS QA (staging) box:
#     export RUNNER_TOKEN='XXXX'
#     export RUNNER_ENV=aws-qa            # → labels: self-hosted,linux,x64,aws-qa
#     export RUNNER_NAME=zedral-aws-qa
#     bash /opt/zedral/deploy/setup-github-runner.sh
#
#   Factory (production) box:
#     export RUNNER_TOKEN='YYYY'
#     export RUNNER_ENV=factory           # → labels: self-hosted,linux,x64,factory
#     export RUNNER_NAME=zedral-factory
#     bash /opt/zedral/deploy/setup-github-runner.sh
#
# Get RUNNER_TOKEN from: GitHub → repo → Settings → Actions → Runners → New self-hosted runner
# (token is valid ~1 hour; generate a fresh one per box).
#
# Optional env:
#   RUNNER_DIR    (default: /home/ubuntu/actions-runner)
#   REPO_URL      (default: https://github.com/kshitijsince2004/hsl_zedral)
#   RUNNER_LABELS (default: self-hosted,linux,x64,${RUNNER_ENV}) — override to fully control labels
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kshitijsince2004/hsl_zedral}"
RUNNER_DIR="${RUNNER_DIR:-/home/ubuntu/actions-runner}"

RUNNER_ENV="${RUNNER_ENV:-}"
if [ -z "${RUNNER_ENV}" ] && [ -z "${RUNNER_LABELS:-}" ]; then
  echo "ERROR: set RUNNER_ENV=aws-qa (staging) or RUNNER_ENV=factory (production)."
  echo "       This becomes the runner label the deploy workflow matches on."
  exit 1
fi
RUNNER_NAME="${RUNNER_NAME:-zedral-${RUNNER_ENV:-runner}}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64,${RUNNER_ENV}}"

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo "ERROR: RUNNER_TOKEN is required."
  echo "GitHub → Settings → Actions → Runners → New self-hosted runner → copy token"
  exit 1
fi

if [ "$(id -un)" != "ubuntu" ]; then
  echo "WARN: run as ubuntu (current: $(id -un))"
fi

# The runner user must own APP_DIR and be able to run docker (add to the docker group):
#   sudo usermod -aG docker ubuntu   # then re-login / restart the runner service
if ! docker info >/dev/null 2>&1; then
  echo "WARN: docker not reachable as $(id -un). The deploy job runs docker LOCALLY —"
  echo "      add this user to the docker group: sudo usermod -aG docker $(id -un)"
fi

echo "==> Installing runner dependencies…"
sudo apt-get update -qq
sudo apt-get install -y curl jq libicu-dev rsync

echo "==> Downloading latest GitHub Actions runner…"
VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name' | sed 's/^v//')"
ARCHIVE="actions-runner-linux-x64-${VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/v${VERSION}/${ARCHIVE}"

mkdir -p "${RUNNER_DIR}"
cd "${RUNNER_DIR}"

if [ ! -f "./config.sh" ]; then
  curl -fsSLO "${URL}"
  tar xzf "${ARCHIVE}"
  rm -f "${ARCHIVE}"
fi

if [ -f "./.runner" ]; then
  echo "Runner already configured at ${RUNNER_DIR} — restarting service."
  sudo ./svc.sh status || true
  sudo ./svc.sh start || true
  exit 0
fi

echo "==> Registering runner ${RUNNER_NAME} (labels: ${RUNNER_LABELS}) for ${REPO_URL}…"
./config.sh \
  --url "${REPO_URL}" \
  --token "${RUNNER_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS}" \
  --unattended \
  --replace

echo "==> Installing systemd service…"
sudo ./svc.sh install ubuntu
sudo ./svc.sh start
sudo ./svc.sh status

echo ""
echo "Runner online with labels: ${RUNNER_LABELS}"
echo "  aws-qa  → matched by deploy-aws.yml        (runs-on: [self-hosted, linux, aws-qa])"
echo "  factory → matched by deploy-production.yml (runs-on: [self-hosted, linux, factory])"
echo "Verify in GitHub → Settings → Actions → Runners (should show Idle)."
```

---

## Part 6 — documentation updates

### `GITHUB_ACTIONS_AUDIT.md` — replace the architecture/overview so it matches reality
- CI runs on GitHub-hosted `ubuntu-latest`: lint → build → client tests → operator bundle → migrate → server unit + integration → arch check → (report-only) npm audit; then `docker-build-push` (only on push to `main`) builds `backend`+`nginx`, Trivy-scans both, pushes to **GHCR** tagged `SHA` + `latest-main`.
- Deploy is **pull-only** on **self-hosted runners that live on each server**:
  - `deploy-aws.yml` → runner label `aws-qa`, env `staging`; auto after CI on `main`, or manual.
  - `deploy-production.yml` → runner label `factory`, env `production`; manual only.
- Deploy steps run **locally on the box** (no SSH): GHCR login → local `rsync` of `deploy/` into `APP_DIR` (preserving `.env`) → `remote-ghcr-deploy.sh` (compose up + migrate; backup+verify on prod) → local `/health` retries → `rollback-images.sh` on failure.
- Delete all references to `vm-deploy.sh`, build-on-VM, `SKIP_GIT_SYNC`, `AWS_GIT_DEPLOY_TOKEN`, `GITHUB_REPO`, SSH-from-cloud, and the old single `zedral` runner label.

### `deploy/README.md`
- Replace any single-runner (`self-hosted,linux,zedral`) or SSH-deploy instructions with the two-runner model (`aws-qa`, `factory`) and the `RUNNER_ENV` usage from Part 5.

---

## GitHub configuration (do in repo settings, note in PR description)

1. **Environments** (Settings → Environments) — create `staging` and `production`. No required reviewers (GitHub Free).
2. **Secrets per environment** (SSH secrets are no longer needed — E3):
   - `staging`: `AWS_APP_DIR` (optional, default `/opt/zedral`), `AWS_PUBLIC_URL`, `SMOKE_BADGE_ID`, `SMOKE_PIN`, `DEPLOY_WEBHOOK_URL`.
   - `production`: `FACTORY_APP_DIR` (optional), `SMOKE_BADGE_ID`, `SMOKE_PIN`, `DEPLOY_WEBHOOK_URL`. **`FACTORY_PUBLIC_URL` is NOT needed** — Factory is LAN-only and its smoke job hits `http://127.0.0.1` on the box directly. Do **not** set it to the private IP `http://10.255.92.33` (a private IP over HTTP can't be a smoke target).
   - You may delete: `AWS_HOST`/`AWS_EC2_HOST`, `AWS_USER`, `AWS_SSH_KEY`, `FACTORY_HOST`, `FACTORY_USER`, `FACTORY_SSH_KEY` (no longer referenced).
3. **Runners** — register one per box with Part 5 (`RUNNER_ENV=aws-qa`, then `RUNNER_ENV=factory`).
4. **Runner host prep** (each box): runner user owns `APP_DIR`, is in the `docker` group, has `rsync`/`curl`/`jq`, and a valid `${APP_DIR}/deploy/.env` present.
5. **GHCR auth** — default is `GITHUB_TOKEN` (works for same-repo private images via job `permissions.packages`). Only if pulling from a **different org/registry**, add a PAT with `read:packages` and change the deploy login `password:` to `${{ secrets.GHCR_TOKEN }}` on those steps.

---

## Acceptance criteria (maps to audit IDs)

| # | Check | Audit ID |
|---|-------|----------|
| 1 | `ci.yml` installs a **pinned** npm (`npm@11.4.2`); Dockerfile matches | C1 |
| 2 | Prod-critical `npm audit` is **report-only** (build does not fail on it) | C2 |
| 3 | `docker-build-push` runs **only** on push to `main` (not on PRs) | C3 |
| 4 | Both backend **and** nginx images are Trivy-scanned | C4 |
| 5 | All GHCR logins use `GITHUB_TOKEN`; no `GHCR_TOKEN` fallback remains | D1 |
| 6 | Production resolve emits a clear "tag not in GHCR" error | D2 |
| 7 | Deploy workflows contain **no** `ssh-agent`, `ssh-keyscan`, or `ssh <user>@<host>` | E1 |
| 8 | `rollback-images.sh` exits 0 with a clear message when no checkpoint exists | E2 |
| 9 | Deploy secrets live in `staging`/`production` environments; SSH secrets removed | E3 |
| 10 | `deploy`/`deploy-factory`/`rollback-on-smoke-failure` use `runs-on: [self-hosted, linux, <label>]` | self-hosted |
| 11 | `resolve`, `resolve-images`, `report`, and **QA** `smoke` remain on `ubuntu-latest`; **Factory `smoke` runs on `[self-hosted, linux, factory]`** against `http://127.0.0.1` (LAN-only) | — |
| 15 | Factory box has Playwright Chromium + system libs installed (one-time `npx playwright install --with-deps chromium`) | — |
| 12 | `deploy/.env` on each server is never overwritten (`rsync --exclude '.env'`) | — |
| 13 | `deploy-staging.yml` left untouched (retired stub) | E6 |
| 14 | `actionlint` passes on all workflows | — |
```
