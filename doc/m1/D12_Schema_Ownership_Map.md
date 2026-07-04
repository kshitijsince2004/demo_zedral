# D12 Schema Ownership Map
**Relates to:** D12, D12a, D12b

Each module owns exactly one business schema. The platform kernel owns cross-cutting infrastructure schemas.

## Platform kernel (`@zedral/platform`)

| Schema | Purpose | Write access |
|--------|---------|--------------|
| `canon` | Canonical Serving zone (equipment nodes, events, personnel, cost rates) | Modules read-only; write-back API for derived facts |
| `security` | Tenants, users, roles, tenant_config, audit | Platform + auth services |
| `audit` | Append-only audit log and lineage references | Platform audit services |

## M1 — Digital Data Collection (`@m1/server` + connectors)

| Schema / area | Tables (representative) | Notes |
|---------------|-------------------------|-------|
| `txn` | shift_log, stoppage_entry, production, defects, 6HI orders | Operational truth from the line |
| `planning` | import_batch, ppc_batch, planned_coil | PPC / planning execution |
| `coil` | coil, coil_process_history | Coil genealogy |
| `master` | shift, machine, grade, stoppage_code, customer | **Shared reference data** — read by all modules; owned by M1 admin flows |
| `config` | validation_rule, ruleset_version | M1 validation configuration |
| `dpr` | DPR templates, periods, daily entries, source mappings | M1 reporting/export support |

M1 connectors (`@zedral/connectors`) transform client-specific sources into canonical events; they do not write module schemas directly.

## M2 — Maintenance Intelligence (`@zedral/m2-maintenance`)

| Schema | Purpose |
|--------|---------|
| `maint` | asset_profile, failure_mode, maintenance_plan, work_order, spares, KPIs |

M2 may **read** `canon.equipment_node`, `canon.event`, `canon.personnel`. M2 may **read** `master.stoppage_code` only via mapping table `maint.stoppage_mapping` (integration seam, not business logic JOINs into ops).

## Future modules (reserved)

| Module | Schema |
|--------|--------|
| M3 Planning | `plan` |
| M4 OEE | `oee` |
| M5 Yield | `yield_` |
| M6 Quality | `qual` |
| M7 Energy | `energy` |

## Rules

1. No module migration may `CREATE` or `ALTER` objects in another module's schema.
2. Cross-module data flows through **canonical read**, **events**, or **write-back** only.
3. `master.*` is reference data — treat as canonical-adjacent reads, not as another module's private tables.
4. `audit.*` is append-only platform infrastructure. Modules may cause audit records through platform triggers/services but must not update audit rows directly.
