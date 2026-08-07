# Data tier classification (PERF-E1)

| Domain | Tier | Strategy | Endpoint family |
|---|---|---|---|
| Captures, shift log writes, form drafts, outbox | **1** owned/append-only | Full offline-first; optimistic + outbox push | `process` (`/stations`), `sixhi` writes, `/shift-logs` writes, `/sync` |
| Masters, specs, machines, defect codes, plan/PPC cache | **2** reference | Local-first + periodic delta pull | `masters` (`/master-data`, `/6hi/master/*`, `/machines`, `/defects`, `/planned-coils`) |
| Live board, queues, handover, order assignment/claim | **3** shared/contended | Cache for speed; **server is arbiter** (409 on conflict) | `live` (`/live`), `handover` (`/machines/handover`), `sixhi`/`process` queues & start/claim |

**Tiers:** 1 = push all in · 2 = lengthen delta intervals OK · 3 = never silent-overwrite shared rows.
