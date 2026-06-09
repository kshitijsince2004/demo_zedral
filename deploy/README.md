# ZedralV2 — GCP VM Deployment

Production deployment for a **single GCP Compute Engine VM** using Docker Compose:

```
Internet → :80 nginx (SPA + /api proxy) → backend:3005 → postgres:5432
```

## Architecture

| Service | Image | Role |
|---------|-------|------|
| `nginx` | `Dockerfile` target `nginx` | Serves React PWA, proxies `/api/*` → backend |
| `backend` | `Dockerfile` target `backend` | Express API, runs migrations on start |
| `db` | `postgres:15-alpine` | Primary PostgreSQL |

## Prerequisites

- GCP VM: Ubuntu 22.04+, 2 vCPU / 4 GB RAM minimum, 30 GB disk
- Firewall: allow TCP **80** (and **443** if you add TLS)
- GitHub repo with Actions enabled

## One-time VM setup

```bash
# On the VM (replace REPO_URL)
export REPO_URL=https://github.com/YOUR_ORG/ZedralV2.git
bash -c "$(curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/ZedralV2/main/deploy/bootstrap-gcp-vm.sh)"
```

Or clone manually:

```bash
sudo mkdir -p /opt && sudo git clone <repo> /opt/zedralv2
sudo chown -R $USER:$USER /opt/zedralv2
cp /opt/zedralv2/deploy/.env.production.example /opt/zedralv2/deploy/.env
```

Edit `deploy/.env`:

```bash
openssl rand -hex 32   # use for JWT_SECRET
openssl rand -hex 16   # use for DB_PASSWORD
```

## Manual deploy

```bash
cd /opt/zedralv2
bash deploy/deploy.sh
```

First-time data (optional):

```bash
docker compose -f deploy/docker-compose.prod.yml exec backend npm run seed:admin
```

Login: badge **1000**, PIN **1234** (change in production).

## GitHub Actions

### CI (`.github/workflows/ci.yml`)

On every PR / push to `main` or `develop`:

- `npm ci` → `npm run build`
- Client tests (required)
- Server tests (required)
- Docker image build on `main` push

### Deploy (`.github/workflows/deploy-gcp.yml`)

Triggered when:

1. **CI succeeds on `main`** (`workflow_run`) — deploys the exact commit SHA that passed CI
2. **Manual `workflow_dispatch`** — deploys latest `main` (optional `skip_migrate`)

Steps:

1. SSH to GCP VM
2. `git checkout` (pinned SHA or latest `main`) + `deploy/deploy.sh`
3. External smoke test against `GCP_PUBLIC_URL/health` (if secret is set)

### Private repo: VM git authentication

`git pull` on the VM needs credentials for private repositories. Choose one:

**Option A — Deploy key (recommended)**

```bash
# On the VM, as the deploy user
ssh-keygen -t ed25519 -C "zedralv2-deploy" -f ~/.ssh/zedralv2_deploy -N ""
cat ~/.ssh/zedralv2_deploy.pub
# Add the public key in GitHub → Repo → Settings → Deploy keys (read-only)

cd /opt/zedralv2
git remote set-url origin git@github.com:YOUR_ORG/ZedralV2.git

# ~/.ssh/config
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/zedralv2_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

**Option B — HTTPS + fine-grained PAT**

```bash
git remote set-url origin https://github.com/YOUR_ORG/ZedralV2.git
# Store a read-only PAT (GitHub → Settings → Developer settings → PAT)
git config credential.helper store
git pull   # enter PAT once; cached in ~/.git-credentials
```

### Required GitHub secrets

| Secret | Example | Description |
|--------|---------|-------------|
| `GCP_VM_HOST` | `34.x.x.x` | VM external IP or DNS |
| `GCP_VM_USER` | `deploy` | SSH user |
| `GCP_VM_SSH_KEY` | `-----BEGIN OPENSSH...` | Private key (no passphrase) |
| `GCP_VM_SSH_PORT` | `22` | Optional |
| `GCP_APP_DIR` | `/opt/zedralv2` | Optional app path |
| `GCP_PUBLIC_URL` | `http://34.x.x.x` | Post-deploy external smoke test (recommended) |

Create a **production** GitHub Environment for approval gates if desired.

### GCP firewall (example)

```bash
gcloud compute firewall-rules create allow-zedral-http \
  --allow tcp:80 \
  --target-tags=zedral-app \
  --description="ZedralV2 HTTP"
```

Tag the VM: `--tags=zedral-app`

## TLS (recommended)

Place a reverse proxy or Certbot **in front of** the VM nginx, or extend `deploy/nginx.prod.conf` with:

- Port 443 + Let's Encrypt certificates
- `certbot certonly --standalone` or GCP load balancer SSL

## Operations

```bash
# Logs
docker compose -f deploy/docker-compose.prod.yml logs -f backend

# Migrations only
docker compose -f deploy/docker-compose.prod.yml exec backend \
  sh -c 'DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@db:5432/$DB_NAME npx node-pg-migrate --migrations-dir migrations up'

# Backup DB
docker compose -f deploy/docker-compose.prod.yml exec db \
  pg_dump -U m1_user m1_db > backup-$(date +%F).sql

# Rollback app (git)
git checkout <previous-sha>
bash deploy/deploy.sh
```

## Security checklist

- [ ] Strong `JWT_SECRET` (≥32 chars) and `DB_PASSWORD` in `deploy/.env`
- [ ] `deploy/.env` never committed (in `.gitignore`)
- [ ] `AUTH_STRICT=true` in production
- [ ] Restrict GCP firewall to known IPs if possible
- [ ] Change default pilot PINs after `seed:admin`
- [ ] Add TLS before exposing to the internet
- [ ] `/device/register` is rate-limited (10 req/min per IP)

## Local production smoke

```bash
cp deploy/.env.production.example deploy/.env
# edit secrets
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
curl http://localhost/health
curl http://localhost/api/health
```

Open http://localhost
