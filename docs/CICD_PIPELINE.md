# Zedral CI/CD — Build Once → Deploy Many (GitHub Free)

Compatible with **GitHub Free** private repos: production is gated by **manual
`workflow_dispatch`**, not Environment Required Reviewers (Team/Enterprise feature).

Deploy runs on **self-hosted runners that live on each server** (local docker/compose —
no SSH from GitHub). CI stays on GitHub-hosted `ubuntu-latest`.

## Flow

```
Developer
    │
    ▼
git push main
    │
    ▼
CI  (.github/workflows/ci.yml)          ← ubuntu-latest
    ├── npm ci · build · test · arch:check · audit
    ├── Docker build backend + nginx     (push to main only)
    ├── Trivy (CRITICAL)
    └── Push GHCR:
          …/backend:<sha>  +  …/backend:latest-main
          …/nginx:<sha>    +  …/nginx:latest-main
    │
    ▼
Deploy AWS QA  (.github/workflows/deploy-aws.yml)   ← automatic after CI
    ├── resolve on ubuntu-latest
    ├── self-hosted [zedral]: local rsync · compose pull · /health
    ├── Playwright smoke on ubuntu-latest
    └── smoke fail → self-hosted rollback
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
Factory  (self-hosted [hsl])
    ├── backup-db.sh + verify-backup.sh
    ├── compose pull + up -d --no-build   (SAME digests — no rebuild)
    ├── curl /health
    └── on failure → rollback-images.sh
```

## Workflows

| Workflow | Trigger | Builds? | Deploys |
|----------|---------|---------|---------|
| `ci.yml` | PR + push `main` | Yes (images only on push `main`) | No |
| `deploy-aws.yml` | After CI success · manual | No | AWS QA (`zedral` / `zedral-ec2`) |
| `deploy-production.yml` | **Manual Run workflow only** | No (optional promote tag) | Factory (`hsl` / `hslsmed`) |
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

**First production deploy:** CI must have pushed the tag to GHCR (merge to `main` first) or `resolve-images` will fail inspect.

## Secrets

SSH secrets are **not** used. Create environments **`staging`** and **`production`**.

### Environment `staging`

`AWS_APP_DIR?`, `AWS_PUBLIC_URL`, `SMOKE_BADGE_ID`, `SMOKE_PIN`, `DEPLOY_WEBHOOK_URL?`

### Environment `production` (secret grouping only — no required reviewers)

`FACTORY_APP_DIR?`, `FACTORY_PUBLIC_URL?` (if smoke enabled), `SMOKE_BADGE_ID?`, `SMOKE_PIN?`, `DEPLOY_WEBHOOK_URL?`

### Repo-level (shared)

`GHCR_TOKEN?` — optional; falls back to `GITHUB_TOKEN` + `packages: read`/`write`. Prefer `GITHUB_TOKEN` for same-repo pushes so a stale PAT cannot break auth.

Do **not** enable Required reviewers on Free.

## Self-hosted runners

| Box | Labels | Setup |
|-----|--------|-------|
| AWS QA (`zedral-ec2`) | `self-hosted,linux,zedral` | `RUNNER_ENV=zedral` |
| Factory (`hslsmed`) | `self-hosted,linux,hsl` | `RUNNER_ENV=hsl` |

Runner user must own `APP_DIR`, be in the `docker` group, and have `rsync`/`curl`/`jq` plus a valid `deploy/.env`.

## Image tags

| Tag | Meaning |
|-----|---------|
| `<git-sha>` | Immutable CI build (AWS QA uses this) |
| `latest-main` | Moving pointer to tip of main |
| `vMAJOR.MINOR.PATCH` | Optional promote via `promote_as` or prior tag |

AWS QA and Factory can deploy the **exact same digest** by using the same SHA (or promoting that SHA to SemVer).

## Rollback

**Automatic:** health/smoke failure → `deploy/scripts/rollback-images.sh` (`.previous-good-images`) on the self-hosted box.

**Manual on server:**

```bash
cd /opt/zedral && bash deploy/scripts/rollback-images.sh
```

**Redeploy previous build (preferred on Free):**

Actions → Deploy Production → `image_tag=<old-sha-or-vX.Y.Z>` → Run workflow.

## Compose

Pull-only — no `build:` keys. Full image refs written to `deploy/.env` as `BACKEND_IMAGE` / `NGINX_IMAGE`.

Deploy jobs rsync **only** `deploy/` into `APP_DIR` locally (never the full monorepo). `.env` and image checkpoints are excluded.

CI uses **Node 20** + pinned **npm 11.4.2** before `npm ci`, then runs `scripts/ensure-native-bindings.mjs`
so Vite 8 (rolldown), vite-plugin-pwa (rollup), Tailwind (lightningcss/oxide), and esbuild
get the correct Linux gnu/musl (or Windows) optional native — Windows lockfiles often omit them.
Root `optionalDependencies` pin those packages into the lockfile as well.
Images are stamped with `org.opencontainers.image.revision` so Factory/QA can check out the matching
commit when deploying `latest-main` or a SemVer tag. `dependency-cruiser` is pinned to **17.4.3**
(supports Node 20); v18+ requires Node 22+.

GHCR login for deploy uses `docker/login-action` on the runner’s local docker daemon.

## Server secrets

`deploy/.env` on each host (never in GitHub). See `deploy/.env.production.example`.

## Files

| Path | Role |
|------|------|
| `.github/workflows/ci.yml` | Quality + GHCR push |
| `.github/workflows/deploy-aws.yml` | Auto QA after CI (self-hosted `zedral`) |
| `.github/workflows/deploy-production.yml` | Manual Factory deploy (self-hosted `hsl`) |
| `deploy/setup-github-runner.sh` | Register runner with `RUNNER_ENV` |
| `deploy/docker-compose.prod.yml` | `image:` only |
| `deploy/scripts/remote-ghcr-deploy.sh` | Local pull/up/health |
| `deploy/scripts/backup-db.sh` / `verify-backup.sh` | Pre-prod backup |
| `deploy/scripts/rollback-images.sh` | Previous tag restore |
| `deploy/lib/common.sh` | Shared pull-only helpers |
