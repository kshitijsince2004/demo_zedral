# Zedral — 100% Completion Implementation Plan (PKL + ANN change sets)

**Owner:** engineering
**Status:** ready to execute
**Related plans:** `ZEDRAL_PKL_OPERATOR_IMPLEMENTATION_PLAN.md`, `ZEDRAL_ANN_OPERATOR_IMPLEMENTATION_PLAN.md`
**Log convention:** append a dated entry to `doc/AGENT_CONTEXT_LOG.md` at the end of every work item below.

---

## 0. Purpose & guardrails

This plan closes the remaining gaps between the two requested change sets (PKL build-out, ANN operator + machine-head) and the current code, taking every item to 100% while keeping already-completed work intact and everything wired end-to-end.

**Hard guardrails (fragile system):**

- Do **not** alter CRM/6HI/4HI/2HI, HRS, CRS, or RWD code paths. All new behavior stays behind `isPkl` / `isAnn` / `processCode` guards, PKL/ANN-scoped routes, and PKL/ANN-only services.
- No changes to `processConfig.ts` station list, journey engine, or shared submit contracts unless explicitly called out.
- Every migration is additive and idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), with a working `down`.
- Build green gate after each item: `@m1/shared-validation` → `@m1/server` → `@m1/client`, plus targeted unit tests.

---

## 1. Current completion snapshot

| Area | Item | State |
| --- | --- | --- |
| PKL operator | Nav (Orders / Capture / Manual / Readings) | Done |
| PKL operator | Sibling auto-add (mother+slit+grade), run-together, Σ weight | Done |
| PKL operator | Production console auto-fetch + weight sum shown | Done |
| PKL operator | Readings screen (chart) | Done |
| PKL operator | "Capture → **Production Console**" rename | **Gap A1** |
| PKL machine head | Operator-aligned MH dashboard/pages | **Gap A2** (nav-only today) |
| ANN operator | I Base+History · II Batches · III Stoppage badge · IV timestamps · V reading renames · VI dynamic top nav | Done |
| ANN operator | VI label text ("Annealing" vs "ANN") | **Gap A4** (cosmetic) |
| ANN machine head | I full-screen detail · II trends · III batching search · IV order tracing · V add-base | Done |
| ANN machine head | VI shift-review **delay categories + crew roles + total delay** | **Gap A3** |
| Platform | DB bootstrap (`doc/m1/M1_schema.sql` missing) | **Gap B1** (blocker) |
| Platform | Orphan files / unused tables / migration hygiene | **Gap B2–B4** |

Legend: "Gap" = work required below.

---

# PART A — Feature completion (reach 100% on the requested change sets)

## A1. PKL — rename "Capture" → "Production Console"

**Goal:** the PKL Capture nav item and console header read "Production Console" (matches the rolling/6HI console naming).

**Files:**

- `packages/client/src/components/layout/operator/OperatorNavRail.tsx` — in the `isPkl` items array, change the `capture` item `label: 'Capture'` → `label: 'Production Console'` (keep `id: 'capture'`, path, and `match` unchanged so routing/highlighting is untouched).
- `packages/client/src/pages/process/*` (PKL capture page header) and/or `CaptureWorkspace.tsx` — set the visible title to "Production Console" for PKL only (guard with `processCode === 'PKL'`); leave CRM/HRS/CRS/RWD titles as-is.

**Acceptance:** PKL side nav shows "Production Console"; ANN/CRM/HRS/CRS/RWD labels unchanged; capture route + active-state highlight still work.

---

## A2. PKL — Machine-Head profile aligned to the PKL operator

**Problem:** `PKL_NAV_ITEMS` in `MachineHeadNav.tsx` points `Live Dashboard` at the generic `/live` (rolling MH dashboard). There are no PKL-specific MH pages (`pages/machinehead/` has only `ann/`). Mirror the ANN MH pattern for PKL.

**Reference pattern (already built for ANN — copy its shape):**
`pages/machinehead/ann/AnnMhLiveDashboard.tsx`, `AnnMhChargeDetailPage.tsx`, `AnnMhTrendsPage.tsx`, `AnnMhBatchingPage.tsx` + `lib/annMhDesk.ts`.

**New files (PKL, mirrors ANN):**

