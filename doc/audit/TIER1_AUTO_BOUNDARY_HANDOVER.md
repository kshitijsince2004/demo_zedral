# Tier 1 Auto Boundary Handover

Companion to `SHIFT_HANDOVER_OVERVIEW.md` and `.kiro/ZedralV2.2_AUTO_HANDOVER_TIER1_SPEC.md`.

## Manual flow (unchanged — primary)

```
ShiftEndModal → createOutgoingHandover (PENDING)
  → close outgoing session
  → saveShiftSummary + publishShiftClosed
Incoming → HandoverAcceptGate blocks production
  → acceptHandover
  → new session + session_crew
  → reparentOpenWork(outgoing → incoming)
```

## Auto flow (Tier 1 — fallback only)

Fires only when **all** are true:

- `AUTO_BOUNDARY_HANDOVER=on` (or `shadow`)
- machine on allowlist (`AUTO_BOUNDARY_HANDOVER_MACHINES`, empty = all)
- ACTIVE session past shift-end + `SHIFT_OVERTIME_GRACE_HOURS` (default 2h)
- no `PENDING` handover
- no prior `created_by_boundary` / `AUTO_COMPLETED` for that outgoing shift

```
ShiftBoundaryScheduler (60s, non-overlapping)
  → listStaleActiveSessions
  → autoCarryForwardStale
      finalize outgoing (attribute + saveShiftSummary)
      ensure incoming shift_log (same keys as ensureActiveSession)
      reparentOpenWork
      close session
      insert AUTO_COMPLETED (created_by_boundary)
      publishShiftClosed (actual totalProdMt)
  → incoming login: no PENDING → not blocked; lands on same shift_log
```

## A→B→C→A lifecycle

| Boundary | Outgoing | Incoming | Prod date |
|----------|----------|----------|-----------|
| A→B | A @ D | B @ D | same day |
| B→C | B @ D | C @ D | same day |
| C→A | C @ D | A @ D+1 | **rolls** |

Source of truth for next shift: `nextPlantShift` / `ShiftLogService.getNextShift`.
Tier 1 uses the **stale session's** shift/date (not wall clock) so overtime-pinned C still becomes A next day.

## Shift log ownership

- One `txn.shift_log` per `(process_id, prod_date, shift_code, mill_type NULL)` via `ShiftLogService.create` (idempotent).
- Tier 1 pre-creates the incoming log with `SYSTEM_USER_ID`; incoming operator's `ensureActiveSession` resolves the **same** row.
- Open work is re-parented to that incoming `shift_log_id` before the operator logs in.

## Production attribution

- During overtime (within grace): session stays ACTIVE → production stays on outgoing shift.
- After grace + Tier 1: open IN_PROGRESS/STOPPAGE work moves to incoming shift_log.
- Completed work stays on outgoing; summary + `shift.closed` close the outgoing books.

## Scheduler lifecycle

- Interval: `SHIFT_STALE_SWEEP_MS` (default 60000).
- Overlap lock: concurrent ticks skip.
- Per-machine try/catch: one failure does not abort the sweep.
- Unique index on `(machine_code, outgoing_shift_code, outgoing_prod_date::date) WHERE created_by_boundary` prevents duplicate AUTO_COMPLETED.

## Rollout

1. Migrate `1935` + `1936`.
2. `AUTO_BOUNDARY_HANDOVER=shadow` plant-wide — audit only + plain close.
3. `=on` + `AUTO_BOUNDARY_HANDOVER_MACHINES=pilot1,pilot2`.
4. Widen allowlist → empty (all).

## Rollback

- Set `AUTO_BOUNDARY_HANDOVER=off` — immediate return to plain stale close.
- Manual handover path untouched.
- Existing `AUTO_COMPLETED` rows remain for audit.

## Failure recovery

| Failure | Behavior |
|---------|----------|
| Unique violation | Treated as already handled; session closed |
| PENDING race | Skip Tier 1; leave PENDING for human accept |
| saveShiftSummary fail | Logged; carry-forward + AUTO_COMPLETED still attempt |
| publishShiftClosed fail | Logged; data already committed |
| Tablet open past close | visibility → ensureActiveSession; Recover session button |

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Duplicate AUTO_COMPLETED | Migration 1936 date unique index applied? |
| Wrong date on C→A | Session prod_date vs clock; getNextShift |
| Incoming blocked | Unexpected PENDING? |
| Wrong shift_log after auto | Compare production_snapshot.incomingShiftLogId vs session |
| No carry-forward | Flag off? Allowlist? Still in overtime grace? |

## Observability (structured JSON logs)

- `shift_boundary_scheduler_armed|tick|skip_overlap|failed`
- `tier1_sweep_start|sweep_done|start|skipped|shadow|carry_forward|success|failed|duplicate_prevented`

Recommended metrics: auto/manual handovers per day, shadow executions, skipped reasons, duplicate_prevented, carry-forward failures, scheduler durationMs.