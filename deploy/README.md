# ZedralV2 — AWS QA / Factory Deployment

> **CI/CD:** [docs/CICD_PIPELINE.md](../docs/CICD_PIPELINE.md)  
> **Build Once → Deploy Many** · **GitHub Free** (manual production via Actions Run workflow)  
> **Self-hosted runners** live on each server — deploy runs docker/compose locally (no SSH from GitHub).  
> **Free public demo (`demo.zedral.com` on Render):** [RENDER_DEMO.md](RENDER_DEMO.md)

## Architecture

```
Internet → :443 host TLS (optional) → :80 docker nginx → backend:3005 → postgres:5432
                                                                  └→ SuperTokens :3567
```

| Service | Container | Image source |
|---------|-----------|--------------|
| `nginx` | `zedral-nginx` | GHCR `…/nginx:<sha\|latest-main\|vX.Y.Z>` |
| `backend` | `zedral-backend` | GHCR `…/backend:<sha\|latest-main\|vX.Y.Z>` |
| `supertokens` | `zedral-supertokens` | public registry pin |
| `db` | `zedral-db` | `postgres:15-alpine` |

Hosts **never** `docker compose build`. CI builds once; QA and Factory only pull.

## How CI works

Push / merge to `main` → workflow **CI** (GitHub-hosted):

1. Install, build, test, `arch:check`
2. Build backend + nginx images, Trivy scan
3. Push `:<sha>` and `:latest-main` to GHCR

## Self-hosted runners (one per server)

| Server | Runner name | Label | Workflow `runs-on` |
|--------|-------------|-------|--------------------|
| AWS QA (staging) | `zedral-aws-qa` | `zedral-aws-qa` | `[self-hosted, linux, zedral-aws-qa]` |
| Factory (production) | `hslsmed` | `hslsmed` | `[self-hosted, linux, hslsmed]` |

```bash
# On AWS QA box (if re-registering)
export RUNNER_TOKEN='…'
export RUNNER_ENV=zedral-aws-qa
export RUNNER_NAME=zedral-aws-qa
bash /opt/zedral/deploy/setup-github-runner.sh

# On Factory box (if re-registering)
export RUNNER_TOKEN='…'
export RUNNER_ENV=hslsmed
export RUNNER_NAME=hslsmed
bash /opt/zedral/deploy/setup-github-runner.sh
```

Prerequisites on each box: runner user owns `APP_DIR` (default `/opt/zedral`), is in the `docker` group, has `rsync`/`curl`/`jq`, and `deploy/.env` already exists.

## How AWS QA works

Workflow **Deploy AWS QA** runs automatically after CI succeeds (also manual):

1. Resolve job on `ubuntu-latest` picks the GHCR SHA tag
2. Self-hosted `aws-qa` runner (`zedral-aws-qa`): GHCR login → local `rsync` of `deploy/` (preserves `.env`) → `remote-ghcr-deploy.sh` → `/health`
3. Playwright smoke on `ubuntu-latest` against `AWS_PUBLIC_URL`
4. Fail → auto image rollback on the box (separate self-hosted job after smoke failure)

Manual re-run: Actions → Deploy AWS QA → optional `image_tag`.

## How Production works (GitHub Free)

**No GitHub Release. No Environment Required Reviewers.**

1. QA the build on AWS.
2. Actions → **Deploy Production (Factory)** → **Run workflow**.
3. `image_tag`: `latest-main` | full SHA | `v1.3.0`
4. Optional `promote_as: v1.3.0` to SemVer-tag the same digest, then deploy it.
5. Factory self-hosted runner: backup DB → verify → pull → up → health; rollback on failure.

### Redeploy / roll forward to a previous version

Run Production again with an older tag:

- previous SHA from CI
- previous SemVer
- `latest-main`

## Rollback

| Method | How |
|--------|-----|
| Auto | Failed health/smoke → `rollback-images.sh` (local on the box) |
| Manual server | `bash deploy/scripts/rollback-images.sh` |
| Manual Actions | Re-run Production with previous `image_tag` |

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy/scripts/remote-ghcr-deploy.sh` | Pull GHCR, up `--no-build`, health |
| `deploy/scripts/rollback-images.sh` | Restore `.previous-good-images` |
| `deploy/scripts/backup-db.sh` | `pg_dump` (auto before Factory) |
| `deploy/scripts/verify-backup.sh` | Backup integrity |
| `deploy/lib/common.sh` | Shared pull-only helpers |
| `deploy/setup-github-runner.sh` | Register self-hosted runner (`RUNNER_ENV=zedral-aws-qa\|hslsmed`) |

## Manual ops (emergency)

```bash
cd /opt/zedral
export BACKEND_IMAGE=ghcr.io/<owner>/<repo>/backend:v1.3.0
export NGINX_IMAGE=ghcr.io/<owner>/<repo>/nginx:v1.3.0
export GHCR_USER=<github-user>
export GHCR_TOKEN=<read:packages token>
bash deploy/scripts/remote-ghcr-deploy.sh
```

## Environment file

Copy `deploy/.env.production.example` → `deploy/.env` (never commit).  
CI overwrites `BACKEND_IMAGE` / `NGINX_IMAGE` each deploy. Local rsync never overwrites `.env`.

## Troubleshooting

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env ps
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs backend nginx --tail 100
curl -v http://127.0.0.1/health
```

See: [docs/CICD_PIPELINE.md](../docs/CICD_PIPELINE.md), [AWS_DEPLOYMENT_GUIDE.md](../AWS_DEPLOYMENT_GUIDE.md), [BACKUP_STRATEGY.md](../BACKUP_STRATEGY.md).
