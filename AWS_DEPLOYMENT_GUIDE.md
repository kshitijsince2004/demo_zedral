# AWS Deployment Guide — Zedral V2.2

Production deployment on **AWS EC2** using Docker Compose and GitHub Actions CI/CD.

## Pre-Deployment

### 1. AWS Infrastructure

- [ ] **Create an AWS Account** with billing enabled.
- [ ] **Provision an EC2 Instance**
  - Instance Type: **`m7i-flex.large`** (2 vCPU, 8 GB RAM) or similar.
  - OS (AMI): **Ubuntu Server 22.04 LTS (HVM)** or newer.
  - Storage (EBS): **30 GB** General Purpose SSD (gp2 or gp3).
- [ ] **Allocate an Elastic IP (EIP)** and associate it with the instance.
- [ ] **Configure Security Groups** with inbound rules:
  - TCP 22 (SSH) — **must allow GitHub Actions** (see note below).
  - TCP 80 (HTTP) — for nginx + Certbot challenge.
  - TCP 443 (HTTPS) — after TLS setup.

  > **GitHub Actions deploy** uses a self-hosted runner on this EC2 instance (see `deploy/setup-github-runner.sh`). You do **not** need to open SSH to `0.0.0.0/0` for CI/CD — restrict port 22 to your IP only.
- [ ] **Create an IAM Role** (optional, for S3 backups)
  - Attach to the EC2 instance with scoped S3 permissions so backups can upload without storing credentials on the VM.

### 2. Repository & Secrets (GitHub Actions)

Configure GitHub **production** environment secrets for `.github/workflows/deploy-aws.yml`:

| Secret | Description |
|--------|-------------|
| `AWS_GIT_DEPLOY_TOKEN` | PAT for private repo clone + raw script fetch |
| `AWS_APP_DIR` | App directory on VM (default `/opt/zedralv2`) |
| `AWS_PUBLIC_URL` | Public HTTPS URL for optional external smoke test |

Register a **self-hosted runner** on EC2 (one-time): see `deploy/setup-github-runner.sh`.

### 3. VM Bootstrap (One-Time)

```bash
ssh -i /path/to/key.pem ubuntu@<Elastic-IP>
curl -fsSL https://raw.githubusercontent.com/kshitijsince2004/hsl_zedral/main/deploy/bootstrap-aws-vm.sh | bash
docker --version
docker compose version
```

The bootstrap script installs Docker, enables a 4 GB swap file, clones the repo to `/opt/zedralv2`, and creates `deploy/.env` from the template.

### 4. Environment Configuration

```bash
nano /opt/zedralv2/deploy/.env
```

Generate secrets:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 16   # DB_PASSWORD
```

Required: `JWT_SECRET`, `DB_PASSWORD`, `DB_USER`, `DB_NAME`, `DATABASE_URL`, `TENANT_ID`, `AUTH_STRICT=true`.

### 5. TLS (Host-Level)

- [ ] Point DNS A record to the Elastic IP.
- [ ] Install Certbot: `sudo apt install certbot`
- [ ] Obtain certificate: `sudo certbot certonly --standalone -d zedral.example.com`
- [ ] Configure host nginx to proxy to Docker port 80.
- [ ] Verify renewal: `sudo certbot renew --dry-run`

See [TLS_DEPLOYMENT_GUIDE.md](./TLS_DEPLOYMENT_GUIDE.md) for details.

---

## Deployment

### CI/CD (Standard)

The **Deploy to AWS EC2** workflow (`.github/workflows/deploy-aws.yml`):

- Triggers automatically when CI succeeds on `main`
- Can be manually dispatched with optional `skip_migrate`
- SSHs to EC2, runs `deploy/vm-deploy.sh`, verifies `/health`

### Manual deploy

```bash
cd /opt/zedralv2
bash deploy/deploy.sh
```

---

## Post-Deployment Operations

### Backup to S3 (Recommended)

- [ ] Create an S3 bucket (e.g. `zedral-db-backups`).
- [ ] Attach IAM role to EC2 with `s3:PutObject` on that bucket.
- [ ] Install AWS CLI: `sudo apt install awscli`
- [ ] Schedule `deploy/scripts/backup-db.sh` via cron (see [BACKUP_STRATEGY.md](./BACKUP_STRATEGY.md)).

Example S3 upload (add to backup script):

```bash
aws s3 cp "$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz" s3://zedral-db-backups/
```

### Seed admin (one-time)

```bash
docker compose -f deploy/docker-compose.prod.yml exec backend npm run seed:admin
```

### Smoke test

```bash
curl -fsS http://<Elastic-IP>/health
```

Or rely on the workflow's external smoke test when `AWS_PUBLIC_URL` is set.

---

## Data restore

To restore from a backup on the EC2 instance:

```bash
gunzip -c backup.sql.gz | docker compose -f deploy/docker-compose.prod.yml exec -T db psql -U m1_user -d m1_db
```

---

*See also: [deploy/README.md](./deploy/README.md)*
