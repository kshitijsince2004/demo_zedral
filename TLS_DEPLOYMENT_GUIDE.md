# TLS Deployment Guide — Hero Steels Pilot

Zedral's Docker stack serves HTTP on port 80 internally. **TLS termination happens on the GCP VM host**, not inside the compose stack. This is intentional — certificates bind to the VM's public hostname and renew without rebuilding containers.

---

## Architecture

```
Internet (HTTPS :443)
    ↓
Host Nginx / Certbot (TLS termination, HSTS)
    ↓ proxy to localhost:80
Docker nginx (zedral-nginx) — HTTP only
    ↓ /api/
Docker backend (zedral-backend :3005)
```

---

## Prerequisites

- GCP VM with static external IP
- DNS A record: `zedral.hero-steels.example.com` → VM IP (replace with actual domain)
- Firewall: TCP 80 and 443 open
- Docker stack running (`deploy/docker-compose.prod.yml`)

---

## Step 1: Install Host Nginx + Certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## Step 2: Host Nginx Configuration

Create `/etc/nginx/sites-available/zedral`:

```nginx
# Redirect HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name zedral.hero-steels.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS reverse proxy to Docker nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name zedral.hero-steels.example.com;

    ssl_certificate     /etc/letsencrypt/live/zedral.hero-steels.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zedral.hero-steels.example.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # HSTS — enable after confirming HTTPS works (max-age 1 year)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Security headers (also set in Docker nginx for defense in depth)
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 300s;
        client_max_body_size 50m;
    }
}
```

Enable site:

```bash
sudo ln -sf /etc/nginx/sites-available/zedral /etc/nginx/sites-enabled/
sudo nginx -t
```

---

## Step 3: Obtain Certificate

**First-time** (before SSL block is active, use standalone or webroot):

```bash
sudo certbot certonly --nginx -d zedral.hero-steels.example.com
```

Or if host nginx not yet serving:

```bash
sudo certbot certonly --standalone -d zedral.hero-steels.example.com
```

Then enable full config and reload:

```bash
sudo systemctl reload nginx
```

---

## Step 4: Auto-Renewal

Certbot installs a systemd timer. Verify:

```bash
sudo certbot renew --dry-run
sudo systemctl status certbot.timer
```

Post-renewal hook (reload host nginx):

```bash
# /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
#!/bin/bash
systemctl reload nginx
```

---

## Step 5: GitHub Actions Smoke Test

Set GitHub secret:

```
GCP_PUBLIC_URL=https://zedral.hero-steels.example.com
```

Deploy workflow will curl `https://…/health` after deploy.

---

## Step 6: Application Configuration

In `deploy/.env`:

```env
CORS_ORIGIN=https://zedral.hero-steels.example.com
```

Restart backend after change:

```bash
docker compose -f deploy/docker-compose.prod.yml restart backend
```

---

## Docker Nginx Security Headers

Already configured in `deploy/nginx.prod.conf`:

- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` restrictions

**HSTS** is set on host nginx only (requires valid TLS).

---

## Verification Checklist

- [ ] `curl -I https://zedral.hero-steels.example.com` returns 200/301
- [ ] Certificate valid (browser padlock, `openssl s_client -connect …:443`)
- [ ] HSTS header present on HTTPS responses
- [ ] HTTP redirects to HTTPS
- [ ] `/health` returns `{"status":"ok","database":"ok"}`
- [ ] Login flow works over HTTPS
- [ ] Certbot dry-run renewal succeeds

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Certbot fails — port 80 in use | Stop host nginx briefly or use `--webroot` |
| Docker nginx also binds :80 | Expected — host nginx proxies to it |
| Mixed content warnings | Ensure all API calls use relative `/api` paths |
| 502 Bad Gateway | Check Docker stack: `docker compose ps` |

---

*Deploy scripts intentionally do not modify host TLS configuration — existing certificates are preserved across deploys.*
