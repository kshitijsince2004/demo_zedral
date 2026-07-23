# ZedralV2.2 — Platform-Wide Implementation Spec: Import Dedupe, Combine Key, Combined Hold

_Supersedes the 6HI-scoped spec (`ZedralV2.2_M1_ChangeSet_Import_Combine_Hold_SPEC.md`). Scope decision (confirmed): Task 1 platform-wide; Tasks 2 & 3 to cover **all machines**, including net-new combine + hold for the all-process mills._

---

## 0. The architecture that drives scope

The platform has **two capture engines**, and each task lands differently on each:

| Engine | Machines | Model | Code |
|--------|----------|-------|------|
| **CRM rolling engine** | **6HI, 4HI, 2HI** | Order lifecycle: `planning.ppc_batch` + `txn.crm_order` (PENDING→PREPARING→IN_PROGRESS→COMPLETED/REJECTED), queue, **combine**, **hold** | `SixHiService` (misnamed — it's the shared CRM engine, keyed by `machine_code`+`sub_process`; `CRM_MILL_CODES = ['6HI','4HI','2HI']`), `sixHiRoutes` (`/6hi`), `PPCImportService` |
| **All-Process engine** | **HRS, PKL, ANN, RWD, CRS, CTL** | Stateless per-coil capture into `txn.prod_*` / `txn.ann_charge`, tracked by the **journey engine** (`planning.order_journey`). Unit of work = **`coil.coil`** (status PLANNED/IN_PROCESS/DONE). **No order queue, no combine, no hold today.** | `modules/m1-collection` (`ProductionService`, `productionRoutes` `POST /production/{hrs,pkl,ann,skp,rwd,crs,ctl}`), `ProcessRouteService`, `JourneyAdvanceConsumer` |

**Consequence:**
- **Editing `SixHiService` already covers all three CRM mills** (6HI/4HI/2HI) — Tasks 2 & 3 there are a shared-engine change, not 6HI-only.
- **The all-process mills have nothing to edit** — combine and hold don't exist there. Extending Tasks 2 & 3 to them is **net-new feature work** on the coil/journey model, and some processes may not support the concepts (see §4 matrix).

This spec is therefore in two tiers: **Tier A — ready to implement** (import + CRM engine) and **Tier B — net-new build** (all-process combine + hold, needs the §5 business answers before coding).

---

# TIER A — Ready to implement

## Task 1 — Import: dedupe duplicates (keep one), don't reject the file  → platform-wide

**Confirmed single intake.** The duplicate-reject exists **only** in `PPCImportService` (verified: no other importer — `ImportService`, `ProductionService`, etc. — has duplicate-reject logic). `PPCImportService` is the platform's PPC/rolling-plan order intake; coils it creates flow through the journey to every downstream process. So fixing it is genuinely platform-wide.

Three spots in `server/src/services/PPCImportService.ts`, all labelled *"In-file duplicate detection (hard fail per policy)"* — replace hard-fail with **keep-first dedupe**:

**1a. `commitRollingSession` (~L854):**
```ts
// ── Phase 1: In-file duplicate handling — keep first occurrence, skip the rest ──
const seenBatch = new Set<string>();
const dedupedRows: typeof rowsToCommit = [];
const skippedDuplicateRows: number[] = [];
for (const row of rowsToCommit) {
  if (seenBatch.has(row.batchNumber)) { skippedDuplicateRows.push(row.rowNum); continue; }
  seenBatch.add(row.batchNumber);
  dedupedRows.push(row);
}
const skippedDuplicates = skippedDuplicateRows.length;
```
Use `dedupedRows` for the commit loop, `import_batch.row_count`, the final `row_count` update, and `syncedRows`; set `skippedDuplicates` in the return (currently hard-coded `0`).

**1b. `importFromCsvText` (~L584):** same keep-first pattern on `parsed.rows`; set `skippedDuplicates`.

**1c. `previewRollingXlsx` (~L757):** precompute the first-occurrence set **before** the async `map` (avoid a race), mark only later copies `'duplicate-skipped'`, let the first flow through normal enrichment. Add `'duplicate-skipped'` to `PreviewRowStatus` + a client badge.

**Decision (confirm):** tie-break = keep **first** occurrence. (Alt: last, or most-complete.)

**Tests:** duplicated batch imports the rest with `skippedDuplicates>0` and one persisted; distinct-batch same-coil still both insert; preview shows first normal + later `duplicate-skipped`.

## Task 2A — Combine key (CRM mills 6HI/4HI/2HI): drop thickness, use Coil+Slit+Finish-family

Shared-engine edit → applies to all three CRM mills automatically.

**Server — `SixHiService.startCombinedProduction` (~L1128):**
```ts
const first = batches[0];
const normalized = (v: string | null | undefined) => v?.trim() || '';
// Finish-surface family: LOW_MATT ≡ MATT, MIRROR ≡ BRIGHT
const finishGroup = (v: string | null | undefined) => {
  const s = normalized(v).toUpperCase().replace(/[\s-]+/g, '_');
  if (s === 'M' || s === 'MATTE' || s.includes('MATT')) return 'MATT';
  if (s === 'B' || s === 'BRIGHT' || s === 'MIRROR') return 'BRIGHT';
  return s;
};
const baseKey = [first.coil_no, normalized(first.slit_id), finishGroup(first.roll_finish)].join('|');
// per-batch loop:
const key = [batch.coil_no, normalized(batch.slit_id), finishGroup(batch.roll_finish)].join('|');
if (key !== baseKey) throw new Error('Selected orders must share Mother Coil, Slit ID, and Finish surface');
```
Removes the `thicknessKey`/`thicknessLabel` helpers; the thickness columns in the `select` become unused.

**Client — `client/src/lib/sixHiOrderIdentity.ts` `combinedRunKey`:** drop thickness, add the identical `finishGroupOf` fold; delete now-unused `combinedRunThicknessKey`. Keep server↔client folds byte-for-byte equal.

**Data note:** parsers canonicalize finish to `MATT`/`LOW_MATT`/`BRIGHT`; **`MIRROR` is never produced** (raw "MIRROR" → `undefined` today). If operators actually enter "MIRROR", add `MIRROR → BRIGHT` to `normalizeFinish`/`normalizeRollFinish` too.

**Kept guards:** machine-allocated, same `machine_code`, same `sub_process`, active-order conflict. (Confirm if you also want same-machine/sub-process relaxed.)

## Task 3A — Combined hold (CRM mills): hold one → hold the whole run

Uses the **dead `combined_group_id` column** (migration `1930`, currently never read/written).

**3a. Stamp the group at start** — `startCombinedProduction`:
```ts
if (uniqueBatchNumbers.length > 1) {
  const groupId = randomUUID();
  await db.updateTable('txn.crm_order').set({ combined_group_id: groupId })
    .where('batch_number', 'in', uniqueBatchNumbers).execute();
}
```

**3b. Cascade the hold** — `rejectOrder`: extract the single-order body into `rejectSingleOrder(...)`, then:
```ts
const grp = await db.selectFrom('txn.crm_order').select('combined_group_id')
  .where('order_id', '=', orderId).executeTakeFirst();
let targets = [{ order_id: orderId, batch_number: batchNumber }];
if (grp?.combined_group_id) {
  targets = await db.selectFrom('txn.crm_order').select(['order_id','batch_number'])
    .where('combined_group_id', '=', grp.combined_group_id)
    .where('status', 'in', ['IN_PROGRESS','STOPPAGE','PENDING','PREPARING']).execute();
}
// apply same reason/remarks/defectCodes to each target, one transaction
```
Add a status guard so re-holding an already-`REJECTED` order is a no-op.

**3c. Client** — `SixHiLayout.tsx onReject`: post once to the triggered batch and refresh; drop the `Promise.all` over `batchNumbers` and the `!rejectionBatch` special-casing (server now cascades).

**Decision (confirm):** should **reinstate** (un-hold) cascade across the group symmetrically? If yes, mirror the `combined_group_id` lookup in `reinstateOrder`.

---

# TIER B — Net-new build: combine + hold for the all-process mills

The all-process engine has **no order/queue/combine/hold** — the unit of work is the **coil** (`coil.coil`, status PLANNED/IN_PROCESS/DONE) moving through `planning.order_journey`. Capture is `POST /production/{proc}` → insert `txn.prod_*` → emit `production.captured` → `JourneyAdvanceConsumer` advances the step. To add combine + hold we anchor on the **coil + journey**, not on orders.

## 1. Data model additions (migrations)

- **Hold state:** add `hold_status` + hold metadata to the journey (or coil). Recommended: a `planning.order_journey.status` value **`HOLD`** (today only `ACTIVE`), plus a `txn.coil_hold` record table (`coil_no`, `process_code`, `reason`, `defect_codes`, `remarks`, `operator_id`, `tenant_id`, `created_at`) — the all-process analogue of `txn.order_rejection`.
- **Combine grouping:** add `combined_group_id uuid NULL` to the coil/journey (analogue of `crm_order.combined_group_id`), indexed. Set when an operator starts a combined run for a process.
- Reuse the **finish-family** normalizer from Task 2A (promote it to `shared-validation` so CRM + all-process + client share one implementation).

## 2. Combine — server + endpoints

- New: `POST /production/{proc}/start-combined` (or a shared `/production/combine`) taking a set of `coil_no`s, validating they share **Mother Coil + Slit ID + Finish-family** (same rule as Task 2A, thickness dropped) and are on the **same process/machine** and in a combinable state (PLANNED/IN_PROCESS). Stamp a shared `combined_group_id`.
- Capture (`save*`) becomes group-aware: submitting production for one coil in a group applies/annotates the run for the group as configured (per-process — see matrix).

## 3. Hold — server + endpoints + journey guard

- New: `POST /production/{proc}/hold` taking `coil_no` (+ reason/remarks/defects). Writes a `txn.coil_hold` row, sets journey `status='HOLD'`, and if the coil has a `combined_group_id`, **cascades to every coil in the group** still in a holdable state (mirrors Task 3A).
- **Journey-advance guard (critical):** `JourneyAdvanceConsumer` must **skip/He-block held coils** — a held coil must not advance on a stray `production.captured`. This is the all-process equivalent of "end production immediately" in CRM. (Consumer already must try/catch + never re-throw per the locked design decision.)
- New: `POST /production/{proc}/reinstate` to clear the hold (symmetry per §5 decision).

## 4. Per-process applicability matrix (needs sign-off)

Combine and Hold do **not** map equally to every process. My read of the capture model:

| Process | Combine (multi-coil run sharing coil+slit+finish) | Hold (pause coil/journey) | Notes |
|---------|---|---|---|
| **HRS** (hot rolling) | Likely yes (has slit children) | Yes | Closest to CRM rolling. |
| **CRS** (slitting) | Likely yes (slit children) | Yes | Child-coil model like HRS. |
| **PKL** (pickling) | Maybe (usually single coil) | Yes | Combine may be rare operationally. |
| **RWD** (rewinding) | Probably not (single coil) | Yes | Hold clearly applies; combine unclear. |
| **CTL** (cut-to-length) | Probably not | Yes | Single-coil throughput. |
| **ANN** (annealing) | **Charge already = a group** | Hold the **charge**, not coil | ANN is charge-based; "combine" ≈ existing charge; hold must operate at charge level. Journey advance is charge-DONE fan-out (per locked design), so hold logic differs. |

**→ Recommendation:** ship Hold across all six (universally meaningful), and combine only where it maps (HRS, CRS, and possibly PKL) — but this needs your confirmation (§5).

## 5. Open business decisions (blockers for Tier B coding)

1. **Which processes get Combine?** (Matrix above — confirm HRS/CRS/PKL vs all six.)
2. **What does "combine" produce operationally** for a non-rolling line — a shared production entry, or just grouped hold/advance? Define the run semantics per process.
3. **ANN:** confirm hold + combine operate at **charge** granularity, not coil.
4. **Hold semantics:** does a held coil/charge stop the journey entirely until reinstated, or just flag it? Does hold require reason+defects like CRM?
5. **Reinstate symmetry** (applies to CRM too): un-hold one → un-hold the group?

---

## Consolidated change-set

**Tier A (implement now)**
- `server/src/services/PPCImportService.ts` — Task 1 (3 spots) + `PreviewRowStatus` `'duplicate-skipped'`.
- `server/src/services/SixHiService.ts` — Task 2A (key) + Task 3A (group stamp, `rejectOrder` cascade, `rejectSingleOrder`, status guard).
- `client/src/lib/sixHiOrderIdentity.ts` — Task 2A (key, `finishGroupOf`, delete `combinedRunThicknessKey`).
- `client/src/components/sixHi/SixHiLayout.tsx` — Task 3A (simplify `onReject`).
- Preview status UI — `'duplicate-skipped'` badge.
- Activates existing `combined_group_id` column (migration `1930`) — remove from cleanup radar.

**Tier B (build after §5 sign-off)**
- Migrations: journey `HOLD` status + `txn.coil_hold` + coil/journey `combined_group_id`.
- `shared-validation`: promote `finishGroup` + shared combine-key + statuses.
- `modules/m1-collection`: `ProductionService` (combine + hold + cascade), `productionRoutes` (`start-combined`, `hold`, `reinstate`), **`JourneyAdvanceConsumer` held-coil guard**.
- All-process operator UI (capture workspace): combine selection + hold action + held/combined badges.

**Effort:** Tier A ≈ small (edits to existing engine). Tier B ≈ multi-week feature (schema + services + journey consumer + UI + per-process rules), gated on §5.

**Verification gate (both tiers):** `npm run test`, `npm run arch:check`, `npm run e2e:smoke` green, plus per-task tests and (Tier B) a held-coil-does-not-advance-journey test.
