# Fix: Cloudflare 522 (QA) + unreachable Production smoke — updated

## Confirmed inputs
- QA uses an **Elastic IP** ✅ (so the A record is stable — DNS drift is ruled out).
- `AWS_PUBLIC_URL=https://qa.zedral.com` ✅ (correct — hostname, HTTPS, behind Cloudflare).
- `FACTORY_PUBLIC_URL=http://10.255.92.33` ❌ (**private IP, plain HTTP — see Production section; this cannot work as a smoke target**).

There are **two different problems**. QA is a Cloudflare↔origin reachability issue. Production is a "you're pointing the smoke test at a private IP a cloud runner can't reach" issue. Fix them separately.

---

# PART 1 — QA 522 (`qa.zedral.com` → Elastic IP `51.21.24.75`)

Since the Elastic IP and the `https://qa.zedral.com` hostname are both correct, only two causes remain — and they're about **how Cloudflare connects to your origin**:

1. **Security Group blocks Cloudflare.** You locked the SG down for the self-hosted runner. If inbound **443** (and/or 80) is **not open to Cloudflare's IP ranges**, Cloudflare's SYN is dropped → timeout → **522**.
2. **SSL/TLS mode vs origin port mismatch.** Your Docker stack serves **HTTP on port 80 only** — there is **nothing on 443** inside it (no host nginx/certbot running). If Cloudflare's SSL mode is **Full** or **Full (strict)**, Cloudflare tries **HTTPS:443** on the origin, finds nothing → **522**.

