# Spec: Move deploy jobs to self-hosted GitHub runners (local deploy, no SSH)

**Audience:** IDE coding agent (Cursor / Copilot / Claude Code).
**Repo:** `hsl_zedral` (monorepo, `npm workspaces`).
**Goal:** Convert the deploy pipeline from "GitHub-hosted runner that SSHes into the server" to "self-hosted runner that lives ON the server and deploys locally." CI stays on GitHub-hosted runners.

Apply every change below exactly. Do not touch application code, Dockerfile, or `deploy/lib/common.sh` logic. Only the two deploy workflows and the runner setup script change.

---

## Decisions (fixed — do not re-derive)

- Deploy runs **locally** on the self-hosted runner. **Remove all SSH**: no `webfactory/ssh-agent`, no `ssh-keyscan`, no `ssh user@host …`, no rsync-over-SSH. `rsync` becomes a **local** copy into `APP_DIR`.
- **Two runners**, one per server, distinguished by label:
  - AWS QA (staging) → label `aws-qa` → `runs-on: [self-hosted, linux, aws-qa]`
  - Factory (production) → label `factory` → `runs-on: [self-hosted, linux, factory]`
- **CI (`ci.yml`) is unchanged** — stays on `ubuntu-latest`.
- Smoke tests (Playwright) **stay on `ubuntu-latest`** (they only need network to the public URL). Rollback-after-smoke-failure moves to a **separate self-hosted job** so it can run locally without SSH.
- `resolve` / `resolve-images` jobs **stay on `ubuntu-latest`** (they only call the GHCR API).

---

## Files to change

1. `.github/workflows/deploy-aws.yml` — replace entire file (Section A).
2. `.github/workflows/deploy-production.yml` — replace entire file (Section B).
3. `deploy/setup-github-runner.sh` — replace entire file (Section C).
4. `GITHUB_ACTIONS_AUDIT.md` — replace the architecture description (Section D).
5. `deploy/README.md` — update runner setup instructions (Section E, if the file mentions runner labels/SSH).

Do **not** change: `ci.yml`, `deploy-staging.yml` (retired stub — leave as is), `Dockerfile`, `docker-compose.prod.yml`, any script in `deploy/scripts/` or `deploy/lib/`.

---

## Key mechanics the agent must preserve

- The deploy scripts already work locally. `deploy/scripts/remote-ghcr-deploy.sh` reads `APP_BASE`, `BACKEND_IMAGE`, `NGINX_IMAGE`, `SKIP_MIGRATE`, `RUN_BACKUP`, `VERIFY_BACKUP` from env and runs `docker compose` against `${APP_BASE}/deploy/docker-compose.prod.yml`. When invoked on the box directly (not over SSH), it behaves identically.
- The server's `deploy/.env` is the source of truth and must be **preserved** — the local `rsync` keeps `--exclude '.env' --exclude '.last-good-*' --exclude '.previous-good-*'`.
- GHCR login now happens via `docker/login-action@v3` against the **runner's own docker daemon** (the box). `remote-ghcr-login.sh` is no longer called by the workflows (leave the script in the repo; it's just unused).
- Health checks, container listing, log collection, and rollback all run as **plain local shell** (no `ssh` wrapper).

---

## Runner prerequisites (document, don't script beyond setup file)

On each server the runner user (e.g. `ubuntu`) must:
- own `APP_DIR` (default `/opt/zedralv2`) and its `deploy/` subtree,
- be in the `docker` group (`sudo usermod -aG docker ubuntu`),
- have `rsync`, `curl`, `jq` installed,
- have a valid `deploy/.env` already present at `${APP_DIR}/deploy/.env`.

---

## GitHub configuration (document in PR description)

- Create environments **`staging`** and **`production`** (Settings → Environments). No required reviewers (GitHub Free).
- Secrets needed **per environment** (SSH secrets are no longer needed):
  - `staging`: `AWS_APP_DIR` (optional, default `/opt/zedralv2`), `AWS_PUBLIC_URL`, `SMOKE_BADGE_ID`, `SMOKE_PIN`, `DEPLOY_WEBHOOK_URL`.
  - `production`: `FACTORY_APP_DIR` (optional), `FACTORY_PUBLIC_URL`, `SMOKE_BADGE_ID`, `SMOKE_PIN`, `DEPLOY_WEBHOOK_URL`.
  - Repo-level (shared): `GHCR_TOKEN` (optional; falls back to `GITHUB_TOKEN` + `packages: read`).
- Register one runner per box with `deploy/setup-github-runner.sh` using `RUNNER_ENV=aws-qa` and `RUNNER_ENV=factory` respectively (Section C).

---

## Section A — full replacement for `.github/workflows/deploy-aws.yml`

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
          password: ${{ secrets.GHCR_TOKEN || secrets.GITHUB_TOKEN }}

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
          if [ -z "${APP_DIR:-}" ] || [ "${APP_DIR}" = "/" ]; then APP_DIR="/opt/zedralv2"; fi
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
          password: ${{ secrets.GHCR_TOKEN || secrets.GITHUB_TOKEN }}

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
          if [ -z "${APP_DIR:-}" ] || [ "${APP_DIR}" = "/" ]; then APP_DIR="/opt/zedralv2"; fi
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

