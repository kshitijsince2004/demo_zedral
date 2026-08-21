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

### 3. API (Web Service, Docker) — target `backend`

- Dockerfile target **`backend`**
- Env: copy [`deploy/.env.render.example`](.env.render.example)
- Until custom domain is live, set domains to the **public nginx** URL, e.g.:

```env
API_DOMAIN=https://demo-zedral.onrender.com
WEBSITE_DOMAIN=https://demo-zedral.onrender.com
CORS_ORIGIN=https://demo-zedral.onrender.com
```

After `demo.zedral.com` is attached to nginx, switch all three to `https://demo.zedral.com`.

- `SUPERTOKENS_CORE_URI=http://<st-service-name>:3567`
- Listen on Render `PORT` (app already uses `process.env.PORT`)

### 4. Nginx (Web Service, Docker) — public URL

- Dockerfile target **`nginx`** (this is `demo-zedral.onrender.com`)
- Env (required on Render):

```env
BACKEND_UPSTREAM=<api-service-name>:<api-PORT>
```

Example: if the API service is named `zedral-api` and Render sets `PORT=10000`:

```env
BACKEND_UPSTREAM=zedral-api:10000
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

## C. Out of scope

- Cloudflare Tunnel
- Elasticsearch on free tier
- Replacing AWS QA / Factory compose
