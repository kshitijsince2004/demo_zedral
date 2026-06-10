# GCP Deployment Checklist — Zedral V2.1

Use this checklist before, during, and after deploying Zedral to a Google Cloud Platform Compute Engine VM via GitHub Actions.

**Related document:** [PRODUCTION_READINESS_REPORT.md](./PRODUCTION_READINESS_REPORT.md)  
**Current readiness:** NOT READY FOR PRODUCTION (score 62/100) — complete P0 items before go-live.

---

## Pre-Deployment

### GCP Infrastructure

- [ ] **Create GCP project** with billing enabled
- [ ] **Provision Compute Engine VM**
  - Recommended: e2-standard-4 (4 vCPU, 16 GB RAM) minimum for Docker build + Postgres
  - OS: Ubuntu 22.04 LTS
  - Boot disk: 50 GB SSD minimum (100 GB if retaining export artifacts locally)
  - Static external IP assigned
- [ ] **Configure firewall rules**
  - Allow TCP 22 (SSH) — restrict source IPs where possible
  - Allow TCP 80 (HTTP) — for nginx + Certbot challenge
  - Allow TCP 443 (HTTPS) — after TLS setup
  - Deny all other inbound
- [ ] **Create service account** (optional) for GCS backup uploads if using automated backups

### Repository & Secrets

- [ ] **Verify GitHub repository name** matches deploy configuration
  - Default in scripts: `kshitijsince2004/ZedralV2`
  - Update `GITHUB_REPO` secret if using `ZedralV2.1`
- [ ] **Configure GitHub `production` environment secrets:**

| Secret | Description |
|--------|-------------|
| `GCP_VM_HOST` | VM external IP or hostname |
| `GCP_VM_USER` | SSH user (e.g. `deploy`) |
| `GCP_VM_SSH_KEY` | Private key for SSH (ed25519 recommended) |
| `GCP_VM_SSH_PORT` | SSH port (default 22) |
| `GCP_APP_DIR` | App directory on VM (default `/opt/zedralv2`) |
| `GCP_GIT_DEPLOY_TOKEN` | PAT for private repo clone + raw script fetch |
| `GCP_PUBLIC_URL` | Public HTTPS URL for post-deploy smoke test |

### VM Bootstrap (One-Time)

- [ ] SSH to VM and run bootstrap script:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/deploy/bootstrap-gcp-vm.sh | bash
  ```
  Or clone manually and run `deploy/bootstrap-gcp-vm.sh`
- [ ] Verify Docker and Docker Compose installed:
  ```bash
  docker --version
  docker compose version
  ```

### Environment Configuration

- [ ] Copy production env template:
  ```bash
  cp deploy/.env.production.example deploy/.env
  ```
- [ ] Generate strong secrets:
  ```bash
  # JWT secret (32+ chars)
  openssl rand -hex 32

  # DB password
  openssl rand -base64 24
  ```
- [ ] Set required values in `deploy/.env`:

| Variable | Required | Notes |
|----------|----------|-------|
| `HTTP_PORT` | Yes | Default 80 |
| `DB_USER` | Yes | e.g. `m1_user` |
| `DB_PASSWORD` | Yes | Strong random password |
| `DB_NAME` | Yes | e.g. `m1_db` |
| `DATABASE_URL` | Yes | `postgres://user:pass@db:5432/dbname` |
| `JWT_SECRET` | Yes | ≥ 32 random chars |
| `AUTH_STRICT` | Yes | **Must be `true`** |
| `VALIDATION_STRICT` | Yes | **Must be `true`** |
| `CORS_ORIGIN` | If needed | Comma-separated HTTPS origins |
| `RUN_MIGRATIONS` | Yes | `true` for first deploy |
| `EXPORT_WORKER_ENABLED` | Yes | `true` |
| `DPR_SCHEDULER_ENABLED` | Yes | `true` if DPR exports needed |
| `ELASTICSEARCH_URL` | Optional | Leave empty for PG-only traceability |

