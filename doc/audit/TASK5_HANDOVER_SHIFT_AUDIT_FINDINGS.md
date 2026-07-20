# Task 5 — Handover and Shift-Logic Audit Findings

**Date:** 2026-07-20
**Scope:** Investigation only — no logic changes in this pass.

## Summary

| Question | Verdict |
|----------|---------|
| Display vs pinned session | No — operator path yes; MH/export/PPC use clock/PPC |
| Stale session closure | Partial — login cleanup works; no boundary sweeper |
| Handover A-B-C-A rollover | Mostly yes — getNextShift correct; minor session gaps |
| Attribution consistency | Mostly yes for start/hold; telemetry uses PPC shift |
| Exports vs UI shift | No for current shift — exports are calendar-based |

## Recommended iteration order

1. Unify shift resolution with machineCode + userId; stop cross-operator session borrow
2. Fix MH dashboard + export defaults for operational shift
3. Background stale-session sweeper at boundaries
4. Link machine_shift_session.shift_log_id on create/accept
5. Align machine state events with post-reattribute shift
6. Restore/document fix_shift_attribution_v2.sql for legacy data repair
