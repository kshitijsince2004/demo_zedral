# Zedral Enterprise CI/CD Pipeline

## 1. Audit summary (pre-change)

| Area | Before | Gap vs target |
|------|--------|---------------|
| CI (`.github/workflows/ci.yml`) | Build + unit/integration tests; Docker build only on `main` push | No ESLint gate, no security scan, no PR Docker validation |
| Deploy (`.github/workflows/deploy-aws.yml`) | Self-hosted runner; **builds images on the VM** | No GHCR; no Factory path; no Playwright; auto after CI |
| Compose (`deploy/docker-compose.prod.yml`) | `build:` on host | Must pull pre-built GHCR images |
| Rollback | Git SHA + rebuild | Must roll back by **image tag** |
| Backup | Cron script only | Must run automatically before Factory deploy |
| Smoke | `/health` curl | Playwright UI smoke after staging |
| Monitoring | None | Prometheus / Grafana / Loki / Uptime Kuma stubs |

Preserved: multi-stage `Dockerfile`, `/health`, `backup-db.sh`, nginx prod config, entrypoint migrations, existing env validation.

## 2. Target architecture

```
feature/* → PR → ci.yml (lint, typecheck/build, tests, security, docker validate)
                 ↓ merge to main (protected)
          deploy-staging.yml
                 → build once → push GHCR (sha + main)
                 → SSH AWS → pull → compose up → migrate → /health
                 → Playwright smoke → report / notify
                 ↓ GitHub Release (vX.Y.Z) or workflow_dispatch
          deploy-production.yml
                 → retag same digest as vX.Y.Z (no rebuild)
                 → SSH Factory → pg_dump → pull SAME images → deploy
                 → /health → auto image rollback on failure → notify
```

**One repository. One image per commit. AWS = staging. Factory = production.**

## 3. Workflows

| Workflow | Trigger | Deploys? |
|----------|---------|----------|
| `ci.yml` | PR + push to `main` | No |
| `deploy-staging.yml` | Push to `main`, manual dispatch | AWS staging |
| `deploy-production.yml` | GitHub Release **or** manual dispatch | Factory only |
| `deploy-aws.yml` | Deprecated stub | No |

## 4. Branch strategy

- `main` — protected; no direct pushes; require CI
- `feature/*` — PRs into `main`
- `hotfix/*` — PRs into `main`

### Branch protection (configure in GitHub UI)

Settings → Branches → Protect `main`:

- Require pull request before merging
- Require status checks: `Lint · Typecheck · Test · Security`, `Docker build validation`
- Restrict who can push
- Do not allow force pushes / deletions

## 5. Secrets reference

### Repository or environment `staging`

| Secret | Purpose |
|--------|---------|
| `AWS_HOST` | Staging EC2 hostname / IP |
| `AWS_USER` | SSH user |
| `AWS_SSH_KEY` | Private key (PEM) |
| `AWS_APP_DIR` | Optional, default `/opt/zedralv2` |
| `AWS_PUBLIC_URL` | Public HTTPS URL for Playwright + external health |
| `GHCR_TOKEN` | PAT with `read:packages` + `write:packages` (or rely on `GITHUB_TOKEN`) |
| `SMOKE_BADGE_ID` | Badge for Playwright login |
| `SMOKE_PIN` | PIN for Playwright login |
| `DEPLOY_WEBHOOK_URL` | Slack or Discord webhook |

### Environment `production`

| Secret | Purpose |
|--------|---------|
| `FACTORY_HOST` | Factory RHEL hostname / IP |
| `FACTORY_USER` | SSH user |
| `FACTORY_SSH_KEY` | Private key |
| `FACTORY_APP_DIR` | Optional, default `/opt/zedralv2` |
| `GHCR_TOKEN` | Package pull (and retag on release) |
| `DEPLOY_WEBHOOK_URL` | Same or separate webhook |

### On each server (`deploy/.env` — never in GitHub)

`JWT_SECRET`, `DATABASE_URL` / `DB_*`, `TENANT_ID`, `SMTP_PASSWORD` (if used), etc.  
CI never injects production DB credentials into the image; servers keep local `.env`.

## 6. Versioning

- Staging tags: `<git-sha>` and `main`
- Production: SemVer release tags `vMAJOR.MINOR.PATCH`
- Release workflow **retags** the SHA digest already built on staging — never rebuilds

```bash
# After staging is green on main:
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
# Publish GitHub Release → deploy-production.yml
```

## 7. Health check

```
GET /health → 200 {"status":"ok","database":"ok",...}
```

Deploy fails (and rolls back images) if health check fails.

## 8. Rollback

Automatic on staging/production when health or smoke fails:

1. Stop failed deploy
2. `deploy/scripts/rollback-images.sh` pulls `.previous-good-images`
3. Notify `rollback`

Manual:

```bash
bash deploy/scripts/rollback-images.sh
```

## 9. Monitoring

See `deploy/monitoring/README.md`. Probe `/health` with Uptime Kuma.

## 10. Files changed

| Path | Change |
|------|--------|
| `.github/workflows/ci.yml` | Lint, tests, security, Docker+Trivy on PRs |
| `.github/workflows/deploy-staging.yml` | GHCR build/push + AWS SSH deploy + Playwright |
| `.github/workflows/deploy-production.yml` | Release/dispatch Factory deploy + backup + rollback |
| `.github/workflows/deploy-aws.yml` | Deprecated |
| `deploy/docker-compose.prod.yml` | `image:` from GHCR (no host build) |
| `deploy/lib/common.sh` | Pull-only deploy + image checkpoints |
| `deploy/scripts/remote-ghcr-deploy.sh` | SSH entrypoint |
| `deploy/scripts/rollback-images.sh` | Image rollback |
| `deploy/scripts/notify-deploy.sh` | Slack/Discord notify |
| `deploy/rollback.sh` | Prefers image rollback |
| `e2e/*` | Playwright smoke suite |
| `deploy/monitoring/*` | Grafana/Prometheus/Loki/Uptime Kuma stubs |
| `docs/CICD_PIPELINE.md` | This document |

## 11. One-time server cutover

1. Ensure Docker can pull from `ghcr.io` (login with read token).
2. Keep existing `deploy/.env`.
3. First staging deploy sets `BACKEND_IMAGE` / `NGINX_IMAGE` automatically.
4. Factory: same, plus confirm backup directory `/var/backups/zedral` is writable.
5. Remove self-hosted runner dependency once SSH deploy is verified (optional).