- [ ] Validate env file:
  ```bash
  source deploy/lib/common.sh
  validate_env_file deploy/.env
  ```

### TLS (Host-Level — Required for Production)

- [ ] Install Certbot on VM (not in Docker stack):
  ```bash
  sudo apt install certbot
  ```
- [ ] Obtain certificate (adjust domain):
  ```bash
  sudo certbot certonly --standalone -d zedral.example.com
  ```
- [ ] Configure host nginx or reverse proxy to:
  - Terminate TLS on :443
  - Proxy to Docker nginx on :80
- [ ] Set up auto-renewal:
  ```bash
  sudo certbot renew --dry-run
  ```
- [ ] Update `GCP_PUBLIC_URL` secret to `https://zedral.example.com`

---

## Deployment

### Manual Deploy (First Time or Emergency)

- [ ] On VM, ensure repo is cloned at `GCP_APP_DIR`
- [ ] Run deploy script:
  ```bash
  cd /opt/zedralv2
  bash deploy/deploy.sh
  ```
- [ ] Or use docker compose directly:
  ```bash
  docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
  ```

### CI/CD Deploy (Standard)

- [ ] Merge to `main` branch (triggers CI)
- [ ] Verify CI passes:
  - Build all workspaces
  - Client tests
  - Database migrations
  - Server unit + integration tests
  - Docker image build (on main push)
- [ ] Deploy workflow triggers automatically after CI success on `main`
- [ ] Or trigger manually: GitHub Actions → Deploy GCP → Run workflow
- [ ] Monitor deploy job output for:
  - SSH connection success
  - `vm-deploy.sh` completion
  - Health check retries against `GCP_PUBLIC_URL/health`

### Post-Deploy Verification

- [ ] **Health endpoint:**
  ```bash
  curl -s https://<domain>/health | jq
  ```
  Expected:
  ```json
  { "status": "ok", "service": "m1-digital-data-collection", "database": "ok" }
  ```
- [ ] **API smoke test:**
  ```bash
  curl -s -o /dev/null -w "%{http_code}" https://<domain>/api/health
  ```
- [ ] **Login test:** Badge + PIN authentication via browser
- [ ] **Role routing:** Verify operator lands on `/:userScope` URL
- [ ] **CRM capture:** Start order, record stoppage, complete pass
- [ ] **Plant dashboard:** Verify KPI strip loads with data
- [ ] **Export job:** Trigger DPR or line log export, verify job completes
- [ ] **Container health:**
  ```bash
  docker compose -f deploy/docker-compose.prod.yml ps
  ```
  All services should show `healthy` or `running`

### Initial Data Setup

- [ ] Run admin seed (one-time, from backend container):
  ```bash
  docker compose -f deploy/docker-compose.prod.yml exec backend \
    node dist/scripts/seed_admin.js
  ```
  (Adjust script path if different)
- [ ] **Rotate default PINs** for all seeded users — do not use demo PIN `1234` or `0000`
- [ ] Verify master data (machines, shifts, defect codes) is populated
- [ ] If using Elasticsearch traceability:
  ```bash
  docker compose -f deploy/docker-compose.prod.yml exec backend \
    npm run reindex:traceability
  ```

---

## Post-Deployment Operations

### Backup Setup (P0 — Required)

- [ ] Create backup script on VM (`/opt/zedralv2/scripts/backup-db.sh`):
  ```bash
  #!/bin/bash
  set -euo pipefail
  BACKUP_DIR=/var/backups/zedral
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP=$(date +%F_%H%M%S)
  docker compose -f /opt/zedralv2/deploy/docker-compose.prod.yml \
    exec -T db pg_dump -U "$DB_USER" "$DB_NAME" \
    > "$BACKUP_DIR/backup_${TIMESTAMP}.sql"
  gzip "$BACKUP_DIR/backup_${TIMESTAMP}.sql"
  # Optional: gsutil cp to GCS bucket
  find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
  ```
- [ ] Schedule via cron (daily at 02:00):
  ```bash
  0 2 * * * /opt/zedralv2/scripts/backup-db.sh >> /var/log/zedral-backup.log 2>&1
  ```
