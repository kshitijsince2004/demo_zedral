# Production Fix — Phase 4 design notes

Spec-first. No code migration in this pass. Each item is its own later PR with a deprecation window.

## 4.1 Converge duplicate HRS/PKL route systems

**Today:** `/hrs-order` + `/pkl-order` (`hrsOrderRoutes`, `pklOrderRoutes`) and `/stations/*` (`processStationRoutes`) are both mounted. `processStore.ts` still calls both families on the same operator flows. ANN already uses `/stations/*`.

**Canonical:** `/stations/*` (newer shared engine).

**Sequence:**
1. Contract tests pinning current request/response for both route families (queue, start, draft, complete, shift-metrics).
2. Point client callers at `/stations/{hrs|pkl}/…` only.
3. Leave `/hrs-order` and `/pkl-order` as thin deprecated shims for one release.
4. Remove shims after a green factory release.

**Preserve:** operator screens and payload shapes unchanged; only the URL prefix moves.

## 4.2 Retire Gen-A data-model residue

**Today:** per-form Gen-A tables coexist with machine/order Gen-B. `doc/audit/DB_AUDIT.md` listed dead tables and duplicate clusters; several were already dropped.

**Sequence:**
1. Re-run DB_AUDIT §6 pre-drop verification queries on a prod-like snapshot for the *current* dead set.
2. One migration per table: row-count guard (abort if non-empty unless signed off) + real `down`.
3. `npm run db:codegen` after each drop.
4. Never batch-drop. Keep master/reference tables that are FK targets or seed data even if unqueried.

## 4.3 `as any` burn-down

**Today:** ~301 `as any` casts, which hid the dropped `audit.lineage_ref` query.

**After Phase 2.2 types are honest:**
1. Prioritise DB query-builder casts (most fall out once table names match `db-types.ts`).
2. Ratchet via lint count (`as any` may not increase).
3. Do not rewrite unrelated services just to clear casts.

## Out of scope here

Client UI changes, operator workflow changes, and any dual-write cutover without contract tests.
