# Environment Validation — Production Startup

Zedral fails fast at startup when production environment variables are misconfigured. Validation runs via `validateAuthConfigAtStartup()` in `packages/server/src/index.ts`.

**Source:** `packages/server/src/config/envValidation.ts`

---

## Production Requirements (`NODE_ENV=production`)

The server **will not start** if any of these conditions fail:

| Variable | Requirement | Error if violated |
|----------|-------------|-------------------|
| `NODE_ENV` | Must be `production` on production VM | N/A (enables other checks) |
| `AUTH_STRICT` | Must be exactly `"true"` | `Production startup blocked: AUTH_STRICT must be "true"` |
| `JWT_SECRET` | Required, ≥ 32 characters | `JWT_SECRET must be at least 32 characters` |
| `JWT_SECRET` | Must not be known placeholder | `JWT_SECRET is a known placeholder value` |
| `DATABASE_URL` | Required **or** full `DB_*` set | `DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME must be set` |
| `TENANT_ID` | Valid UUID v4 format | `TENANT_ID must be a valid UUID` |

### Blocked Placeholder Secrets

- `fallback-secret-for-local-dev-only`
- `ci-test-secret-at-least-16-chars-long`
- `CHANGE_ME_AT_LEAST_32_CHARS_RANDOM`

---

## Strict Mode (`AUTH_STRICT=true`, any NODE_ENV)

| Variable | Requirement |
|----------|-------------|
| `JWT_SECRET` | ≥ 16 characters |

Throws if missing when `AUTH_STRICT=true`.

---

## Development Mode

When `NODE_ENV` is not `production` and `AUTH_STRICT=false`:

- JWT fallback secret allowed for local dev
- `TENANT_ID` optional — falls back to seeded default `00000000-0000-0000-0000-000000000001`
- PIN `0000` allowed only for users without `pin_hash` (server-side, non-strict only)

---

## Tenant Context (Runtime)

Separate from startup validation — enforced per request in `contextMiddleware`:

| Environment | Behavior |
|-------------|----------|
| Production | `TENANT_ID` env is authoritative; optional `X-Tenant-Id` header must match |
| Development | `TENANT_ID` env or dev default tenant |

Missing/invalid tenant → **HTTP 400** with message about tenant context.

---

## Deploy Script Validation

`deploy/lib/common.sh` → `validate_env_file()` runs before every deploy:

- `JWT_SECRET`, `DB_PASSWORD`, `DB_USER`, `DB_NAME`, `TENANT_ID` must be set
- `JWT_SECRET` ≥ 32 chars
- `AUTH_STRICT` must be `true`
- Placeholder detection for `JWT_SECRET` and `DB_PASSWORD`

---

## Production `.env` Template

See `deploy/.env.production.example`. Minimum production config:

```env
NODE_ENV=production
HTTP_PORT=80

DB_USER=m1_user
DB_PASSWORD=<openssl rand -base64 24>
DB_NAME=m1_db
DATABASE_URL=postgres://m1_user:<password>@db:5432/m1_db

JWT_SECRET=<openssl rand -hex 32>
AUTH_STRICT=true
VALIDATION_STRICT=true
TENANT_ID=00000000-0000-0000-0000-000000000001

RUN_MIGRATIONS=true
EXPORT_WORKER_ENABLED=true
DPR_SCHEDULER_ENABLED=true
```

---

## Verification Commands

```bash
# On VM — validate env before deploy
source deploy/lib/common.sh
validate_env_file deploy/.env

# After deploy — confirm backend started (not crash-looping)
docker compose -f deploy/docker-compose.prod.yml logs backend --tail 50

# Health check includes DB
curl -s http://127.0.0.1/health | jq
```

### Expected Startup Log

```
Server listening on port 3005
[ExportWorker] started (poll 5000ms)
[ExportScheduler] DPR nightly enabled (hour 7 local)
```

### Expected Failure (misconfigured)

```
Error: Production startup blocked: AUTH_STRICT must be "true" when NODE_ENV=production
```

Container will restart loop until `.env` is corrected.

---

## CI Environment

GitHub Actions CI uses test values (not production):

```yaml
NODE_ENV: test
AUTH_STRICT: 'true'
JWT_SECRET: ci-test-secret-at-least-16-chars-long
```

CI does not set `NODE_ENV=production`, so production-only checks are not triggered in CI.

---

*See also: [GCP_DEPLOYMENT_CHECKLIST.md](./GCP_DEPLOYMENT_CHECKLIST.md)*