1. `packages/client/src/pages/machinehead/pkl/PklMhLiveDashboard.tsx`
   - Board of PKL coil/run cards (reuse `PklChartGrid` data + `pklSiblingSelect` grouping). Each card opens full-screen detail.
   - Subtitle "Coil runs — open for full detail"; search box (coil no + slit + mother + grade), mirroring `AnnMhLiveDashboard`.
2. `packages/client/src/pages/machinehead/pkl/PklMhCoilDetailPage.tsx`
   - Full-screen detail for a PKL coil/run: PPC vs actual, line-speed/repeats/HT/W-P/end-filling, Σ group weight, readings/chart timeline **with timestamps**, and "captured by operator" values. Mirror `AnnMhChargeDetailPage` (stages→chart rows, `taken_at` timestamps).
3. `packages/client/src/pages/machinehead/pkl/PklMhTrendsPage.tsx` *(optional, parity with ANN)*
   - Multi-metric PKL trends (line speed, weight variance, throughput) with base/line + search filters, all metrics plotted at once.

**Wiring:**

- `packages/client/src/App.tsx` — add PKL MH routes under `MachineHeadRoute`:
  - `/machine-head/pkl/live` → `PklMhLiveDashboard`
  - `/machine-head/pkl/coil/:coilNo` → `PklMhCoilDetailPage`
  - `/machine-head/pkl/trends` → `PklMhTrendsPage` (if built)
- `packages/client/src/lib/pklMhDesk.ts` — add a PKL `MhLiveEntry`-style resolver so that when the desk focus is PKL, `/live` + `/machine-head-dashboard` render the **PKL** live dashboard (mirror `pages/machinehead/ann/MhLiveEntry.tsx`). Keep ANN-wins-tie logic intact.
- `packages/client/src/components/layout/machinehead/MachineHeadNav.tsx` — repoint `PKL_NAV_ITEMS.live.path` to the PKL live entry; add a `Trends` item if built. Leave `ANN_NAV_ITEMS` and rolling nav untouched.

**Server:** reuse existing PKL endpoints (`/stations/pkl/chart`, PKL board/queue). Add a read-only `GET /stations/pkl/board` **only if** a PKL board aggregate doesn't already exist (check `ProcessStationService` first); do not modify PKL write paths.

**Tests:**

- `packages/client/src/pages/machinehead/pkl/__tests__/pklMhLive.test.tsx` — cards render, search filters, card→detail navigation.
- `packages/server/tests/pklMhBoard.test.ts` — board aggregate shape (if a new endpoint is added).

**Acceptance:** a PKL-sole machine head lands on a PKL live dashboard (not rolling); cards open full-screen PKL detail with timestamps and operator-captured values; ANN and rolling MH desks unchanged.

---

## A3. ANN Machine-Head — Shift Review: delay categories + crew roles + total delay

**Problem:** `ProcessStationService.getAnnShiftReview` (packages/server/src/services/ProcessStationService.ts, ~L794–905) returns:
- `delaySummary` bucketed by raw ANN stoppage category (BASE_FAN, BASE_SEAL, POWER, CRANE, OTHER, …) — **not** the requested delay classes.
- `crew: { opn: '—', helper: '—', signature: '—' }` — hardcoded placeholders.
- No explicit **Total Delay** figure.

The requested "Remarks & Delay Summary" fields are: **Remarks, Total Delay, OPN, ELECT, MECH, UTILITY, POWER FAILURE, OPERATOR/ENGINEER, HELPER, CRANE OPERATOR, SHIFT INCHARGE.**

**Design:** split into (a) delay-class buckets and (b) crew-role attribution, sourced from real data, single source of truth on the server.

### A3.1 Delay classes (OPN / ELECT / MECH / UTILITY / POWER FAILURE)

- **Migration** `packages/server/migrations/19480000000000_ann_stoppage_delay_bucket.js` (new, additive):
  - `ALTER TABLE master.ann_stoppage_category ADD COLUMN IF NOT EXISTS delay_bucket TEXT;`
  - Seed/`UPDATE` a mapping for the seeded codes, e.g. `BASE_FAN/BASE_SEAL/BASE_CLAMP/CA_BLOWER → MECH`, `THERMOCOUPLE → ELECT`, `BASE_WATER/GAS_SUPPLY → UTILITY`, `POWER → POWER FAILURE`, `CRANE → OPN` (confirm final mapping with plant). Default `OTHER → OPN`.
  - This also puts the currently-unused `master.ann_stoppage_category` metadata to work (see B3).
