# Production Fix — Implementation Plan

**Repo:** ZedralV2 / M1 Digital Data Collection (Hero Steels)
**Date:** 2026-08-05
**Author:** QA audit → remediation plan
**Scope:** the verified gaps from the pre-production audit (HRS mass-balance, migration ordering, stale generated types, dead code, structural duplication).

---

## Governing principles (read first)

These two constraints shape every task below.

1. **No functional regression.** Every change is one of: (a) a correctness fix *behind an unchanged API/UI contract*, (b) a pure deletion of code proven to have zero references, or (c) a metadata/tooling change with no runtime effect. Nothing here alters an operator's screens or a working flow's inputs/outputs. Each change is gated by a test that captures current good behaviour *before* the fix lands.
2. **Root-cause, not patch-wise.** We fix causes, in shared single-source locations, not symptoms at call sites:
   - Slit weight/thickness logic goes into **one shared, tested helper** (not inline `??` chains copied per line).
   - Scrap % is computed by **one** function used by client and server (removes the client/server disagreement at the source).
   - Generated artefacts (`db-types.ts`) are **regenerated from the migrated DB**, not hand-edited.
   - Migration ordering is fixed by **correcting the filenames and reconciling history**, not by adding a compensating migration.
   - Dead tables/routes are **removed with guards + down-migrations**, staged, never force-dropped.

**Definition of done for the whole plan:** on CI (Linux) `npm run build`, `npm test`, `npm run arch:check`, and `npm run e2e:smoke` are green; a mass-balance reconciliation report shows child-coil tonnage ≈ mother tonnage; a fresh `npm run migrate` and an existing-DB `npm run migrate` both succeed and produce identical schema.

---

## Phase 0 — Safety net & baseline (do before any fix)

Purpose: make "don't break functionality" *provable* rather than hoped-for.

| # | Task | Detail | Risk |
|---|------|--------|------|
| 0.1 | Green baseline on Linux | The suites can't run on the current Windows-built `node_modules`. On a Linux runner (or WSL/CI) do a clean `npm ci`, then record baseline results of `npm run build`, `npm test`, `npm run arch:check`, `npm run e2e:smoke`. This is the reference we must not regress. | None |
| 0.2 | Prod-like DB snapshot | Restore a copy of production (or pilot) data into a scratch DB. All migration/backfill steps below are dry-run here first. | None |
| 0.3 | Characterization tests for HRS fan-out | Before touching code, add a test that spawns children from a mother coil and **asserts today's (wrong) behaviour** (child = mother weight). This proves the test is wired; Phase 1 then flips the assertion to the correct one. Extend `packages/server/tests/` alongside `combinedEndProduction.test.ts` / `hrsRouteFlags.unit.test.ts`. | None |

Exit criterion: baseline recorded, scratch DB ready, HRS characterization test runs.

---

## Phase 1 — BLOCKER: HRS child-coil mass balance (HRS-1, HRS-2, HRS-3)

**Root cause.** `saveHrs` persists `planned_weight_mt` and `planned_thk_mm` onto `txn.prod_hrs_slit` (`ProductionService.ts:153,147`), but the fan-out consumer never reads them: `loadHrsSlits` doesn't select them (`JourneyAdvanceConsumer.ts:83-94`) and `spawnChildCoils` falls back to `mother.weight_mt` / `mother.coil_thk_mm` (`:282-286,:297`). Result: every child coil is minted at the mother's full weight — a 20 MT coil slit 4 ways creates 80 MT of stock. Scrap % additionally uses different denominators on client vs server, and the server value wins.

**Fix (single shared source, behaviour-preserving for the happy path where a live weight *is* captured):**

1. **New shared helper** `packages/shared-validation/src/utils/slitAllocation.ts` (mirrors the existing `combinedWeightAllocation.ts` pattern), exported from `src/index.ts`:
   - `resolveSlitWeightMt(slit, motherWeightMt, allSlits)` → precedence: `actual_weight_mt ?? planned_weight_mt ?? widthProportionalShare(slit, allSlits, motherWeightMt)`. Width share = `slit.width_mm / Σ width_mm × motherWeightMt`, with divide-by-zero guard (fall back to equal split, never to full mother weight).
   - `resolveSlitThkMm(slit, motherThkMm)` → `thk_latest_mm ?? planned_thk_mm ?? actual_thk_front_mm ?? motherThkMm`.
   - Pure functions, fully unit-tested (property test: `Σ child weight ≈ mother weight ± rounding`, never `N × mother`).
