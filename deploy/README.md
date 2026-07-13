# ZedralV2 — AWS QA / Factory Deployment

> **CI/CD:** [docs/CICD_PIPELINE.md](../docs/CICD_PIPELINE.md)  
> **Build Once → Deploy Many** · **GitHub Free** (manual production via Actions Run workflow)

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

Push / merge to `main` → workflow **CI**:

1. Install, build, test, `arch:check`
2. Build backend + nginx images, Trivy scan
3. Push `:<sha>` and `:latest-main` to GHCR

## How AWS QA works

Workflow **Deploy AWS QA** runs automatically after CI succeeds:

1. SSH to AWS
2. `docker compose pull` + `up -d --no-build` (CI SHA images)
3. Migrations (entrypoint), `/health`, Playwright
4. Fail → auto image rollback

Manual re-run: Actions → Deploy AWS QA → optional `image_tag`.

## How Production works (GitHub Free)

**No GitHub Release. No Environment Required Reviewers.**

1. QA the build on AWS.
2. Actions → **Deploy Production (Factory)** → **Run workflow**.
3. `image_tag`: `latest-main` | full SHA | `v1.3.0`
4. Optional `promote_as: v1.3.0` to SemVer-tag the same digest, then deploy it.
5. Factory: backup DB → verify → pull → up → health; rollback on failure.

### Redeploy / roll forward to a previous version

Run Production again with an older tag:

- previous SHA from CI
- previous SemVer
- `latest-main`

## Rollback

| Method | How |
|--------|-----|
| Auto | Failed health/smoke → `rollback-images.sh` |
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

## Manual ops (emergency)

```bash
cd /opt/zedralv2
export BACKEND_IMAGE=ghcr.io/<owner>/<repo>/backend:v1.3.0
export NGINX_IMAGE=ghcr.io/<owner>/<repo>/nginx:v1.3.0
export GHCR_USER=<github-user>
export GHCR_TOKEN=<read:packages token>
bash deploy/scripts/remote-ghcr-deploy.sh
```

## Environment file

Copy `deploy/.env.production.example` → `deploy/.env` (never commit).  
CI overwrites `BACKEND_IMAGE` / `NGINX_IMAGE` each deploy.

## Troubleshooting

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env ps
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs backend nginx --tail 100
curl -v http://127.0.0.1/health
```

See: [docs/CICD_PIPELINE.md](../docs/CICD_PIPELINE.md), [AWS_DEPLOYMENT_GUIDE.md](../AWS_DEPLOYMENT_GUIDE.md), [BACKUP_STRATEGY.md](../BACKUP_STRATEGY.md).
