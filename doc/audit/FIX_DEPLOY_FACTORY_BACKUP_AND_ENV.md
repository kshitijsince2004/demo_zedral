# Fix: "Deploy to Factory" — `.env` syntax error + backup dir permission

Two errors hit the `deploy-factory` job on the self-hosted Factory runner. Both are on the **box**, not in the workflow YAML. Fixes below.

---

## Error 1 — `.env: line 46: syntax error near unexpected token '('`

```
*/deploy/.env: line 46: syntax error near unexpected token `('
Error: Process completed with exit code 2.
```

### Cause
The deploy calls `validate_env_file`, which loads the env by **sourcing it as a bash script**:
```bash
set -a
source "${ENV_FILE}"     # deploy/lib/common.sh
set +a
```
So any value containing shell-special characters (`(` `)` `$` space `&` `;` `#` `!`) that isn't quoted makes bash choke. Line 46 of the server's `deploy/.env` had a value with a `(` in it (typically a generated password/secret).

### Fix — single-quote the value(s) in `deploy/.env`
On the Factory box:
```bash
nano /opt/zedralv2/deploy/.env      # go to line 46
```
Wrap the whole value in **single quotes**:
```bash
# before
DB_PASSWORD=p@ss(w0rd)
# after
DB_PASSWORD='p@ss(w0rd)'
```
Rule of thumb: single-quote **every** secret value (`JWT_SECRET`, `DB_PASSWORD`, tokens) so special characters are treated literally. (Single quotes are safest — they disable all shell interpretation.)

> Status: already resolved on your run — the next attempt printed `Environment validation passed`. Keep the quoting rule to prevent recurrence.

---

## Error 2 — `mkdir: cannot create directory '/var/backups': Permission denied`

```
==> Environment validation passed ...
==> Pre-deploy PostgreSQL backup...
mkdir: cannot create directory ‘/var/backups’: Permission denied
Error: Process completed with exit code 1.
```

### Cause
Production deploy runs with `RUN_BACKUP=true`. `deploy/scripts/backup-db.sh` defaults:
```bash
BACKUP_DIR="${BACKUP_DIR:-/var/backups/zedral}"
mkdir -p "${BACKUP_DIR}"
```
The self-hosted runner user (e.g. `ubuntu`) is **not root**, so it can't create anything under `/var`.

### Fix — pre-create the backup dir and hand it to the runner user (one-time)
We keep the **default path** `/var/backups/zedral` so it matches the daily backup cron. Run once on the Factory box, as the runner user:
```bash
sudo mkdir -p /var/backups/zedral
sudo chown -R "$(whoami)":"$(whoami)" /var/backups/zedral
```
This makes the directory writable by the runner (root's cron can still write there too). No workflow change is needed — `deploy-production.yml` uses the default path:
```yaml
export BACKEND_IMAGE NGINX_IMAGE SKIP_MIGRATE \
       APP_BASE="${APP_DIR}" RUN_BACKUP=true VERIFY_BACKUP=true
```

---

## Verify, then re-run
On the box (as the runner user):
```bash
# .env sources cleanly (no output = no syntax error)
bash -n <(grep -vE '^\s*#' /opt/zedralv2/deploy/.env) 2>&1 | head    # quick sanity; empty = OK
# backup dir writable
[ -w /var/backups/zedral ] && echo "backup dir OK" || echo "backup dir NOT writable"
```
Then re-run **Actions → Deploy Production (Factory) → Run workflow** (`image_tag=latest-main`). The Backup → verify → pull → deploy step should pass.

## Next likely gate
If containers come up but the **`/health` check** fails, it's almost always a value in `.env` — most commonly `JWT_SECRET` shorter than **32 characters** (production requires ≥32) or wrong DB credentials. Check with:
```bash
cd /opt/zedralv2
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs --tail 100 backend
```