2. **`loadHrsSlits`** (`JourneyAdvanceConsumer.ts:83`): add `planned_weight_mt`, `planned_thk_mm` to the `.select([...])`, and add them to the `SlitSlotRow` interface (`:20-33`).
3. **`spawnChildCoils`** (`:281-297`): replace the inline `wt`/`thk` `??`-chains with calls to the two shared helpers. No other line of the function changes.
4. **Scrap % single-source (HRS-3):** compute scrap once via `calculateScrapPct` in `calculationEngine.ts` with an agreed denominator (recommend **mother input weight**, matching the client at `HrsSlitBuilder.tsx:148`), and have the server use the same call so it can't overwrite with a divergent value (`JourneyAdvanceConsumer.ts:~458`). Document the chosen denominator in the helper's JSDoc.
5. **Idempotency/transaction (HRS-4):** wrap child-coil spawn + journey step creation in one transaction keyed on `(entry_id, slot)` so a retry can't double-spawn. This preserves the current outcome on the success path; it only removes the double-spawn on retry.

**Historical data reconciliation (required — forward fix alone leaves bad rows).**
Add a one-off, **idempotent** reconciliation script `scripts/reconcile-hrs-child-weights.mjs` (not a schema migration): for each child coil spawned from an HRS slit, recompute `coil.coil.weight_mt` / `coil_thk_mm` from `planned_weight_mt`/width share, but **only** where the value currently equals the mother's (i.e. the bug signature) and no downstream process has already consumed a corrected weight. Dry-run on the Phase 0 scratch DB; produce a before/after tonnage diff report for sign-off before running on prod.

**Tests:** flip the Phase 0 characterization test to assert correct mass balance; add thickness-precedence test; add scrap-denominator parity test (client helper == server helper).

**Preserves functionality because:** operator inputs, screens, and the capture API are untouched; when an actual weight/thickness *is* captured (the normal case) the resolved value is identical to today. Only the previously-wrong fallback path changes.

**Rollback:** revert the consumer commit; the shared helper is additive. The reconciliation script is idempotent and has a recorded before-image.

---

## Phase 2 — Deployment integrity: migration order + generated types

### 2.1 Fix the 13-vs-14-digit migration prefixes

**Root cause.** Three files use 14-digit timestamps — `19590000000000_ppc_hrs_slit_plan_table`, `19600000000000_pkl_order_batch_key`, `19610000000000_manual_reroll_session` — which sort *after* every 13-digit migration. A fresh DB and an already-migrated DB can therefore apply migrations in different orders, and any future 13-digit migration would slot before these on fresh installs.

**Fix (rename + reconcile history — not a compensating migration):**
1. Rename the three files to consistent 13-digit prefixes that **preserve their intended relative order** and sit above the current max (`1960000000000`). E.g. `1961000000000_ppc_hrs_slit_plan_table`, `1962000000000_pkl_order_batch_key`, `1963000000000_manual_reroll_session`. Confirm no code imports them by filename (migrations are loaded by directory, so safe).
2. **Existing databases already recorded the old names** in `pgmigrations`. Extend the existing `scripts/repair-migration-history.mjs` (or a small dedicated step) to `UPDATE pgmigrations SET name = <new> WHERE name = <old>` for the three, run once per existing environment *before* the next `npm run migrate`. Fresh DBs need nothing.
3. **Verify both paths on the scratch DB:** (a) fresh `npm run migrate` from empty; (b) restore an existing snapshot, run the history-repair step, then `npm run migrate` (must be a no-op for these three). Diff the resulting schemas — they must be identical.

**Preserves functionality because:** no schema changes; only file names and a one-time metadata reconciliation. Runtime behaviour is unchanged.

**Rollback:** rename back; reverse the `pgmigrations` UPDATE (recorded before-image).

### 2.2 Regenerate `db-types.ts` from the migrated schema

**Root cause.** `db-types.ts` still declares `audit.lineage_ref`, dropped in `1949_drop_unused_tables` — the generated types have drifted, giving false type-safety and hiding dead queries.

**Fix:**
1. Add an npm script `"db:codegen": "kysely-codegen --out-file src/db-types.ts ..."` (dependency already present at `packages/server/package.json:78`).
2. Migrate the scratch DB fully, run `db:codegen`, commit the regenerated file.
3. Compile. Drift (e.g. the removed `audit.lineage_ref`) now surfaces as **compile errors**, which Phase 3 resolves by deleting the dead code that referenced it. Wire `db:codegen` into CI as a drift check (fail if regenerating produces a diff).

**Preserves functionality because:** types are compile-time only. Regenerating cannot change runtime behaviour; it only makes the compiler honest.

---

## Phase 3 — Dead code removal (behaviour-neutral)

Each item below was verified at **zero references** during the audit. Remove as **one reviewable PR**, typecheck + test after each deletion.