- [ ] **Test restore** on a staging VM:
  ```bash
  gunzip -c backup_YYYY-MM-DD.sql.gz | docker compose exec -T db psql -U m1_user m1_db
  ```

### Log Rotation (P2)

- [ ] Configure Docker daemon log limits (`/etc/docker/daemon.json`):
  ```json
  {
    "log-driver": "json-file",
    "log-opts": {
      "max-size": "50m",
      "max-file": "5"
    }
  }
  ```
- [ ] Restart Docker: `sudo systemctl restart docker`

### Monitoring (P2)

- [ ] Set up uptime monitoring on `https://<domain>/health`
- [ ] Monitor VM disk usage (`df -h`, Docker volumes)
- [ ] Monitor container restarts:
  ```bash
  docker inspect --format='{{.RestartCount}}' zedral-backend
  ```
- [ ] Optional: Cloud Monitoring agent for CPU/memory/disk alerts

---

## Rollback Procedure

- [ ] Identify last known good SHA (stored in `.previous-good-sha` on VM by deploy script)
- [ ] Run rollback:
  ```bash
  cd /opt/zedralv2
  bash deploy/rollback.sh
  ```
- [ ] Or rollback to specific SHA:
  ```bash
  bash deploy/rollback.sh <git-sha>
  ```
- [ ] Verify health after rollback
- [ ] **Note:** Rollback does NOT reverse database migrations — plan migration rollbacks separately if schema changed

---

## Security Hardening Checklist

- [ ] `AUTH_STRICT=true` confirmed in `deploy/.env`
- [ ] `JWT_SECRET` is unique, ≥ 32 chars, not committed to git
- [ ] `DB_PASSWORD` is strong, not default `m1_password`
- [ ] All demo user PINs rotated after seed
- [ ] SSH key-only auth (disable password login)
- [ ] Firewall restricts SSH to known IPs
- [ ] TLS certificate valid and auto-renewing
- [ ] `CORS_ORIGIN` set to production domain only (if cross-origin needed)
- [ ] Review `/device/register` exposure — restrict by network if possible
- [ ] GitHub deploy secrets rotated periodically

---

## Known Gaps (From Audit)

These items are documented but **not yet implemented** in the codebase. Track separately:

| Gap | Priority | Action |
|-----|----------|--------|
| Client hardcoded unlock PIN `1234` | P0 | Replace with server PIN verify before go-live |
| Client field override PIN | P0 | Server-side supervisor override |
| Server build ignores TS errors | P1 | Fix TypeScript errors, remove `\|\| echo` |
| No container registry | P1 | Push images from CI to Artifact Registry |
| Elasticsearch not in prod compose | P2 | Add ES service or accept PG fallback |
| Zero-downtime deploy | P3 | Blue/green or rolling update strategy |
| Migration rollback | P2 | Document manual down-migration process |
| CSP headers | P2 | Add to nginx.prod.conf |

---

## Quick Reference Commands

```bash
# View logs
docker compose -f deploy/docker-compose.prod.yml logs -f backend

# Restart backend only
docker compose -f deploy/docker-compose.prod.yml restart backend

# Run migrations manually
docker compose -f deploy/docker-compose.prod.yml exec backend npx node-pg-migrate up

# Shell into backend
docker compose -f deploy/docker-compose.prod.yml exec backend sh

# Check DB connectivity
docker compose -f deploy/docker-compose.prod.yml exec db pg_isready -U m1_user -d m1_db

# Full rebuild
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build

# Stop stack
docker compose -f deploy/docker-compose.prod.yml down
```

---

## Sign-Off

| Role | Name | Date | Approved |
|------|------|------|----------|
| DevOps | | | ☐ |
| Security | | | ☐ |
| Backend Lead | | | ☐ |
| Frontend Lead | | | ☐ |
| Product / Plant Ops | | | ☐ |

---

*Checklist version: 2026-06-11 — aligned with PRODUCTION_READINESS_REPORT.md audit findings.*
