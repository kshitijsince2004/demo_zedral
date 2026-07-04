# D12b — Modular Monolith Stack Adaptation (TypeScript)
**Status:** Accepted · **Date:** 2026-06-22 · **Supersedes:** nothing · **Relates to:** D12, D12a

---

## Decision

D12 and D12a are **binding on principles**; this document adapts the implementation blueprint to the **actual Zedral V2 stack**:

| D12a assumption | Zedral implementation |
|-----------------|-------------------------|
| Python 3.11 + FastAPI | **Node 20+ / TypeScript + Express** |
| SQLAlchemy | **Kysely** |
| Alembic per-module | **node-pg-migrate** (`migrations/` + `migrations/modules/<m>/`) |
| import-linter | **dependency-cruiser** + architecture vitest |
| `app/main.py` composition root | **`packages/server/src/app.ts`** |
| `platform/` package | **`@zedral/platform`** workspace package |
| `modules/m2_maintenance/` | **`@zedral/m2-maintenance`** + `server/src/modules/m2-maintenance/` |
| `connectors/` separate image | **`@zedral/connectors`** + `deploy/connectors/Dockerfile` |

All golden rules from D12a Part A remain unchanged.

## Repository layout (as built)

```
zedral_m2/
├── packages/
│   ├── platform/                 # @zedral/platform — shared kernel
│   ├── connectors/               # @zedral/connectors — M1 edge (separate deploy)
│   ├── modules/
│   │   └── m2-maintenance/       # @zedral/m2-maintenance — manifest + bootstrap
│   ├── server/                   # @m1/server — composition root + M1 core
│   ├── client/
│   └── shared-validation/
├── doc/D12_Schema_Ownership_Map.md
└── .dependency-cruiser.cjs
```

## Module codes

| Code | Package / path | Postgres schema(s) |
|------|----------------|-------------------|
| M1 | `server` (collection) + `@zedral/connectors` | `ops`, `planning`, `master` (reference) |
| M2 | `@zedral/m2-maintenance` | `maint` |
| — | `@zedral/platform` | `canon`, `security` (kernel) |

M3–M7 follow the same pattern when implemented (`plan`, `oee`, `yield_`, `qual`, `energy`).

## Enforcement

CI runs `npm run arch:check` (dependency-cruiser + manifest tests) before unit tests. A boundary violation fails the build.