- **Server** `getAnnShiftReview`: replace the raw-category `delayMap` with a `delay_bucket`-keyed map over the fixed order `['OPN','ELECT','MECH','UTILITY','POWER FAILURE']`, always emit all five buckets (0 when empty), and add `totalDelayMin = sum(all buckets)`.

### A3.2 Crew-role attribution (OPERATOR/ENGINEER, HELPER, CRANE OPERATOR, SHIFT INCHARGE)

- Source from the existing crew capture (`txn.session_crew` / machine crew roster — verify which is populated for ANN). Map roster roles → the four role rows; emit minutes or names per role. If ANN crew capture isn't populated yet, wire the ANN roster panel (`AnnChargePage` "ANN batch details") to persist role assignments, then aggregate here.
- Replace the hardcoded `crew: { opn, helper, signature }` with `{ operatorEngineer, helper, craneOperator, shiftIncharge, signature }`.

### A3.3 Client render

- `packages/client/src/pages/plant/PlantShiftReviewPage.tsx` "Remarks & delay summary" block:
  - Render the five fixed delay rows in order + a bold **Total Delay** row.
  - Render the four crew-role rows.
  - Keep Remarks, Shift Production, Dew, In-Process, Cumulative (already correct).
- **Delete** the dead helper `packages/client/src/lib/annShiftReviewBuckets.ts` (0 importers; superseded by server-side `delay_bucket`). This resolves the orphan in B2.

**Tests:**

- `packages/server/tests/annShiftReviewDelayBuckets.test.ts` — category→bucket mapping, all five buckets always present, `totalDelayMin` = sum.
- `packages/server/tests/annShiftReviewCrew.test.ts` — crew-role aggregation.

**Acceptance:** ANN Shift Review shows Remarks, Total Delay, the five delay classes, and the four crew roles, all data-driven; process table / stoppage / production / dew / in-process / cumulative unchanged.

---

## A4. ANN operator — top-nav label wording (cosmetic, optional)

**Goal:** top nav reads "ANN" (or "ANN · Annealing") instead of the full "Annealing".

**File:** `packages/client/src/components/layout/operator/StatusRail.tsx` — the `line` value uses `getProcessConfig(processCode).label`. Either add a short-code display (`processCode` for stations) or set ANN's display token to "ANN". Keep it dynamic per line; do not touch CRM mill display (`6HI/4HI/2HI`).

**Acceptance:** annealing shows "ANN"; all other lines unchanged.

---

# PART B — Connectivity & hygiene (keep everything well-connected)

## B1. Fix DB bootstrap — missing `M1_schema.sql` (blocker)

**Problem:** `packages/server/migrations/1717200000000_baseline.js` reads `../../../doc/m1/M1_schema.sql`, which does **not exist** in this checkout. The only copy is `doc/audit/ZEDRAL_CENTRAL/M1_Technical_Blueprint (1)/M1_Technical_Blueprint/M1_schema.sql`. A clean `npm run migrate` fails at migration #1, so no downstream ALTER/seed can run.

**Fix (pick one, then verify a from-scratch migrate):**

1. **Restore the canonical location:** add `doc/m1/M1_schema.sql` (copy the audit copy) and keep the baseline path. Preferred — matches the original repo layout and other tooling.
2. Or repoint baseline to the existing file path (brittle due to spaces/parens in the audit path) — not preferred.

**Acceptance:** `node-pg-migrate ... up` runs from an empty DB through migration `1947…` and the new `1948…` without error.

## B2. Resolve orphan files (wire or remove)

Confirmed zero-import, zero-symbol-use files:

- `client/src/lib/annShiftReviewBuckets.ts` — **removed** by A3.
- `client/src/components/layout/executive/ExecutiveNav.tsx`, `executiveNavItems.ts` — no EXECUTIVE role/shell/route. **Decide:** delete, or finish the Executive profile (role + shell + route). Recommend delete unless Executive is on the roadmap.
- `client/src/components/ui/GloveModeToggle.tsx` — wire into `OperatorShell` (tablet/glove UX) or delete.
- `server/src/reporting/plantHeadValidators.ts` — wire into the plant-head dashboard payload (guards for percent bounds / top-N) or delete.
- `server/src/services/lineageService.ts` + `server/src/export/dpr/DprMappingAudit.ts` — leftovers from the dropped DPR/lineage features. Delete (and drop `audit.lineage_ref` per B3) unless lineage is being revived.
- `server/src/audit/auditedTables.ts` (`AUDITED_TABLES`) — wire into the audit trigger/registry or delete.
- `server/src/services/configService.ts` — fold into `ValidationConfigService` or delete.

**Acceptance:** dependency scan reports no orphaned modules in `client/src` and `server/src` (excluding entrypoints/tests).

## B3. Resolve unused tables (use or drop)

Tables in the schema/types with no runtime query path:

- `master.ann_stoppage_category` — **now used** by A3.1 (`delay_bucket`).
- `master.ann_reading_config` — wire the ANN reading-reminder interval into `AnnChargePage` (the deferred reminder from the operator plan) **or** drop.
- `master.ann_cooling_hood` — drop (design consolidated to `ann_spec_limit`) unless cooling-hood capture is planned.
- `master.crm_sub_process`, `canon.cost_rate`, `canon.personnel`, `audit.lineage_ref` — drop via an additive cleanup migration once B2 confirms no consumer.

**Migration:** `packages/server/migrations/19490000000000_drop_unused_tables.js` with a real `down`. Keep drops separate from feature migrations.

**Acceptance:** every remaining table has ≥1 service consumer; dropped tables have a reversible migration.

## B4. Migration hygiene

- Duplicate timestamp prefixes: `1933000000000_quality_spec_sheet.js` / `1933000000000_reintroduce_supervisor_role.js` and `1934000000000_process_sheet.js` / `1934000000000_restore_audit_fn_audit.js`. Leave applied history untouched; add a lint/CI check to reject new duplicate serials.
- `packages/server/migrations/_qss_seed_params.json` — move out of the migrations dir (e.g. `migrations/seeds/`) so the runner never treats it as a migration; update any loader path.

---

## 2. Sequencing (milestones)

1. **M0 — Bootstrap (B1).** Unblocks from-scratch migrate; do first.
2. **M1 — ANN Shift Review (A3 + B3 ann_stoppage_category).** Highest-value functional gap; migration + server + client + tests.
3. **M2 — PKL MH pages (A2).** New PKL MH dashboard/detail + routing.
4. **M3 — PKL rename + ANN label (A1, A4).** Quick cosmetic/label items.
5. **M4 — Hygiene (B2, B3 remainder, B4).** Orphan/unused cleanup once features land.

Each milestone: build green (`shared-validation → server → client`) + its unit tests, then append an `AGENT_CONTEXT_LOG.md` entry.

## 3. Test & verification plan

- **Unit:** A2 (PKL MH board/live), A3 (delay buckets, crew agg) as listed.
- **Migration:** from-empty `migrate up` through `1949…`, then `migrate:down` one step and back up for each new migration.
- **Regression (other lines):** smoke CRM/6HI, HRS, CRS, RWD capture + existing ANN operator flow to confirm no behavior change. Grep-guard: new code only under `isPkl`/`isAnn`/PKL/ANN routes.
- **Manual:** log in as `operator.pkl`, `machinehead.pkl`, `operator.ann`, `machinehead.ann` seed profiles and walk each changed screen.

## 4. Definition of Done (100%)

- PKL: nav reads "Production Console"; PKL machine head has a PKL-native live dashboard + full-screen detail with timestamps and operator captures.
- ANN operator: unchanged (already 100%); optional "ANN" label applied.
- ANN machine head: Shift Review shows Remarks, Total Delay, the five delay classes, and the four crew roles — all data-driven.
- Platform: clean-DB migrate succeeds; no orphan modules; every table has a consumer or a reversible drop; no duplicate-serial migrations added.
- All builds green; targeted tests green; `AGENT_CONTEXT_LOG.md` updated per milestone; no CRM/HRS/CRS/RWD regressions.
