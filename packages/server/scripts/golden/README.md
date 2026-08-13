# Golden API snapshots (SAFE_CHANGE §3)

Invisibility harness: capture canonical JSON from hot endpoints, then diff after query changes.

## Capture baseline (before Phase 3)

```bash
# API on :3005 + seeded users (badge 2000/1234, 1000/1234)
node packages/server/scripts/golden-api-snapshot.mjs
```

Writes `baseline/*.json` (sorted keys). Commit baseline when the dataset is representative.

## Diff after a change

```bash
node packages/server/scripts/golden-api-diff.mjs
```

Any non-empty diff exits 1 — **blocks Phase 3 merges**.

## Backlog-heavy fixture (H-P1)

For queue N+1 exercises, seed ≥300 pending process-queue rows:

```bash
npm run seed:process-queues -w @m1/server
# repeat / extend seed until ANN/CRS/CTL waiting backlog is large, then re-capture baseline
```

Optional: `GOLDEN_TRACE_Q=<coil_or_batch>` for a stable traceability hit.

## Load (p95)

```bash
k6 run packages/server/scripts/load-queue-k6.js
# VUS=50 DURATION=3m POLL_S=15 API_BASE=http://127.0.0.1:3005
```

Record p95 from k6 summary **before** Phase 3 and again after item 13.
