# Monitoring stubs for Zedral

## Health endpoint (primary probe)

```
GET /health
→ 200 {"status":"ok","service":"m1-digital-data-collection","database":"ok"}
```

Configure **Uptime Kuma** HTTP(s) monitor against `https://<host>/health` every 60s.
Alert on non-200 or body not containing `"status":"ok"`.

## Stack

```bash
cd deploy/monitoring
docker compose -f docker-compose.monitoring.yml up -d
```

| Service | Port | Purpose |
|---------|------|---------|
| Prometheus | 9090 | Metrics scrape (extend when `/metrics` exists) |
| Grafana | 3001 | Dashboards (admin password via `GRAFANA_ADMIN_PASSWORD`) |
| Loki | 3100 | Log aggregation (wire Promtail later) |
| Uptime Kuma | 3002 | External health checks + alerts |

These services are **optional** and separate from `docker-compose.prod.yml` so Factory air-gapped hosts are not forced to run them.