| File | Evidence | Note |
|------|----------|------|
| `packages/server/src/services/lineageService.ts` | 0 imports; queries the dropped `audit.lineage_ref` via `as any` | Deleting it also clears a Phase-2.2 compile error |
| `packages/server/src/audit/auditedTables.ts` | 0 references (incl. string/dynamic) | Confirm no migration/trigger reads it by name before delete |
| `packages/server/src/export/dpr/DprMappingAudit.ts` | 0 references; DPR schema was dropped (`1928…_drop_dpr_schema`) | |
| `packages/server/src/reporting/plantHeadValidators.ts` | 0 references | |
| `packages/client/src/components/sixHi/SixHiShiftSummaryPanel.tsx` | 0 references | |

Also: route the **17 `console.log`** in `src` through the existing `logger`, and clean the `CoilTraceabilityService` phantom-table reference noted in `doc/audit/DB_AUDIT.md` if the file still exists.

**Preserves functionality because:** nothing imports these; `arch:deps` + full typecheck + tests prove the app builds and behaves identically after removal.

**Rollback:** single revert of the deletion PR.

---

## Phase 4 — Structural consolidation (design-first; staged, not patched)

These are larger and must be **spec'd before coded**. They are sequenced last because they carry the most surface area. None is a quick patch; each is a controlled migration off a duplicated/legacy path with a deprecation window.

### 4.1 Converge the duplicate HRS/PKL route systems
Both `/hrs-order` + `/pkl-order` (`hrsOrderRoutes`, `pklOrderRoutes`) and the generic `/stations/*` engine (`processStationRoutes`) are mounted and both are called from `processStore.ts` on the same flows. Approach: (1) write a short design note choosing `/stations/*` as canonical (it already serves ANN and is the newer model); (2) add contract tests over both today so behaviour is pinned; (3) migrate client callers to the canonical routes; (4) keep the legacy routes as thin deprecated shims for one release; (5) remove after a green release. Behaviour-preserving throughout via the contract tests.

### 4.2 Retire the "Gen-A" data-model residue
`doc/audit/DB_AUDIT.md` diagnoses two model generations coexisting (per-form Gen-A + machine/order Gen-B), with ~11 dead tables and 6 duplicate clusters (numbers already reduced by recent `drop_*` migrations). Approach: (1) re-run the DB_AUDIT §6 pre-drop verification queries against the prod-like snapshot to get the *current* dead set; (2) for each dead table, one migration with a **row-count guard** (abort if non-empty unless explicitly confirmed) and a real `down`; (3) regenerate `db-types.ts` after each; (4) never batch-drop. Master/reference tables that are FK targets or seed data are **kept** even if unqueried.

### 4.3 `as any` burn-down
301 `as any` casts erode type safety and are what let the dropped-table query slip through. After Phase 2.2 regenerates types, prioritise removing the casts on DB query builders (most become unnecessary once types are correct). Track as a ratcheting lint rule (count may not increase).

---

## Phase 5 — Verification & pre-prod gates

| Gate | Check |
|------|-------|
| Build/typecheck | `npm run build` green on CI (Linux) |
| Unit + integration | `npm test` green across all workspaces |
| Architecture | `npm run arch:check` (boundaries + dep-cruiser) green |
| Migrations | fresh-migrate and existing-migrate produce identical schema; `db:codegen` drift check clean |
| E2E | expand beyond the 2 current specs: one capture→submit→handover happy-path per active line (HRS, PKL, ANN, ROLLING, RWD) |
| Data | HRS mass-balance reconciliation report signed off (child tonnage ≈ mother tonnage) |
| Docs | refresh `PROJECT_STRUCTURE.md` (currently references removed pages/services) |

---

## Sequencing & dependencies

```
Phase 0  (safety net)            ── must precede everything
   │
Phase 1  (HRS blocker)           ── independent; highest value; ship first
   │
Phase 2  (migrations + types)    ── 2.2 depends on 2.1; enables Phase 3 deletions
   │
Phase 3  (dead code)             ── depends on 2.2 (compile-error-driven cleanup)
   │
Phase 4  (structural)            ── design-first; each item its own PR + deprecation window
   │
Phase 5  (gates)                 ── continuous; final sign-off
```

**Suggested delivery order of PRs:** 0.3 characterization → 1 (HRS + reconciliation) → 2.1 (prefixes) → 2.2 (codegen) → 3 (dead code) → 4.1 → 4.2 (staged) → 4.3 → 5 (e2e + docs).

## Risk summary

| Phase | Blast radius | Reversibility |
|-------|--------------|---------------|
| 0 | none (tests/infra) | n/a |
| 1 | HRS write path only; happy path unchanged | revert consumer commit; reconciliation is idempotent w/ before-image |
| 2.1 | migration metadata | rename back + reverse UPDATE |
| 2.2 | compile-time only | revert file |
| 3 | none (0-ref deletions) | single revert |
| 4 | medium; gated by contract tests + deprecation window | staged; per-item revert |
| 5 | none | n/a |
