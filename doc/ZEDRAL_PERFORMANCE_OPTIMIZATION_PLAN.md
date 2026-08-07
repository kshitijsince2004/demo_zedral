# Zedral / M1 — Performance Optimization Plan (IDE-ready)

**Repo:** ZedralV2 / M1 Digital Data Collection (Hero Steels) — npm workspaces (`@m1/client`, `@m1/server`, `@m1/shared-validation`, `@zedral/platform`, `@zedral/connectors`, `@zedral/m1-collection`).
**Goal:** reduce operator/APK lag (cold-start + interaction), make the app resilient on high-ping factory Wi-Fi, and formalize the offline-first (local-first) model.
**Date:** 2026-08-06
**How to use:** each task has a stable ID, target files, the change, a snippet where useful, acceptance criteria, and a blast-radius note. Do them top-to-bottom within a workstream.

### Status (2026-08-07)

| ID | Status |
|---|---|
| PERF-A1 | DONE |
| PERF-A2 | DONE |
| PERF-A3 | DONE |
| PERF-B1 | DONE |
| PERF-B2 | DONE |
| PERF-B3 | DONE |
| PERF-C1 | DONE |
| PERF-C2 | DONE |
| PERF-C3 | DONE |
| PERF-C4 | DONE |
| PERF-D1 | DONE |
| PERF-D2 | DONE |
| PERF-D3 | DONE |
| PERF-D4 | DONE |
| PERF-D5 | DONE |
| PERF-E1 | DONE |
| PERF-E2 | DONE |
| PERF-E3 | DONE |
| PERF-E4 | DONE |
| PERF-F1 | DONE |
| PERF-F2 | DONE |
| PERF-F3 | DONE |

---

## Guardrails (read first — do not violate)

- **This is a factory-critical MES.** No change may drop a captured production record or break offline capture. When in doubt, keep the write path optimistic + idempotent.
- **Keep the operator bundle purity gate green:** `packages/client/scripts/check-operator-bundle.mjs` must still find its required tokens and stay free of excluded ones after code-splitting.
- **Preserve existing offline machinery:** outbox (`lib/sync/engine.ts`), idempotency keys (`X-Idempotency-Key`), offline PIN login (`operator/db/sqlite.ts` `auth_cache`), delta pull (`operator/sync/pull.ts`), persisted SWR cache (`lib/swrCacheProvider.ts`), form drafts (`lib/useFormDraft.ts`).
- **Change hot paths one screen / one endpoint at a time** and smoke-test that screen before moving on.
- **Measure before/after.** Record the baseline metrics below and re-measure per task.

---

## Baseline & targets

| Metric | Current (approx) | Target |
|---|---|---|
| Operator JS bundle (initial) | ~2.1 MB single chunk | < 600 KB initial; heavy libs lazy |
| `React.lazy` routes | 8 / 210 components | all top-level routes lazy |
| `React.memo` usage | 6 across client | leaf rows of hot dashboards memoized |
| Kysely `.selectAll()` | 188 calls | explicit `.select([...])` on hot reads |
| Outbox drain | 1 request/action, sequential | bulk endpoint (1 round-trip/batch) |
| Response compression | gzip @ nginx only | + brotli; express fallback |
| Local SQLite | `no-encryption` | SQLCipher-encrypted |

Suggested tooling: add `rollup-plugin-visualizer` to the operator build to measure chunk sizes; add a simple RTT probe (see PERF-D1) to log p50/p95 latency.

---

## Workstream A — Bundle & cold start (biggest "app opens slowly" win)

### PERF-A1 — Route-level code splitting
**Files:** top-level route definitions (`packages/client/src/App.tsx` / router), heavy pages under `packages/client/src/pages/**`.
**Change:** convert top-level routes to `React.lazy` + a single `<Suspense>` boundary with a lightweight fallback. Prioritize the heavy screens: `pages/live/MachineHeadDashboard.tsx`, `pages/machinehead/ann/AnnMhReportPage.tsx`, `pages/plant/PlantShiftReviewPage.tsx`, `pages/process/AnnChargePage.tsx`, `pages/sixHi/*`.

```tsx
const MachineHeadDashboard = React.lazy(() => import('./pages/live/MachineHeadDashboard'));
// ...
<Suspense fallback={<RouteSpinner />}>
  <Routes>{/* lazy routes */}</Routes>
</Suspense>
```

**Acceptance:** every route still loads (smoke-test each); no blank screens; `check-operator-bundle.mjs` passes.
**Blast radius:** Medium, mechanical (client-wide, no logic change). Missing `Suspense` fallback = blank route.

