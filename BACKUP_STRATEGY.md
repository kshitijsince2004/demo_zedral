# Backup Strategy — Zedral Production (Hero Steels Pilot)

## Overview

Zedral production runs PostgreSQL 15 in Docker (`zedral-db` container) with data persisted to the `pg_data` named volume. **There is no built-in cloud backup** — backups must be scheduled on the EC2 instance.

---

## Automated Daily Backup

### Script Location

- **Backup:** `deploy/scripts/backup-db.sh`
- **Verification:** `deploy/scripts/verify-backup.sh`

### What It Does

1. Reads credentials from `deploy/.env`
2. Runs `pg_dump` inside the `db` container (no owner/ACL for portability)
3. Compresses with gzip
4. Stores in `/var/backups/zedral/` (configurable via `BACKUP_DIR`)
5. Deletes archives older than 30 days (configurable via `RETENTION_DAYS`)

### Schedule (Cron)

On the EC2 instance as the deploy user:

```bash
sudo mkdir -p /var/backups/zedral /var/log
sudo chown deploy:deploy /var/backups/zedral

chmod +x /opt/zedral/deploy/scripts/backup-db.sh
chmod +x /opt/zedral/deploy/scripts/verify-backup.sh

crontab -e
```

Add:

```cron
# Daily backup at 02:00 IST (adjust TZ as needed)
0 2 * * * /opt/zedral/deploy/scripts/backup-db.sh >> /var/log/zedral-backup.log 2>&1

# Weekly backup integrity check (Sunday 03:00)
0 3 * * 0 /opt/zedral/deploy/scripts/verify-backup.sh >> /var/log/zedral-backup.log 2>&1
```

### Manual Backup

```bash
cd /opt/zedral
bash deploy/scripts/backup-db.sh
```

---

## Retention Policy

| Tier | Location | Retention |
|------|----------|-----------|
| Local VM | `/var/backups/zedral/` | 30 days (default) |
| Off-VM (recommended) | S3 bucket | 90 days |

### Optional S3 Upload

1. Create bucket: `s3://hero-steels-zedral-backups` (example)
2. Attach IAM role to EC2 with `s3:PutObject` on that bucket
3. Uncomment `aws s3 cp` line in `backup-db.sh`
4. Set `S3_BACKUP_BUCKET` in cron environment

---

## Restore Procedure

### Prerequisites

- Access to EC2 instance
- Backup file: `zedral_m1_db_YYYY-MM-DD_HHMMSS.sql.gz`
- Application stopped or in maintenance mode

### Steps

```bash
# 1. Stop backend to prevent writes (nginx can show maintenance page)
cd /opt/zedral
docker compose -f deploy/docker-compose.prod.yml stop backend

# 2. Restore into PostgreSQL (DESTRUCTIVE — drops and recreates objects in dump)
gunzip -c /var/backups/zedral/zedral_m1_db_2026-06-11_020001.sql.gz | \
  docker compose -f deploy/docker-compose.prod.yml exec -T db \
  psql -U m1_user -d m1_db

# 3. Restart stack
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d

# 4. Verify
curl -s http://127.0.0.1/health | jq
```

### Restore to Staging (Recommended Test)

Before relying on backups, restore to a separate VM or local Docker instance and verify:

- User login works
- Recent shift logs present
- Export history intact

---

## Backup Verification Process

### Automated

`verify-backup.sh` runs weekly via cron:

- Finds latest `.sql.gz` in backup directory
- Validates gzip integrity (`gzip -t`)
- Confirms file contains SQL content (≥5 lines in header)

### Manual Quarterly Drill

1. Restore latest backup to staging VM
2. Run smoke tests from [SMOKE_TEST_CHECKLIST.md](./SMOKE_TEST_CHECKLIST.md)
3. Record drill date and result in ops log

---

## Monitoring

Alert if:

- No new backup file in 26 hours
- `verify-backup.sh` exits non-zero
- `/var/backups/zedral` disk usage > 80%

Simple check script for monitoring:

```bash
find /var/backups/zedral -name '*.sql.gz' -mtime -1 | grep -q . || echo "ALERT: No backup in 24h"
```

---

## RPO / RTO Targets (Pilot)

| Metric | Target |
|--------|--------|
| **RPO** (max data loss) | 24 hours (daily backup) |
| **RTO** (time to restore) | 2–4 hours (manual procedure) |

For production hardening post-pilot: increase to 6-hour backups + S3 replication.

---

*See also: [AWS_DEPLOYMENT_GUIDE.md](./AWS_DEPLOYMENT_GUIDE.md)*
