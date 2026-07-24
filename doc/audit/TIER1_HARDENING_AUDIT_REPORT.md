# Tier 1 Auto Boundary Handover — Hardening Audit Report

Date: 2026-07-23  
Scope: Production-harden existing Tier 1 implementation (no new business features).

---

## Answers (explicit)

1. **Does the A→B→C→A shift cycle work correctly?**  
   **Yes.** `nextPlantShift` / `ShiftLogService.getNextShift` and `resolveBoundaryShifts` agree on A→B, B→C, and C→A (including month/year end). Tier 1 uses the **session's** shift/date via `getNextShift`, so C overtime → A next day stays correct. Covered by unit tests.

2. **Can production ever be attributed to the wrong shift?**  
   **Low risk if rolled out carefully.** Within overtime grace, production stays on the pinned outgoing session (correct). After Tier 1, open work is re-parented via shared `reparentOpenWork`. Residual risk: incomplete process coverage for exotic process_ids, or operator writing on a stale tablet before recovery — mitigated by client `ensureActiveSession` recovery.

3. **Can shift logs become duplicated or orphaned?**  
   **Shift logs:** `ShiftLogService.create` is idempotent on `(process, date, shift)` — duplicates unlikely.  
   **AUTO_COMPLETED:** unique index on `(machine, outgoing_shift, date)` WHERE `created_by_boundary` (migration 1936 uses `::date`).  
   **Sessions:** stale ACTIVE closed by Tier 1 or plain close; sweep continues on per-machine errors.

4. **Can operators become stuck after auto handover?**  
   **No by design** — Tier 1 creates no PENDING. Incoming is not blocked. Outgoing tablet that stays open after close recovers via visibility + "Recover session" + `ensureActiveSession`.

5. **Is manual handover behavior 100% preserved?**  
   **Yes for the primary path.** `acceptHandover` still does PENDING→ACCEPTED, session_crew, and calls the same `reparentOpenWork`. `ShiftEndModal` / `HandoverAcceptGate` / `createOutgoingHandover` unchanged. Flag default `off` keeps scheduler behavior as plain stale close.

6. **Is Tier 1 safe for pilot rollout?**  
   **Yes, with shadow → allowlisted `on`.** Recommended: migrate 1935+1936 → `shadow` plant-wide → `on` for 1–2 machines → widen.

---

## Production ready

- Shared `reparentOpenWork` for manual + auto
- `AUTO_COMPLETED` status + date-based unique index
- Flag `off|shadow|on` + machine allowlist
- Scheduler overlap lock + per-machine error isolation
- Unique-violation / PENDING-race handling
- `publishShiftClosed` uses actual `totalProdMt` (not 0)
- Structured JSON logs (`tier1_*`, `shift_boundary_scheduler_*`)
- Client session recovery (visibility + Recover session)
- Shift Review crew + auto-closed badge
- Cycle / boundary / flag unit tests
- Docs: `TIER1_AUTO_BOUNDARY_HANDOVER.md`, overview §4

---

## Potential risks

- **Shadow still plain-closes** sessions (intentional so ops aren't worse than today); pure no-mutation shadow is not available.
- **Legacy `getShiftSummary`** may return null → `totalProdMt=0` on auto close for non-CRM lines (same as thin legacy summary path).
- **Visibility recover** calls `ensureSession` on every tab focus — low cost but noisy if network flaky.
- **Crew prompt** only on fresh session create (empty crew on rare resume flagged in Shift Review).
- Integration tests against a live DB for concurrent double-tick not in CI (unit + unique index cover the contract).

---

## Bugs discovered and fixed in this pass

1. **`publishShiftClosed({ totalProdMt: 0 })`** — under-counted reporting. Now reads summary MT.
2. **Unique index on raw timestamptz** — timezone cast could allow duplicate AUTO_COMPLETED. Migration 1936 indexes `outgoing_prod_date::date`.
3. **Sweep abort on one machine failure** — now per-session try/catch; unique violations treated as success.
4. **Overlapping scheduler ticks** — running lock skips overlap.
5. **PENDING race** — re-check PENDING inside the write transaction.
6. **Client dead UI after auto-close** — visibility + Recover session + NO_ACTIVE_SESSION auto-recover.
7. **Date-only inserts** — Tier 1 now uses `postgresDateOnly` for handover dates.

---

## Recommended improvements (not blocking pilot)

- Emit counters to metrics backend from structured logs.
- Optional integration test: two concurrent `autoCarryForwardStale` calls → one AUTO_COMPLETED.
- Prompt crew on live session with empty `session_crew` (currently create-only).
- Per-machine DB column if env allowlist becomes operationally painful.

---

## Test coverage added

- A→B, B→C, C→A, continuous A→B→C→A
- Month-end / year-end C→A
- Clock boundaries A→B / B→C / C→A + month-end 06:00
- Flag off/shadow/on + allowlist
- `reparentOpenWork` export presence
- Existing: ensureActiveSession stale, shiftHandoverFlow helpers, shiftBoundary

---

## Rollout checklist

1. Apply migrations `1935000000000`, `1936000000000`
2. Deploy with `AUTO_BOUNDARY_HANDOVER=off` (default)
3. Enable `shadow` → watch `tier1_shadow` audits for a few days
4. `on` + `AUTO_BOUNDARY_HANDOVER_MACHINES=<pilots>`
5. Confirm MH Shift Review shows auto-closed + crew
6. Widen allowlist