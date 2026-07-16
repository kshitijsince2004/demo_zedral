# Database Architecture Audit — ZedralV2 / M1 Digital Data Collection

**Scope:** `@m1/server` package — PostgreSQL schema (baseline `doc/m1/M1_schema.sql`
plus `packages/server/migrations/*`) compared against the tables the server code
actually reads/writes (`selectFrom` / `insertInto` / `updateTable` / `deleteFrom`
and raw `sql` in `packages/server/src`).

**Method:** tables defined in the DB were extracted from the baseline SQL file and
every migration (`CREATE TABLE` + `pgm.createTable`). Tables used by code were
extracted from all Kysely builder calls and raw SQL. The two sets were diffed.

**Headline numbers**

| Set | Count |
| --- | --- |
| Tables defined in the DB | ~90 |
| Tables referenced by server code | ~79 |
| Phantom (code → missing table) | 2 live + 1 residue |
| Dead (DB table → no code) | 11 |
| Duplicate / overlapping clusters | 6 |

**Root cause in one line:** the schema carries **two generations of the data model
at once** — a classic per-form *process* model (Gen-A) and a machine/order-centric
model (Gen-B). The code has largely moved to Gen-B; the schema still holds all of
Gen-A plus the debris from each migration step. That is why code and DB feel out of
sync.