### PERF-A2 — Vendor chunk splitting
**Files:** `packages/client/vite.operator.config.ts` and `packages/client/vite.config.ts` → `build.rollupOptions.output`.
**Change:** add `manualChunks` so libraries that aren't needed at launch land in separate cacheable chunks.

```ts
build: {
  // ...existing
  rollupOptions: {
    // ...existing input
    output: {
      manualChunks(id) {
        if (!id.includes('node_modules')) return;
        if (id.includes('recharts') || id.includes('d3')) return 'charts';
        if (id.includes('xlsx') || id.includes('exceljs')) return 'sheets';
        if (id.includes('supertokens')) return 'auth';
        if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/')) return 'react';
        return 'vendor';
      },
    },
  },
},
```

**Acceptance:** `charts`/`sheets`/`auth` chunks exist and are not in the initial load path; initial chunk < 600 KB (verify with visualizer).
**Blast radius:** Low. Build-config only. Re-check PWA precache globs in `vite.config.ts` (`maximumFileSizeToCacheInBytes` is already 3 MB — fine).

### PERF-A3 — Defer chart library
**Files:** any screen importing `recharts` at module top.
**Change:** lazy-load chart components so `recharts` is fetched only when a chart is actually shown (dashboards, reports), not at app boot.
**Acceptance:** `recharts` is in the `charts` chunk and loads on-demand.
**Blast radius:** Low, per-component.

---

## Workstream B — Render performance (interaction jank)

### PERF-B1 — Memoize dashboard rows
**Files:** `pages/live/MachineHeadDashboard.tsx`, `pages/plant/PlantShiftReviewPage.tsx`, `pages/machinehead/ann/AnnMhReportPage.tsx`.
**Change:** extract table rows / cards into `React.memo` child components keyed by id, so one coil/order update re-renders one row, not the whole board. Stabilize props with `useMemo`/`useCallback` (correct deps) so memoization actually holds.
**Acceptance:** editing/adding one row does not re-render the whole list (verify with React DevTools Profiler); live tiles still update.
**Blast radius:** Contained to the screens changed. Wrong deps → stale UI.

### PERF-B2 — Virtualize long lists
**Files:** the shift-review and live-board tables.
**Change:** apply `@tanstack/react-virtual` (already a dependency) so only visible rows mount.
**Acceptance:** long lists scroll smoothly; DOM node count bounded regardless of row count.
**Blast radius:** Contained. Verify keyboard/scroll and sticky headers.

### PERF-B3 — Split god-components (optional, enables B1/B2)
**Files:** `MachineHeadDashboard.tsx` (~1337 LOC), `AnnMhReportPage.tsx` (~1298), `PlantShiftReviewPage.tsx` (~1104), `AnnChargePage.tsx` (~1069).
**Change:** break into container + memoized presentational children. Pure refactor, no behavior change.
**Acceptance:** identical behavior; smaller, individually-memoizable units.
**Blast radius:** Contained per screen; rely on existing tests + manual smoke.

---

## Workstream C — Payload & round-trips

### PERF-C1 — Replace `selectAll()` on hot reads
**Files:** hot read paths in `packages/server/src/services/` — start with `LiveService.ts`, `ProcessStationService.ts`, and the handover/live-board queries.
**Change:** replace `.selectAll()` with explicit `.select([...])` listing only columns the client uses. Do it endpoint-by-endpoint; cross-check the client's TS types for that response so you don't drop a consumed field.
**Acceptance:** response JSON shrinks; the consuming screen still renders all fields; types compile.
**Blast radius:** Contained but per-endpoint. Dropping a consumed column → `undefined` at runtime. Do NOT bulk-refactor all 188.

### PERF-C2 — Paginate / cap long list endpoints
**Files:** list endpoints feeding the virtualized tables (B2).
**Change:** add `limit`/cursor paging; client fetches pages as it scrolls.
**Acceptance:** first page returns fast; scrolling loads more.
**Blast radius:** Medium; keep a non-paged fallback for exports.

### PERF-C3 — Bulk outbox sync endpoint (key high-ping win)
**Files:** `packages/server/src/routes/*` (new `POST /sync/batch`), `packages/client/src/lib/sync/engine.ts` (`pushOutbox`).
**Problem:** `pushOutbox()` currently replays **one request per action, sequentially** — a backlog drains very slowly on a high-latency link.
**Change:** add a server endpoint that accepts an array of `{ id, method, url, payload }`, applies each within a transaction (preserving per-aggregate order), and returns per-item `{ id, status }`. Keep idempotency keys per item. Client sends one request per batch instead of N.