### Confirm which (2 commands, from your laptop — bypasses Cloudflare)
```bash
curl -v  --connect-timeout 5 http://51.21.24.75/health     # origin port 80
curl -vk --connect-timeout 5 https://51.21.24.75/health    # origin port 443
```
- **Both time out** → Security Group is blocking (cause #1).
- **:80 works, :443 times out** → origin has no TLS; Cloudflare must not use 443 (cause #2).

### Pick ONE fix

**Option A — Cloudflare Tunnel (recommended).** No inbound ports, no origin cert, keeps your locked-down SG. See PART 3 for the full `cloudflared` setup. For QA the tunnel Public Hostname → `http://nginx:80`, DNS becomes a CNAME to the tunnel, SSL mode = **Full**. This clears the 522 without touching the firewall.

**Option B — Direct origin (only if you don't want a tunnel):**
1. **Open the firewall to Cloudflare.** AWS Security Group → inbound **TCP 443** (and 80) from **Cloudflare IP ranges** (https://www.cloudflare.com/ips/). Keep 22 to ops IP only.
2. **Make SSL mode match the origin.** Because the origin is HTTP:80 only, either:
   - **Flexible** (quick unblock): Cloudflare → origin over HTTP:80; visitors still get HTTPS at the edge. Then SG only needs 80 open to Cloudflare.
   - **Full (strict)** (proper): put TLS on the box — install a **Cloudflare Origin Certificate** on a host nginx listening on **:443 → proxy localhost:80** (your `TLS_DEPLOYMENT_GUIDE.md` already has this host-nginx layout; or run `deploy/scripts/configure-domain.sh qa.zedral.com --tls`). Then open SG 443 to Cloudflare.

> Fastest path to green for QA: **Flexible + open SG 80 to Cloudflare**, or the **Tunnel**. The Tunnel is more secure and is what Production needs anyway, so doing it once for both is the cleanest.

---

# PART 2 — Production smoke can't reach `http://10.255.92.33`

`10.255.92.33` is a **private (RFC1918) address**. Your smoke job runs on a **GitHub-hosted `ubuntu-latest` runner on the public internet** — it has no route to a `10.x` LAN address, so `http://10.255.92.33` will **always time out** (this one isn't even a Cloudflare 522 — there's no Cloudflare in front of a raw IP). Plain **HTTP** is also wrong for a real public URL.

You have two clean choices depending on whether the factory app is meant to be internet-facing:

### Option A — Factory app is LAN-only (most likely for a plant) → run smoke ON the factory runner *(recommended)*
Your self-hosted Factory runner is already **on the factory network / on the box**, so it can hit the app directly. Move the Factory smoke job onto that runner and point it at **localhost** — no Cloudflare, no public exposure, no private-IP problem.

**Workflow change in `deploy-production.yml` — the `smoke` job only:**
```yaml
  smoke:
    name: Playwright smoke (Factory)
    needs: [resolve-images, deploy-factory]
    if: ${{ github.event.inputs.skip_smoke != 'true' }}
    runs-on: [self-hosted, linux, factory]   # ← was ubuntu-latest; run ON the box
    timeout-minutes: 25
    environment: production
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.resolve-images.outputs.checkout_ref }}
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: e2e/package-lock.json
      - name: Install e2e deps
        working-directory: e2e
        run: npm ci
      - name: Install Playwright browsers
        working-directory: e2e
        run: npx playwright install --with-deps chromium
      - name: Run smoke suite
        working-directory: e2e
        env:
          BASE_URL: http://127.0.0.1            # ← hit the local nginx directly
          SMOKE_BADGE_ID: ${{ secrets.SMOKE_BADGE_ID }}
          SMOKE_PIN: ${{ secrets.SMOKE_PIN }}
        run: npx playwright test --reporter=list,html,json
      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: factory-playwright-smoke-report
          path: e2e/playwright-report/
          if-no-files-found: ignore
```
Then set the secret to the local URL (or drop it, since BASE_URL is hard-set above):
```
FACTORY_PUBLIC_URL = http://127.0.0.1
```
Notes:
- One-time: the Factory box needs Playwright's Chromium + system libs. `npx playwright install --with-deps chromium` needs `sudo` (apt). If the runner user can't sudo, pre-install once manually, or drop the "Install Playwright browsers" step after the first run.
- This makes Production smoke actually validate the deployed app, on the same box, with no networking exposure.

### Option B — Factory app should be reachable from the internet → Cloudflare Tunnel
If operators need to reach it off the LAN, expose it with a **Cloudflare Tunnel** (PART 3), give it a real hostname (e.g. `app.zedral.com`), and set:
```
FACTORY_PUBLIC_URL = https://app.zedral.com     # https + hostname, NOT the private IP
```
Keep the smoke job on `ubuntu-latest`; it will reach the site through Cloudflare.

> Either way, **stop using `http://10.255.92.33`**. It's a private IP over HTTP and can't serve as a public smoke target.

**Immediate unblock:** Production `skip_smoke` already defaults to **`true`**, and the deploy is still gated by the **local `/health` check on the box**. So Production can deploy safely right now without external smoke — turn smoke on (`skip_smoke=false`) after you apply Option A or B.

---

# PART 3 — Cloudflare Tunnel setup (used by QA Option A and Production Option B)

`cloudflared` makes an **outbound** connection to Cloudflare, so Cloudflare never connects inbound to your origin. Works for public *and* private IPs, needs no inbound firewall ports, and keeps the origin on plain HTTP:80 (matches your stack).

```
Visitor ──HTTPS──▶ Cloudflare edge ──outbound tunnel──▶ cloudflared ──HTTP:80──▶ zedral-nginx
```

1. **Create a tunnel** (once per env): Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create tunnel → Cloudflared** → name `zedral-qa` (and `zedral-factory`). Copy the **tunnel token** (`eyJ...`).
2. **Add a Public Hostname:** subdomain `qa.zedral.com` (or `app.zedral.com`), **Service = HTTP → `http://nginx:80`**. This creates the DNS as a **CNAME to the tunnel** — delete the old proxied A record afterward.
3. **Run cloudflared on the box** — add `deploy/docker-compose.cloudflared.yml`:
```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: zedral-cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN:?Set TUNNEL_TOKEN in deploy/.env}
    networks:
      - zedral
    depends_on:
      - nginx
networks:
  zedral:
    external: true
    name: zedral
```
```bash
echo 'TUNNEL_TOKEN=eyJ...token...' >> /opt/zedralv2/deploy/.env   # never commit
cd /opt/zedralv2
docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.cloudflared.yml --env-file deploy/.env up -d cloudflared
docker logs -f zedral-cloudflared      # expect "Registered tunnel connection"
```
4. **SSL/TLS mode = Full.** Tunnel is HEALTHY in the dashboard → 522 gone.

---

## Recommended combination

- **QA:** Cloudflare Tunnel (PART 3) — clears the 522 with no SG changes. *(Or Option B: SG open to Cloudflare + SSL mode Flexible for a quick unblock.)*
- **Production:** it's a factory-internal box → **Option A**: run the smoke job on the self-hosted Factory runner against `http://127.0.0.1`, and set `FACTORY_PUBLIC_URL=http://127.0.0.1`. Only add a Tunnel (Option B) if the app must be reachable off the LAN.

## Verification checklist
- [ ] `curl http://127.0.0.1/health` OK on both boxes (app up locally).
- [ ] **QA:** `curl https://qa.zedral.com/health` from your laptop returns 200 (not 522). Tunnel HEALTHY, or SG open to Cloudflare + SSL mode set.
- [ ] **Production:** `FACTORY_PUBLIC_URL` no longer `http://10.255.92.33`; smoke either runs on the self-hosted runner vs `http://127.0.0.1`, or hits a real `https://` tunnel hostname.
- [ ] `TUNNEL_TOKEN` in each server's `deploy/.env` if using tunnels (never committed).
- [ ] Re-run with `skip_smoke=false` — Playwright loads the site, no 522/timeout.
```