> ⚠️ **Before dropping anything:** "unused by code" ≠ "safe to drop." Master/reference
> tables are often FK targets or seed data enforced by the DB even when no query
> SELECTs them. Run the verification queries in [Section 6](#6-pre-drop-verification-queries)
> against a production-like DB before any destructive change.

---

## 1. Phantom tables — code references a table the DB does not have

| Referenced in code | Reality | Verdict |
| --- | --- | --- |
| `txn.coils` | Does not exist. Only user is `CoilTraceabilityService`, which **nothing imports**. Real coil identity lives in `coil.coil`. | **Delete the service** (`CoilTraceabilityService.ts`). Dead code against a non-existent table. |
| `txn.coil_process_history` | Same — only referenced by the orphaned `CoilTraceabilityService`. Real history is tracked via `planning.order_journey_step`. | **Delete with the service.** |
| `txn.crm` | Leftover from the `crm6_redesign` migration; superseded by `txn.crm6_order`. Survives only in type definitions, no real query. | **Remove from types / drop table** after confirming zero rows. |

**Action:** delete `packages/server/src/services/CoilTraceabilityService.ts`.

---

## 2. Stale generated types

| Symptom | Detail | Verdict |
| --- | --- | --- |
| `db-types.ts` maps `txn.skp_pass` **and** `txn.prod_skp_pass` to the same interface | `txn.skp_pass` does not exist in the DB. The generated types were not regenerated after a rename. | Re-run `kysely-codegen` and commit. Harmless at runtime but misleading. |

**Action:** regenerate `packages/server/src/db-types.ts` from the live schema.

---

## 3. Dead tables — defined in the DB, no code touches them

Ordered by importance.

| Table | Why it's dead | Verdict |
| --- | --- | --- |
| `audit.change_request` | The **post-lock correction workflow is unwired** — the table exists but there is no service reading/writing it. Biggest functional gap vs. the documented design. | **Decide:** wire the correction workflow, or drop the table + docs. |
| `coil.coil_process_history` | The *real* coil-history table, but code never writes it; history is tracked through `planning.order_journey_step` (Gen-B). | **Drop after confirming** `order_journey_step` fully replaces it. |
| `txn.prod_glv` | GLV process registered in `auditedTables`, the process-id map, and reporting, but **never inserted or selected** — no GLV capture path exists. | **Finish or remove** the GLV feature. |
| `canon.cost_rate` | Canonical model table, unused (only `equipment_node` / `event` / `production_count` are live). | Keep only if canonical costing is on the roadmap; else drop. |
| `canon.personnel` | Canonical personnel table, unused. | Same as above. |
| `security.tenant` | Tenant is resolved via the `app.tenant_id` GUC only; the table is never queried by code. | Likely FK target for `tenant_id` columns — **verify FK before dropping** (probably keep). |
| `master.furnace` | FK target for annealing, but never SELECTed by code. | **Keep** (FK/seed) — see verification queries. |
| `master.rp_oil_grade` | Coded reference for CRS oil grade; FK target, not read directly. | **Keep** (FK/seed). |
| `master.surface_finish` | Coded reference; FK target, not read directly. | **Keep** (FK/seed). |
| `master.crm_sub_process` | 2HI/4HI/6HI sub-process master; unused by current queries. | Verify against 6HI code before dropping. |
| `master.line_area` | DPR line-area master; unused by current queries. | Verify against DPR/export before dropping. |

---

## 4. Duplicate / overlapping clusters — the core architecture smell

The plant's data is modeled twice. This maps one-to-one onto the two shift-handover
models and is the main thing to consolidate.

| Concept | Gen-A (classic per-form) | Gen-B (machine / order-centric) |
| --- | --- | --- |
| Cold-rolling capture | `txn.prod_crm` | `txn.crm6_order` + `crm6_rolling` + `crm6_rolling_pass` + `crm6_skinpass` + `crm6_shift_summary` |
| Stoppages | `txn.stoppage_entry` (~9 files) | `txn.order_stoppage` (~7 files) |
| Crew | `txn.crew_entry` | `master.machine_crew_roster` |
| Process / coil history | `coil.coil_process_history` (dead) | `planning.order_journey_step` (live) |
| Skin pass | `txn.prod_skp` / `txn.prod_skp_pass` | `txn.crm6_skinpass` |
| Shift handover | `txn.shift_log` attestation columns (`handover_*`, `prev_shift_log_id`) | `txn.machine_handover` + `txn.machine_shift_session` |

Each row is one concept stored two ways. Keeping both means every report, export,
and analytic has to reconcile two sources.

---

## 5. Recommended optimization plan (phased)

Direction of travel is Gen-B (order flows machine-to-machine). Standardize on it and
retire Gen-A's redundant tables. Do it in phases so nothing goes dark.

**Phase 0 — safe deletions (no behavior change)**
- Delete `CoilTraceabilityService.ts` (phantom `txn.coils`, `txn.coil_process_history`).
- Regenerate `db-types.ts` (drops `txn.skp_pass`, `txn.crm`).
- Drop `txn.crm` table after a zero-row check.

**Phase 1 — decide the half-wired features**
- `audit.change_request`: wire the correction workflow **or** drop table + doc.
- `txn.prod_glv`: implement GLV capture **or** remove from registries and drop.

**Phase 2 — collapse the duplicate clusters (one at a time)**
1. Stoppages → single table (fold `order_stoppage` semantics into `stoppage_entry`, or vice-versa).
2. Crew → single source (`crew_entry` vs `machine_crew_roster`).
3. History → single source (`order_journey_step`), drop `coil.coil_process_history`.
4. Cold rolling → decide `prod_crm` vs `crm6_*` end-state; plan deprecation of the loser.
5. Handover → Model B (`machine_handover` + `machine_shift_session`); see the handover
   impact analysis for what must be ported first.

**Phase 3 — prune canonical + master leftovers**
- Drop unused `canon.*` tables if canonical costing/personnel is not on the roadmap.
- Keep FK/seed master tables; verify each with Section 6.

---

## 6. Pre-drop verification queries

Run these against a production-like database before dropping any "dead" table. A table
with **no inbound FKs and zero rows** is safe; anything else needs a migration plan.

```sql
-- 6.1 Inbound foreign keys to a candidate table (are other tables pointing at it?)
SELECT
  c.conrelid::regclass AS referencing_table,
  a.attname            AS referencing_column,
  c.confrelid::regclass AS referenced_table
FROM pg_constraint c
JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
WHERE c.contype = 'f'
  AND c.confrelid = 'master.furnace'::regclass;   -- <-- candidate table

-- 6.2 Row count for a candidate table
SELECT count(*) FROM master.furnace;               -- <-- candidate table

-- 6.3 All tables + row estimates, to spot empty tables quickly
SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup ASC, schemaname, relname;

-- 6.4 Confirm a "phantom" table truly does not exist
SELECT to_regclass('txn.coils') AS coils,
       to_regclass('txn.coil_process_history') AS coil_history,
       to_regclass('txn.crm') AS crm;
```

Interpretation: for each candidate, if 6.1 returns rows, other tables depend on it →
keep or migrate the dependents first. If 6.1 is empty and 6.2 is 0 → safe to drop.

---

## 7. Appendix — table inventory

**Phantom (code references, not in DB):** `txn.coils`, `txn.coil_process_history`, `txn.crm`

**Dead (in DB, unreferenced by code):** `audit.change_request`, `coil.coil_process_history`,
`txn.prod_glv`, `canon.cost_rate`, `canon.personnel`, `security.tenant`, `master.furnace`,
`master.rp_oil_grade`, `master.surface_finish`, `master.crm_sub_process`, `master.line_area`

**Duplicate clusters:** cold-rolling (`prod_crm` vs `crm6_*`), stoppages
(`stoppage_entry` vs `order_stoppage`), crew (`crew_entry` vs `machine_crew_roster`),
history (`coil_process_history` vs `order_journey_step`), skin pass (`prod_skp*` vs
`crm6_skinpass`), handover (`shift_log.handover_*` vs `machine_handover`).

*Counts are approximate (±) because a few tables are created via `pgm.createTable`
object-form and a few code references are dynamic. Treat this as the map, and confirm
each specific table with Section 6 before acting.*