```ts
// client: replace the inner per-action loop with a single batched call
const results = await apiFetch('/sync/batch', {
  method: 'POST',
  body: JSON.stringify({ items: group.map(a => ({ id: a.id, method: a.method, url: a.url, payload: a.payload })) }),
});
// mark each item synced/parked based on results[i].status (reuse isBenignSyncClientError)
```

**Acceptance:** a 50-item backlog drains in ~1 round-trip; ordering per aggregate preserved; re-sending a synced item is a no-op (idempotent).
**Blast radius:** Medium. Server-side replay must reuse the exact same handlers/validation as the individual routes. Ship behind a flag; keep the per-action path as fallback.

### PERF-C4 — Prefetch on shift-start
**Files:** shift-start / login flow, `operator/sync/pull.ts`.
**Change:** warm the caches the operator will need (their line's plan + masters) at shift-start so the first screen opens from local cache.
**Acceptance:** first dashboard open after login renders from cache (no spinner on good or bad network).
**Blast radius:** Low; additive.

---

## Workstream D — High-latency ("high ping") behavior

### PERF-D1 — Continuous RTT probe + network quality state
**Files:** new `lib/networkQuality.ts`; consumers of `lib/networkAwareInterval.ts`.
**Change:** time the round-trip using the existing `X-Server-Date` response header (or a light `GET /health`) and classify the link as `good | degraded | bad` (e.g. p95 RTT thresholds). Expose it via a store and surface it in `components/layout/operator/DeviceStatusIndicators.tsx`.
**Acceptance:** quality state visible in the device-status indicator and readable by polling logic.
**Blast radius:** Low; additive.

### PERF-D2 — Latency-aware polling
**Files:** `lib/networkAwareInterval.ts`, hooks using `refreshInterval` (`useProcessHubQueue.ts`, `useSixHiHubQueue.ts`).
**Change:** widen `refreshInterval` on `degraded` (15s → 30–60s) and pause background revalidation on `bad`. Extend the existing connectivity-aware interval to be latency-aware, not just connected/disconnected.
**Acceptance:** on a throttled link, background request volume drops; foreground actions unaffected.
**Blast radius:** Low; tune thresholds.

### PERF-D3 — Adaptive timeouts
**Files:** `lib/apiClient.ts` (`withTimeout`, `timeoutMs`), `vite.config.ts` PWA `runtimeCaching` (`networkTimeoutSeconds: 3`).
**Change:** make timeouts a function of measured RTT (e.g. `max(3s, p95_RTT × 3)`, capped) so a valid-but-slow response isn't aborted prematurely on a high-ping link.
**Acceptance:** on high ping, slow-but-successful reads complete instead of falling back to stale cache too early.
**Blast radius:** Low. Don't set timeouts so high the UI feels hung — pair with a visible "still loading" state.

### PERF-D4 — Backoff + jitter on sync retry
**Files:** `lib/sync/engine.ts` (`SYNC_INTERVAL_MS`, retry after `bumpAttempt`), `lib/sync/outboxRepo.ts`.
**Change:** on a transient failure, retry with jittered exponential backoff (e.g. 5s, 15s, 45s…) instead of waiting for the fixed 5-min interval; cap and fall back to the interval. Combine with the bulk endpoint (C3).
**Acceptance:** transient failures recover in seconds, not minutes; no thundering-herd on reconnect (jitter).
**Blast radius:** Low–Medium; keep the benign-error handling (`outboxPolicy.ts`) intact.

### PERF-D5 — Cache-first reads with freshness badge
**Files:** Tier-3 screens (live board, queues, handover).
**Change:** render immediately from cache (`keepPreviousData` already used on some hubs — extend it), then revalidate; show "as of HH:MM" using the server clock so operators trust stale-but-shown data.
**Acceptance:** screens paint instantly from cache on any network; a freshness timestamp is visible.
**Blast radius:** Low; UX addition.

---

## Workstream E — Local-first data tiering (make the offline-first model explicit)

> You already render offline-first for owned + reference data (SQLite `master_cache`/`plan_cache`, delta pull with `since` cursors, offline PIN login). This workstream tiers the rest and adds the guards needed to render *shared* state offline safely.

### PERF-E1 — Classify data into tiers
**Deliverable:** a short table in the repo mapping each domain to a tier and strategy.
- **Tier 1 — owned/append-only** (my captures, shift log, drafts): full offline-first, optimistic + outbox. *Push all in.*
- **Tier 2 — reference/master** (specs, machines, defect codes, plan): local-first + periodic delta-sync (already built; safe to lengthen intervals).
- **Tier 3 — shared/contended** (order & coil queue, cross-station handover, live board): cache for speed **but** server is the arbiter (E2/E3).
**Acceptance:** every read/write endpoint is tagged with its tier.

### PERF-E2 — Optimistic-concurrency guards on shared writes
**Files:** shared mutating endpoints in `services/SixHiService.ts`, `services/ProcessStationService.ts`, handover services.
**Change:** add a row `version` / `updated_at` (or use Postgres `xmin`) and reject a write whose base version is stale with `409` + current state. The client (outbox) already treats `409` as benign — surface a "refresh & retry" prompt for genuine conflicts.
**Acceptance:** two stale offline edits to the same row → the second gets a clean `409`, no silent overwrite.
**Blast radius:** Medium; touches shared write handlers. Add tests for the conflict path.

### PERF-E3 — Explicit claim/acquire semantics
**Files:** order-assignment and handover routes.
**Change:** make "take this order/coil" a server-authoritative acquire that returns `409` if already claimed. Prevents two stations acting on the same coil from stale local queues.
**Acceptance:** concurrent claims → exactly one succeeds; the other gets `409` and refreshes.
**Blast radius:** Medium; core workflow — test thoroughly.

### PERF-E4 — Encrypt the local database (security/cert)
**Files:** `packages/client/src/operator/db/sqlite.ts` (`createConnection(..., 'no-encryption', ...)`).
**Change:** switch to SQLCipher encryption supported by `@capacitor-community/sqlite`; manage the key via secure storage. Add a device-data retention/wipe policy.
**Acceptance:** local DB is encrypted at rest; a pulled DB file is unreadable without the key.
**Blast radius:** Medium; a schema/connection change — test fresh-install and upgrade paths. Required as you cache more sensitive data offline (ISO 27001 / IEC 62443).

---

## Workstream F — Server / infra

### PERF-F1 — Brotli + express compression fallback
**Files:** `deploy/nginx.prod.conf` (has `gzip on`), `packages/server/src/app.ts`.
**Change:** enable brotli at nginx for JSON/JS; add `compression` middleware in Express as a fallback for deployments where nginx isn't in front.
**Acceptance:** responses served `br` (or `gzip`); payload sizes drop on the wire.
**Blast radius:** Low.

### PERF-F2 — Indexes for hot filters + N+1 sweep
**Files:** `packages/server/migrations/*`, large services (`SixHiService.ts`, `LiveService.ts`, `ProcessStationService.ts`, `PPCImportService.ts`).
**Change:** enable `log_min_duration_statement` in a load test; add composite indexes where `EXPLAIN` shows seq scans on the live-board/shift filters (`prod_date`, line/process code, shift); replace per-row lookups in loops with a single joined query or `WHERE id IN (...)`.
**Acceptance:** hot queries index-backed; no per-row query bursts under load.
**Blast radius:** Medium; migrations are additive (index creation), test on a copy first.

### PERF-F3 — Cache master/reference reads
**Files:** `packages/server/src/cache/*` (node-cache/Redis already wired), master-data read paths.
**Change:** short-TTL cache for master/reference reads every screen requests.
**Acceptance:** repeat master-data reads hit cache; DB load drops.
**Blast radius:** Low; ensure cache invalidation on master-data edits.

---

## Suggested sequencing

1. **Phase 1 (cold start + quick wins):** PERF-A1, A2, A3, D5, F1 — the app opens fast and paints from cache.
2. **Phase 2 (interaction + payload):** PERF-B1, B2, C1, F2, F3.
3. **Phase 3 (high-ping resilience):** PERF-D1, D2, D3, D4, C3, C4.
4. **Phase 4 (local-first hardening):** PERF-E1, E2, E3, E4, B3, C2.

Phases 1–3 remove the lag users feel; Phase 4 makes a broader offline-first model safe and audit-ready.

---

## Verification checklist (run per task)

- [ ] Operator bundle purity gate passes: `npm run check:operator-bundle -w @m1/client`
- [ ] Unit/integration tests pass: `npm run test`
- [ ] Each touched route smoke-tested (loads, renders, captures, syncs)
- [ ] Offline path intact: airplane-mode capture → reconnect → outbox drains, no dupes
- [ ] Bundle size measured before/after (visualizer)
- [ ] RTT p50/p95 and screen-open time measured on a throttled profile
- [ ] No secrets/PII added to logs or the local cache

---

*Companion documents: `Zedral_Enterprise_Readiness_Assessment.docx` (findings + cert roadmap) and `Zedral_Remediation_Tracker.xlsx` (severity/effort/owner tracker). This plan expands the performance rows into IDE-ready tasks.*
