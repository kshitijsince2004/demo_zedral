# Zedral CI/CD — Build Once → Deploy Many (GitHub Free)

Compatible with **GitHub Free** private repos: production is gated by **manual
`workflow_dispatch`**, not Environment Required Reviewers (Team/Enterprise feature).

## Flow

```
Developer
    │
    ▼
git push main
    │
    ▼
CI  (.github/workflows/ci.yml)
    ├── npm ci · build · test · arch:check · audit
    ├── Docker build backend + nginx
    ├── Trivy (CRITICAL)
    └── Push GHCR:
          …/backend:<sha>  +  …/backend:latest-main
          …/nginx:<sha>    +  …/nginx:latest-main
    │
    ▼
Deploy AWS QA  (.github/workflows/deploy-aws.yml)   ← automatic after CI
    ├── SSH → compose pull (SHA) → up -d --no-build
    ├── migrations · curl /health
    ├── Playwright smoke
    └── Ready for manual QA
    │
    ▼
You test AWS QA.
    │
    ▼
GitHub → Actions → "Deploy Production (Factory)" → Run workflow
    inputs: image_tag = latest-main | <sha> | v1.3.0
            promote_as = (optional) v1.3.0
    │
    ▼
Factory
    ├── backup-db.sh + verify-backup.sh
    ├── compose pull + up -d --no-build   (SAME digests — no rebuild)
    ├── curl /health
    └── on failure → rollback-images.sh
```

## Workflows

| Workflow | Trigger | Builds? | Deploys |
|----------|---------|---------|---------|
| `ci.yml` | PR + push `main` | Yes (push images only on `main`) | No |
| `deploy-aws.yml` | After CI success · manual | No | AWS QA |
| `deploy-production.yml` | **Manual Run workflow only** | No (optional promote tag) | Factory |
| `deploy-staging.yml` | Retired stub | — | — |

## How to deploy production (GitHub Free)

1. Confirm AWS QA is good for the build you want.
2. GitHub → **Actions** → **Deploy Production (Factory)** → **Run workflow**.
3. Set `image_tag`:
   - `latest-main` — tip of main (same as latest green CI)
   - full git SHA — exact QA build
   - `v1.3.0` — only if that tag already exists in GHCR
4. Optional `promote_as: v1.3.0` — copies the digest of `image_tag` to SemVer (still no rebuild), then deploys that SemVer.
5. Factory pulls those images, backs up DB, health-checks; auto-rolls back on failure.

**Rollback / previous version:** run the same workflow again with an older SHA or SemVer (or `latest-main`). No GitHub Release required.

## Secrets

### Environment `staging` (or repo secrets)

`AWS_HOST`, `AWS_USER`, `AWS_SSH_KEY`, `AWS_APP_DIR?`, `AWS_PUBLIC_URL`, `SMOKE_BADGE_ID`, `SMOKE_PIN`, `GHCR_TOKEN?`, `DEPLOY_WEBHOOK_URL?`

Legacy: `AWS_EC2_HOST`, `AWS_EC2_USER`, `AWS_EC2_SSH_KEY`.

### Environment `production` (secret grouping only — no required reviewers)

`FACTORY_HOST`, `FACTORY_USER`, `FACTORY_SSH_KEY`, `FACTORY_APP_DIR?`, `FACTORY_PUBLIC_URL?` (if smoke enabled), `GHCR_TOKEN?`, `DEPLOY_WEBHOOK_URL?`, `SMOKE_BADGE_ID?`, `SMOKE_PIN?`

Do **not** enable Required reviewers on Free.

## Image tags

| Tag | Meaning |
|-----|---------|
| `<git-sha>` | Immutable CI build (AWS QA uses this) |
| `latest-main` | Moving pointer to tip of main |
| `vMAJOR.MINOR.PATCH` | Optional promote via `promote_as` or prior tag |

AWS QA and Factory can deploy the **exact same digest** by using the same SHA (or promoting that SHA to SemVer).

## Rollback

**Automatic:** health/smoke failure → `deploy/scripts/rollback-images.sh` (`.previous-good-images`).

**Manual on server:**

```bash
cd /opt/zedralv2 && bash deploy/scripts/rollback-images.sh
```

**Redeploy previous build (preferred on Free):**

Actions → Deploy Production → `image_tag=<old-sha-or-vX.Y.Z>` → Run workflow.

## Compose

Pull-only — no `build:` keys. Full image refs written to `deploy/.env` as `BACKEND_IMAGE` / `NGINX_IMAGE`.

Deploy workflows rsync **only** `deploy/` to the host (never the full monorepo). `.env` and image checkpoints are excluded.

CI uses **Node 20** + `npm ci` (same major as the Dockerfile). Images are stamped with
`org.opencontainers.image.revision` so Factory/QA can check out the matching commit when
deploying `latest-main` or a SemVer tag.

Remote GHCR auth uses `deploy/scripts/remote-ghcr-login.sh` (token piped over SSH stdin —
never interpolated into the remote command string).

## Server secrets

`deploy/.env` on each host (never in GitHub). See `deploy/.env.production.example`.

## Files

| Path | Role |
|------|------|
| `.github/workflows/ci.yml` | Quality + GHCR push |
| `.github/workflows/deploy-aws.yml` | Auto QA after CI |
| `.github/workflows/deploy-production.yml` | Manual Factory deploy |
| `deploy/docker-compose.prod.yml` | `image:` only |
| `deploy/scripts/remote-ghcr-deploy.sh` | SSH pull/up/health |
| `deploy/scripts/backup-db.sh` / `verify-backup.sh` | Pre-prod backup |
| `deploy/scripts/rollback-images.sh` | Previous tag restore |
| `deploy/lib/common.sh` | Shared pull-only helpers |
