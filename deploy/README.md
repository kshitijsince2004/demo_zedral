# ZedralV2 — AWS EC2 / Factory Deployment

> **CI/CD:** See [docs/CICD_PIPELINE.md](../docs/CICD_PIPELINE.md) for the enterprise pipeline
> (GHCR images, staging on AWS, production on Factory, Playwright smoke, SemVer releases).
>
> Hosts **never build** Docker images. They pull `BACKEND_IMAGE` / `NGINX_IMAGE` from GHCR.

## Architecture

```
Internet → :443 host TLS (optional) → :80 docker nginx → backend:3005 → postgres:5432
```

| Service | Container | Role |
|---------|-----------|------|
| `nginx` | `zedral-nginx` | Serves React SPA, proxies `/api/*` → backend |
| `backend` | `zedral-backend` | Express API, migrations on start |
| `db` | `zedral-db` | PostgreSQL 15 |

Images come from GHCR, for example:

```bash
export BACKEND_IMAGE=ghcr.io/<org>/<repo>/backend:<sha-or-tag>
export NGINX_IMAGE=ghcr.io/<org>/<repo>/nginx:<sha-or-tag>
bash deploy/scripts/remote-ghcr-deploy.sh
```

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy/scripts/remote-ghcr-deploy.sh` | **CI entrypoint** — pull GHCR images, compose up, health |
| `deploy/scripts/rollback-images.sh` | Roll back to previous GHCR image pair |
| `deploy/scripts/backup-db.sh` | `pg_dump` (also run automatically before Factory deploy) |
| `deploy/scripts/notify-deploy.sh` | Slack/Discord webhook helper |
| `deploy/vm-deploy.sh` | Legacy helper (bootstrap / env validation) |
| `deploy/rollback.sh` | Prefers image rollback |
| `deploy/bootstrap-aws-vm.sh` | One-time Docker + git install |
| `deploy/lib/common.sh` | Shared helpers |

## Manual deploy (ops)

```bash
cd /opt/zedralv2
export BACKEND_IMAGE=ghcr.io/<org>/<repo>/backend:v1.2.0
export NGINX_IMAGE=ghcr.io/<org>/<repo>/nginx:v1.2.0
export GHCR_USER=<github-user>
export GHCR_TOKEN=<read:packages token>
bash deploy/scripts/remote-ghcr-deploy.sh
```

## Rollback

```bash
bash deploy/scripts/rollback-images.sh
```

## Environment

Copy `deploy/.env.production.example` → `deploy/.env` and set secrets.
`BACKEND_IMAGE` / `NGINX_IMAGE` are written by the deploy script during CI.

## Monitoring

Optional stack: `deploy/monitoring/` (Prometheus, Grafana, Loki, Uptime Kuma).
Probe `GET /health`.

## Troubleshooting

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env ps
docker compose -f deploy/docker-compose.prod.yml logs backend nginx --tail 100
curl -v http://127.0.0.1/health
```

See also: [docs/CICD_PIPELINE.md](../docs/CICD_PIPELINE.md), [AWS_DEPLOYMENT_GUIDE.md](../AWS_DEPLOYMENT_GUIDE.md), [BACKUP_STRATEGY.md](../BACKUP_STRATEGY.md).
