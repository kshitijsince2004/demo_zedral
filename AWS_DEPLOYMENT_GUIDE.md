# AWS Deployment Guide — Zedral V2.2

This guide outlines the process of shifting the deployment of Zedral from Google Cloud Platform (GCP) to Amazon Web Services (AWS). It mirrors the previous GCP setup (VM + Docker Compose) to minimize migration friction.

## Pre-Deployment

### 1. AWS Infrastructure

- [ ] **Create an AWS Account** (if not already existing) with billing enabled.
- [ ] **Provision an EC2 Instance** (AWS Free Tier Eligible)
  - Instance Type: **`m7i-flex.large`** (2 vCPU, 8 GB RAM). 
    *Note: Based on your account, this provides the best performance while remaining in the free tier.*
  - OS (AMI): **Ubuntu Server 22.04 LTS (HVM)** or newer.
  - Storage (EBS): **Up to 30 GB** General Purpose SSD (gp2 or gp3) to stay within the free tier limit.
  
  > [!TIP]
  > **Performance Note**: The `m7i-flex.large` gives you 8 GB of RAM, which is fantastic for running your full Docker Compose stack (Database + Backend + Frontend). The bootstrap script will also add a 4GB Swap File just to be perfectly safe during heavy build processes.
- [ ] **Allocate an Elastic IP (EIP)**
  - Allocate an EIP and associate it with your EC2 instance so that the IP remains static across reboots.
- [ ] **Configure Security Groups** (equivalent to GCP Firewall rules)
  - Create a new Security Group attached to the EC2 instance with the following Inbound Rules:
    - Allow TCP 22 (SSH) — restrict source IPs to your corporate network where possible.
    - Allow TCP 80 (HTTP) — for nginx + Certbot challenge.
    - Allow TCP 443 (HTTPS) — after TLS setup.
  - Leave Outbound Rules to default (Allow All).
- [ ] **Create an IAM Role** (equivalent to GCP Service Account)
  - If you are backing up to S3, create an IAM Role with AmazonS3FullAccess (or scoped permissions) and attach it to the EC2 instance. This eliminates the need to manage AWS credentials on the VM.

### 2. Repository & Secrets (GitHub Actions)

- [ ] **Verify GitHub repository name** matches deploy configuration.
- [ ] **Configure GitHub `production` environment secrets:**
  You will need to create equivalent secrets for AWS. We have provided a `deploy-aws.yml` GitHub workflow that uses these variables.

| Secret | Description |
|--------|-------------|
| `AWS_EC2_HOST` | EC2 Elastic IP or domain name |
| `AWS_EC2_USER` | SSH user (for Ubuntu AMI, it is typically `ubuntu`) |
| `AWS_EC2_SSH_KEY` | Private key for SSH (downloaded when creating the EC2 key pair) |
| `AWS_EC2_SSH_PORT` | SSH port (default 22) |
| `AWS_APP_DIR` | App directory on VM (default `/opt/zedralv2`) |
| `AWS_GIT_DEPLOY_TOKEN` | PAT for private repo clone + raw script fetch |
| `AWS_PUBLIC_URL` | Public HTTPS URL for post-deploy smoke test |

### 3. VM Bootstrap (One-Time)

- [ ] SSH into your new EC2 instance:
  ```bash
  ssh -i /path/to/key.pem ubuntu@<Elastic-IP>
  ```
- [ ] Run the AWS bootstrap script to install Docker and clone the repository:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/deploy/bootstrap-aws-vm.sh | bash
  ```
- [ ] Verify Docker and Docker Compose installed:
  ```bash
  docker --version
  docker compose version
  ```

### 4. Environment Configuration

- [ ] The bootstrap script creates a `deploy/.env` file. You need to configure it just like on GCP:
  ```bash
  nano /opt/zedralv2/deploy/.env
  ```
- [ ] Ensure you generate strong secrets and set the database configurations correctly (same as GCP `GCP_DEPLOYMENT_CHECKLIST.md`).

### 5. TLS (Host-Level)

- [ ] Update your domain's DNS records (A Record) to point to your new **Elastic IP**.
- [ ] Install Certbot on the EC2 host:
  ```bash
  sudo apt update
  sudo apt install certbot
  ```
- [ ] Obtain a certificate:
  ```bash
  sudo certbot certonly --standalone -d zedral.example.com
  ```
- [ ] Ensure Nginx (if running on host) proxies correctly, exactly as it was configured on GCP.
- [ ] Set up auto-renewal:
  ```bash
  sudo certbot renew --dry-run
  ```

---

## Deployment

### CI/CD Deploy (Standard)

- We have created a `.github/workflows/deploy-aws.yml` file which mimics your GCP workflow but targets your AWS EC2 instance.
- [ ] Merge the new workflow and scripts to the `main` branch.
- [ ] The AWS Deploy workflow will trigger automatically upon successful CI runs, or it can be manually dispatched under GitHub Actions.

---

## Post-Deployment Operations

### Backup Setup to S3 (P0 — Required)

Instead of Google Cloud Storage (GCS), you will use AWS S3. 

- [ ] Create an S3 Bucket in the AWS Console (e.g., `zedral-db-backups`).
- [ ] Update your backup script on the EC2 instance (`/opt/zedralv2/scripts/backup-db.sh`) to use `aws s3 cp`:
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
  
  # Upload to S3 (Assumes IAM Role is attached to EC2 instance)
  aws s3 cp "$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz" s3://zedral-db-backups/
  
  find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
  ```
- [ ] Ensure the AWS CLI is installed on the host (`sudo apt install awscli`).
- [ ] Set the cron job just as you did on GCP.

## Data Migration from GCP to AWS (Optional if keeping history)

If you need to migrate production data from the GCP VM to the AWS EC2 instance before cutting over:
1. Stop the application on GCP (keep DB running).
2. Take a final `pg_dump` on the GCP VM.
3. Transfer the dump to the AWS EC2 instance (via `scp` or an intermediate S3/GCS bucket).
4. Restore the dump on the AWS EC2 database container:
   ```bash
   gunzip -c backup.sql.gz | docker compose -f deploy/docker-compose.prod.yml exec -T db psql -U m1_user -d m1_db
   ```
5. Update DNS to point to the AWS Elastic IP.
