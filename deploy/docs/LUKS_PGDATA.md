# LUKS encryption for Postgres volume (SAFE_CHANGE item 9)

Transparent disk encryption for the Docker volume backing `pg_data`.
Protects against physical theft of the disk/volume. Does **not** protect against
a compromised root on the same box (keys-on-box unlock at boot).

## Prerequisites

- Maintenance window (DB downtime)
- Client ops ownership of the host
- LUKS passphrase / keyfile stored in ops custody (not only on the plant box)

## High-level procedure

1. Stop stack: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env down`
2. Locate volume mount: `docker volume inspect <project>_pg_data`
3. Take a verified encrypted backup (`deploy/scripts/backup-db.sh`) before touching disks
4. Provision LUKS on the underlying disk/partition (or migrate data to a new LUKS volume):
   - `cryptsetup luksFormat …`
   - `cryptsetup open … pgdata_crypt`
   - filesystem + copy from old volume (or restore from backup)
5. Point Docker’s volume / bind mount at the unlocked mapper device
6. Configure unlock-on-boot (`/etc/crypttab` + keyfile or manual unlock with ops present)
7. `compose up -d` and confirm `/health` + smoke checklist
8. Confirm Postgres reads/writes identical data (row counts / spot checks)

## Rollback

Planned maintenance to decrypt / migrate back to an unencrypted volume.

## Verify (invisibility)

App and query results are byte-identical; only the storage layer changes.