## Section B — full replacement for `.github/workflows/deploy-production.yml`

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
          password: ${{ secrets.GHCR_TOKEN || secrets.GITHUB_TOKEN }}

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

          echo "Inspecting source images for tag=${SRC}"
          if ! docker buildx imagetools inspect "${IMAGE_PREFIX}/backend:${SRC}" >/dev/null 2>&1; then
            echo "::error::${IMAGE_PREFIX}/backend:${SRC} not found in GHCR. Has CI pushed this tag yet? (merge to main first)"
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

          # Prefer exact SHA tag, else OCI revision label from CI, else workflow SHA
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
    # Environment used only to group secrets (no required reviewers — GitHub Free).
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
          if [ -z "${APP_DIR:-}" ] || [ "${APP_DIR}" = "/" ]; then APP_DIR="/opt/zedralv2"; fi
          echo "dir=${APP_DIR}" >> "$GITHUB_OUTPUT"
          echo "APP_DIR=${APP_DIR}"

      - name: Login to GHCR (local docker daemon)
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GHCR_TOKEN || secrets.GITHUB_TOKEN }}

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

  # ── Smoke stays GitHub-hosted: only needs network to the public URL ──────────
  smoke:
    name: Playwright smoke (Factory)
    needs: [resolve-images, deploy-factory]
    if: ${{ github.event.inputs.skip_smoke != 'true' }}
    runs-on: ubuntu-latest
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

      - name: Install Playwright browsers
        working-directory: e2e
        run: npx playwright install --with-deps chromium

      - name: Run smoke suite
        working-directory: e2e
        env:
          BASE_URL: ${{ secrets.FACTORY_PUBLIC_URL }}
          SMOKE_BADGE_ID: ${{ secrets.SMOKE_BADGE_ID }}
          SMOKE_PIN: ${{ secrets.SMOKE_PIN }}
        run: |
          if [ -z "${BASE_URL}" ]; then
            echo "::error::FACTORY_PUBLIC_URL required when skip_smoke=false"
            exit 1
          fi
          npx playwright test --reporter=list,html,json

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
          if [ -z "${APP_DIR:-}" ] || [ "${APP_DIR}" = "/" ]; then APP_DIR="/opt/zedralv2"; fi
          export APP_BASE="${APP_DIR}"
          bash "${APP_DIR}/deploy/scripts/rollback-images.sh" || true
          bash deploy/scripts/notify-deploy.sh rollback \
            "Factory rolled back after smoke failure (${{ needs.resolve-images.outputs.image_tag }})"
```

---

## Section C — full replacement for `deploy/setup-github-runner.sh`

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
#     bash /opt/zedralv2/deploy/setup-github-runner.sh
#
#   Factory (production) box:
#     export RUNNER_TOKEN='YYYY'
#     export RUNNER_ENV=factory           # → labels: self-hosted,linux,x64,factory
#     export RUNNER_NAME=zedral-factory
#     bash /opt/zedralv2/deploy/setup-github-runner.sh
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

# RUNNER_ENV picks the environment label the deploy workflow targets.
#   deploy-aws.yml        → runs-on: [self-hosted, linux, aws-qa]
#   deploy-production.yml → runs-on: [self-hosted, linux, factory]
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

## Section D — update `GITHUB_ACTIONS_AUDIT.md`

The current doc describes a stale architecture. Replace its architecture/overview so it matches reality:

- CI (`ci.yml`) runs on **GitHub-hosted** `ubuntu-latest`: lint → build → client tests → operator bundle → migrate → server unit + integration → arch check → npm audit; then a `docker-build-push` job builds `backend`+`nginx`, Trivy-scans, and (on push to `main`) pushes to **GHCR** tagged with the commit SHA and `latest-main`.
- Deploy is **pull-only** and runs on **self-hosted runners that live on each server**:
  - `deploy-aws.yml` → runner label `aws-qa`, environment `staging`; auto-triggers after CI succeeds on `main` (also manual dispatch).
  - `deploy-production.yml` → runner label `factory`, environment `production`; manual dispatch only.
- Deploy steps run **locally on the box** (no SSH): GHCR login → local `rsync` of `deploy/` into `APP_DIR` (preserving `.env`) → `remote-ghcr-deploy.sh` (compose up + migrate, backup on prod) → local `/health` check → rollback via `rollback-images.sh` on failure.
- Smoke tests run on GitHub-hosted runners against the public URL; a separate self-hosted job rolls back on smoke failure.
- Remove all references to: `vm-deploy.sh`, build-on-VM, `SKIP_GIT_SYNC`, `AWS_GIT_DEPLOY_TOKEN`, `GITHUB_REPO`, and SSH-from-cloud. Update the "Secrets Required" table to the per-environment lists in this spec's "GitHub configuration" section.

---

## Section E — `deploy/README.md`

If it documents the old `self-hosted,linux,zedral` single label or SSH deploy, update it to the two-runner model (`aws-qa`, `factory`) and the `RUNNER_ENV` usage from Section C.

---

## Acceptance criteria

1. `deploy-aws.yml` and `deploy-production.yml` contain **no** `webfactory/ssh-agent`, `ssh-keyscan`, or `ssh <user>@<host>` invocations.
2. The `deploy` / `deploy-factory` and `rollback-on-smoke-failure` jobs use `runs-on: [self-hosted, linux, aws-qa]` / `[self-hosted, linux, factory]`.
3. `resolve`, `resolve-images`, `smoke`, and `report` jobs remain on `ubuntu-latest`.
4. `ci.yml` is byte-for-byte unchanged.
5. `deploy/.env` on each server is never overwritten (rsync `--exclude '.env'` retained).
6. Both workflows still gate DB migrations behind `skip_migrate`, run `/health` retries, and roll back on failure — now all locally.
7. YAML lints clean (`actionlint` passes).
```
