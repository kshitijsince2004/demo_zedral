# Free demo on Render — `demo.zedral.com` / `demo-zedral.onrender.com`

Same-origin stack (matches prod): **nginx Web Service** (SPA + `/api` + `/auth` proxy) → **backend Web Service** → Postgres + SuperTokens.

```
Browser → nginx (public) → BACKEND_UPSTREAM → API (private)
                              └→ SuperTokens + Postgres
```

## Why `/auth/session/refresh` was 502

Nginx was up (`/` = 200) but proxied `/auth`, `/api`, `/health` to hardcoded `backend:3005` (Docker Compose name). On Render that host does not exist → **502**.

Fix (in repo): nginx image reads `BACKEND_UPSTREAM` (default still `backend:3005` for compose). Redeploy **nginx** + **backend** after this change.

## Free limits

| Thing | Limit |
|-------|--------|
| Web service | Idle spin-down ~15 min; cold start ~1 min |
| Postgres Free | ~1 GB; expires ~30 days unless upgraded |
| RAM | Free ≈ 512 MB — seed lightly; `CACHE_DRIVER=memory` |

## A. Services (same region)

### 1. Postgres (Free)

Internal Database URL for API + SuperTokens.

### 2. SuperTokens (Web Service, Docker)

- Image: `registry.supertokens.io/supertokens/supertokens-postgresql:11.4.5`
- `POSTGRESQL_CONNECTION_URI` = Postgres internal URL
- `API_KEYS` = same as API `SUPERTOKENS_API_KEY`
- Internal URI for API: `http://<st-service-name>:3567` (or whatever port ST listens on)

### 3. API (Web Service, Docker) — use **`./Dockerfile.api`**

`./Dockerfile` ends with **nginx**. A service named `demo-zedral-api` that still logs `[nginx …]` and **port 80** is another SPA, not the API.

1. Settings → **Dockerfile Path** = `./Dockerfile.api`
2. Manual Deploy (clear cache if needed)
3. Success: Logs show `Server listening on …` and port is **`$PORT`** (often 10000), **not** 80
4. Env from [`deploy/.env.render.example`](.env.render.example): `DEMO_SEED_ON_BOOT=true`, DB, SuperTokens, and:

```env
API_DOMAIN=https://demo-zedral.onrender.com
WEBSITE_DOMAIN=https://demo-zedral.onrender.com
CORS_ORIGIN=https://demo-zedral.onrender.com
SUPERTOKENS_CORE_URI=http://<st-service-name>:3567
```

### 4. Nginx (Web Service, Docker) — public URL

- Dockerfile Path **`./Dockerfile`** (final stage nginx) — `https://demo-zedral.onrender.com`
- Env (required on Render):

```env
BACKEND_UPSTREAM=demo-zedral-api:<PORT from API logs>
```

Example:

```env
BACKEND_UPSTREAM=demo-zedral-api:10000
```

- Do **not** leave the Compose default `backend:3005` on Render.
- Optional: `NGINX_RESOLVER` (entrypoint auto-reads `/etc/resolv.conf` if unset).

Redeploy nginx after setting `BACKEND_UPSTREAM`. Smoke:

- `https://demo-zedral.onrender.com/health` → 200
- `https://demo-zedral.onrender.com/auth/session/refresh` → not 502 (401/200 without cookies is fine)

## B. Custom domain `demo.zedral.com`

1. Render → **nginx** service → Custom Domains → `demo.zedral.com`
2. Cloudflare DNS: CNAME `demo` → `demo-zedral.onrender.com` (or the verify target Render shows), **DNS only** until verified; SSL mode **Full**
3. Update API env `API_DOMAIN` / `WEBSITE_DOMAIN` / `CORS_ORIGIN` to `https://demo.zedral.com` and restart API

## C. Demo login chips + auto seed

| What | How |
|------|-----|
| Chips on Login | Auto on `demo-zedral.onrender.com` / `demo.zedral.com`, or Docker build-arg `VITE_SHOW_SEED_LOGIN=true` |
| Users in DB | API env `DEMO_SEED_ON_BOOT=true` → entrypoint runs `seed:profiles` (idempotent) |
| Creds | `admin@zedral.local` / `Password123!` · badge `3000` / PIN `5678` |

`DEMO_SEED_ON_BOOT` needs owner DB URL (`MIGRATE_DATABASE_URL` or `DB_USER`/`DB_PASSWORD`) and a live SuperTokens service.

## D. Out of scope

- Cloudflare Tunnel
- Elasticsearch on free tier
- Replacing AWS QA / Factory compose
