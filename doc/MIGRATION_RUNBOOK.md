# Migration runbook

## Roles

| Role | Env | Purpose |
|------|-----|---------|
| Bootstrap owner (`m1_user`) | `DB_USER` / `DB_PASSWORD` in `deploy/.env`, `MIGRATE_DATABASE_URL` / `DB_MIGRATE_*` | `CREATE`, grants, `node-pg-migrate` |
| App / RLS (`m1_app`) | `DB_APP_USER` / `DB_APP_PASSWORD`, runtime `DATABASE_URL` | App queries only — **never** migrate as this role |

Deploy preflight refuses `DB_USER=m1_app`. Entrypoint refuses migrate-as-app-role.

## How deploys migrate

`deploy/scripts/remote-ghcr-deploy.sh` → `run_stack_deploy`:

1. Start `db` / `redis` / `supertokens`.
2. **Discrete migrate** via `compose run … backend true` (`RUN_MIGRATIONS=true`).
3. Start backend with `RUN_MIGRATIONS=false`.

A bad migration fails as the migrate step — not as a backend health crash-loop.

## Local / CI

```bash
npm run migrate -w @m1/server
# Strict filename order (empty DB / CI):
MIGRATE_STRICT_ORDER=1 npm run migrate -w @m1/server
# Order lint (no DB):
node packages/server/scripts/check-migration-order.mjs
```

`--no-check-order` remains the default for applied QA/Factory DBs that received mid-timeline files after a later timestamp had already run. Fresh CI DBs set `MIGRATE_STRICT_ORDER=1`.

## Authoring a new migration

1. Timestamp **newer** than every existing file under `packages/server/migrations/` (and `migrations/modules/m1/` if module-scoped).
2. Prefer idempotent DDL (`IF NOT EXISTS`).
3. Implement a real `exports.down` when the change is reversible; empty downs are last resort.
4. Run `MIGRATE_STRICT_ORDER=1 npm run migrate` against a throwaway DB before push.

## Mid-timeline / history repair

Scripts (use only with a backup):

- `npm run repair:migrations -w @m1/server` → `repair-migration-history.mjs`
- Related reconcile scripts under `packages/server/scripts/reconcile-*.mjs`

Do **not** paper over history with permanent `--no-check-order` on a fresh database. Prefer repair + documented baseline, then re-enable strict order for new files.

## Rollback images vs schema

Image rollback (`deploy/scripts/rollback-images.sh`) sets `SKIP_MIGRATE=true`. Schema down is **not** automatic — plan a forward-fix migration or a rehearsed `migrate:down` if you must reverse DDL.
