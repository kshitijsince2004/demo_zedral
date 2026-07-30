# ZedralV2.2 — Low-Network Performance: Implementation Plan

_Scope: fix read/write lag on the operator app + platform in low-network zones, and add a server-side Redis cache layer. Grounded in the current code (`packages/client`, `packages/server`)._

## Guiding principle

The lag is felt **on the device in weak-signal zones**, so the fixes that move the needle are **client-side** (timeouts, caching, offline write queue). **Redis is a separate, server-side workstream** — it lowers server latency under load, but does not touch on-device network lag. Do the client work first (A–D), add Redis (F) in parallel on the backend, treat payload reduction (E) as ongoing.

Priority legend: **P0** = do first, cheap + high impact · **P1** = structural offline · **P2** = optimization.

---

## Workstream A (P0) — Request timeouts + retry in `apiClient`

**Problem:** `apiFetch` in `packages/client/src/lib/apiClient.ts` calls bare `fetch` with no `AbortController`. On weak signal the socket hangs for minutes and the UI blocks. This is the single biggest cause of "lagging in reading and writing."

**Change:** add a per-request timeout + bounded exponential-backoff retry for idempotent reads.

```ts
// apiClient.ts — new constants
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;               // GET only
const RETRY_BASE_MS = 400;

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}
```

In `apiFetch`, thread an `AbortSignal` into `fetch` (merge with any caller signal), and on `AbortError` throw the existing `ApiError(..., isOffline=true, preventRetry)`. In `request<T>`, wrap GETs in a retry loop that backs off (`RETRY_BASE_MS * 2^n` + jitter), stops immediately when `navigator.onLine === false`, and never retries non-GET (writes go to the outbox — Workstream D).

**Files:** `packages/client/src/lib/apiClient.ts` only.
**Effort:** ~0.5 day. **Risk:** low (self-contained). **Test:** unit test abort path with a fake timer; Chrome DevTools "Slow 3G" + "Offline".

---

## Workstream B (P0/P1) — Global SWR config + persistent cache

**Problem:** no `<SWRConfig>` exists (checked `main.tsx` / `App.tsx`), so SWR runs on defaults: `revalidateOnFocus`/`revalidateOnReconnect` on, 2s dedup, in-memory-only cache. On a flapping link this fires request bursts that queue behind stalled fetches; two SixHi pages also poll every 15s. Reloads refetch everything.

**Change 1 — global defaults.** Wrap `<App/>` in `packages/client/src/main.tsx` (and `packages/client/src/operator/main.tsx`):

```tsx
<SWRConfig value={{
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 5_000,
  keepPreviousData: true,
  errorRetryCount: 3,
  onErrorRetry: (err, _key, _cfg, revalidate, { retryCount }) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return; // pause offline
    if ((err as ApiError)?.status === 401 || (err as any)?.preventRetry) return;
    setTimeout(() => revalidate({ retryCount }), Math.min(30_000, 800 * 2 ** retryCount));
  },
  provider: makeIdbCacheProvider(), // Change 2
}}>
```

**Change 2 — persistent cache provider** backed by `idb-keyval` (already a dependency): hydrate the SWR `Map` from IndexedDB on boot and flush on `visibilitychange`/`beforeunload`. Effect: reads render **instantly from last-known data** (stale-while-revalidate) instead of a spinner in dead zones.

**Change 3 — make polling network-aware.** Replace the fixed `refreshInterval: 15000` in `pages/sixHi/SixHiCapturePage.tsx` with an interval that pauses when offline / on 2G (use `@capacitor/network`, already a dependency, and `navigator.connection` on web).

**Files:** `main.tsx`, `operator/main.tsx`, new `lib/swrCacheProvider.ts`, `pages/sixHi/SixHiCapturePage.tsx`.
**Effort:** ~1.5 days. **Risk:** low–medium (touches global data-fetch behavior; validate no stale-write reads).

---

## Workstream C (P1) — Service-worker caching for API reads

**Problem:** in `packages/client/vite.config.ts`, `runtimeCaching` maps `/api/.*` to **`NetworkOnly`**. Only `master-data` and `import` are cached, so live/reports/handover/plant-head have no offline fallback.

**Change:** split GET reads from writes. Keep writes `NetworkOnly`; give read endpoints `NetworkFirst` with a short network timeout so the SW falls back to cache fast:

```ts
// GET read endpoints (live, reports, dashboards, traceability)
{
  urlPattern: /\/api\/(live|reports|traceability|machines|shifts)\/.*/i,
  method: 'GET',
  handler: 'NetworkFirst',
  options: {
    cacheName: 'api-reads',
    networkTimeoutSeconds: 3,
    expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
    cacheableResponse: { statuses: [0, 200] },
  },
},
// Writes stay NetworkOnly (background sync handled by the outbox, Workstream D)
{ urlPattern: /\/api\/.*/i, method: 'POST', handler: 'NetworkOnly' },
```

**Files:** `packages/client/vite.config.ts` (and `vite.operator.config.ts` if it defines its own SW).
**Effort:** ~0.5 day. **Risk:** medium — must guarantee **no auth-scoped data leaks across users** in the cache; scope cache lifetime to session and clear on logout. **Test:** offline reload shows cached dashboard; login as user B does not see user A's cached responses.

---

## Workstream D (P1) — App-wide offline write queue (outbox)

**Problem:** the well-built offline stack (`operator/db/outboxRepo.ts`, `operator/sync/engine.ts`, `operator/sync/submitOrQueue.ts`) is **operator-only** — 0 of the 11 non-operator page files use it. Everything else writes straight through `apiClient` and blocks the UI. A second, generic queue (`store/syncQueue.ts`) was started and abandoned (it's the dead file in the cleanup report).

**Change:** promote the operator pattern to a shared module and route all app writes through it.

1. Move `outboxRepo.ts` + `engine.ts` + `submitOrQueue.ts` + `syncStatusStore.ts` from `src/operator/` to `src/lib/sync/` (they already have a web fallback via `idb-keyval`, so no operator-only coupling). Keep the SQLite path for native.
2. Delete the dead `src/store/syncQueue.ts` so there's **one** queue.
3. In the app's write services (the 11 pages), replace direct `apiClient.post/patch` for user-driven writes with `submitOrQueue({ url, method, payload, aggregateKey })`. `aggregateKey` = the entity id (e.g. shift-log id) so edits to the same record replay in order.
4. Start the sync engine once in `main.tsx` (`startSyncEngine()`), same as operator. It already listens to `Network.networkStatusChange` and drains on reconnect.
5. Surface `SyncStatusBadge` (pending/parked counts) in the app shell so users see "3 changes pending — will sync".

**Result:** a save in a dead zone returns instantly (`queued: true`), persists locally, and syncs automatically on reconnect with retry/parking — the UI never blocks on the network.

**Files:** new `src/lib/sync/*` (moved), the 11 write call-sites, `main.tsx`, app shell, delete `store/syncQueue.ts`.
**Effort:** ~3–4 days (call-site migration is the bulk). **Risk:** medium — needs idempotency on the server (see F/notes): writes may replay, so server handlers must be idempotent (there's already an `idempotency_key` migration for m1 — extend that pattern to the migrated endpoints).

---

## Workstream E (P2) — Reduce round-trips and payloads

Ongoing, do opportunistically:
- **ETag / `If-None-Match`** on read endpoints → cheap `304`s instead of full bodies.
- **Pagination + field trimming** on list/dashboard endpoints (return only what the view needs).
- **gzip/br compression** at nginx for `/api` JSON (confirm it's on in `deploy/nginx`).
- **Batch endpoints** where a screen fires several reads on mount.
- **Cut polling**: prefer the outbox's reconnect-driven sync over fixed intervals.

**Effort:** incremental. **Risk:** low. Biggest single win: ETags on the live/dashboard reads.

---

## Workstream F (Server, parallel) — Redis

**When it helps:** only if the **server** is slow under concurrent load (high p95 on hot reads). It will not fix on-device low-network lag — but it reduces the cost of the reads that *do* reach the server, which helps every client. **Measure server p95 first** (add timing logs / APM) so you cache the right endpoints.

**Today:** the server already uses `node-cache` (in-memory, see `packages/server/package.json`). Redis is the distributed upgrade — shared across instances, survives restarts, and can back sessions/queues.

### F.1 — Cache abstraction (swap-in, not rip-out)
Introduce a `Cache` interface with two implementations (`NodeCacheAdapter` today, `RedisCacheAdapter` new via `ioredis`), selected by env (`CACHE_DRIVER=redis|memory`). This lets you roll out per-environment without touching call-sites.

```ts
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, val: T, ttlSec: number): Promise<void>;
  del(prefix: string): Promise<void>; // supports prefix invalidation
}
```

### F.2 — Tenant-aware keys (critical)
The DB is **multi-tenant with RLS** (`db.ts` sets `app.tenant_id` GUC per connection). Every cache key **must** include the tenant id or you leak data across tenants:

```
key = `t:${tenantId}:live:dashboard:${machineCode}:${shiftId}`
```

Read `tenantId` from the request context (`getTenantId()` already exists in `context.ts`). Never cache a query result without the tenant prefix.

### F.3 — What to cache (start narrow)
- **Effective rulesets / validation config** — computed, read-heavy, changes rarely (`ValidationConfigService`). High hit rate.
- **Master data** (machines, defects, process codes) — `MachineRegistryService`, `MachineMasterService`, `defectRoutes`. TTL minutes–hours.
- **Live dashboard read-models** — `liveRoutes` / plant-head aggregates. Short TTL (5–15s) + event-based invalidation.
Leave writes and anything correctness-sensitive uncached initially.

### F.4 — Invalidation via the existing event bus
You already have `@zedral/platform` `EventBus` (InProcess/Kafka). On domain events (production changed, config updated, master edited) publish an invalidation that calls `cache.del('t:${tenantId}:live:*')`. This mirrors the client's `PRODUCTION_SYNC_EVENT` pattern and avoids stale dashboards.

### F.5 — Other Redis uses (later)
- **Session store / rate limiting** (SuperTokens session lookups, API throttling) — distributed, not per-instance.
- **Durable job/event queue** — a Redis-backed transport for `EventBus` and the export/shift-boundary schedulers, so jobs survive restarts and scale horizontally.

### F.6 — Infra
Add a `redis` service to `deploy/docker-compose.prod.yml` (and dev compose), `REDIS_URL` in `.env.example`, health check on boot in `server/index.ts` (non-fatal, fall back to `node-cache` if Redis is down — same pattern as the Elastic health check already there).

**Effort:** ~3–5 days for F.1–F.4; F.5 separate. **Risk:** medium — tenant-key correctness and invalidation are the failure modes; add a test that a tenant A key is never served to tenant B.

---

## Sequencing & milestones

| Milestone | Contents | Est. |
|-----------|----------|------|
| **M1 — Quick relief** | A (timeouts/retry) + B (SWR config + idb cache) + C (SW read caching) | ~3 days |
| **M2 — Offline writes** | D (app-wide outbox, delete dead queue, sync badge) | ~4 days |
| **M3 — Server cache** | F.1–F.4 (Redis abstraction, tenant keys, hot reads, invalidation) — parallel to M1/M2 | ~4 days |
| **M4 — Optimization** | E (ETags, pagination, compression) + F.5 (sessions/queue) | ongoing |

M1 alone should remove most of the perceived lag. M2 makes writes feel instant offline. M3 helps once server load is the constraint.

---

## Testing & rollout

- **Network sim:** Chrome DevTools throttling (Slow 3G / Offline) and a physical device on the shop-floor edge zone for every milestone.
- **Regression gate:** existing suites — `npm run test`, `npm run arch:check`, `npm run e2e:smoke` — green before merge.
- **Feature-flag** the SWR provider swap and the SW strategy change so they can be disabled fast in production.
- **Cache-leak tests (must-have):** SW cache and Redis both get an explicit multi-user / multi-tenant isolation test.
- **Idempotency:** before shipping D, confirm the migrated write endpoints are idempotent (extend the existing `idempotency_key` pattern).

## Key risks

1. **Stale-data-on-write** (B/C) — after a mutation, invalidate/refresh the affected SWR keys (reuse `PRODUCTION_SYNC_EVENT`).
2. **Cross-user cache leaks** (C/F) — scope by session/tenant; clear on logout; test explicitly.
3. **Write replay** (D) — server handlers must be idempotent.
4. **Redis as a new hard dependency** (F) — keep the `node-cache` fallback so Redis being down degrades gracefully, never 500s.
