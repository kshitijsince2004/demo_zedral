# Task 5 - Handover and Shift-Logic Audit Findings

**Date:** 2026-07-21 (expanded from 2026-07-20 summary)
**Scope:** Investigation only - no logic changes in this pass.
**Sources:** ShiftDetectionService, MachineHandoverService, SixHiService, LiveService, export definitions; prior HANDOVER_AND_DATEFILTER_INVESTIGATION / ZEDRAL_BUG_STALE_SHIFT_SESSION_SPEC.

## Verdict summary

| # | Question | Verdict |
|---|----------|---------|
| 1 | Display vs pinned session | **No** - operator + handover pin to session; MH/PH dashboards, live KPIs, several export defaults use wall-clock or hardcoded A |
| 2 | Stale session closure at boundaries | **Partial** - login cleanup + isSessionLive grace work; no boundary sweeper; cross-operator stale conflict remains |
| 3 | Handover A-B-C-A + midnight rollover | **Mostly yes** - getNextShift / session pin correct; session.shift_log_id never set; 6HI open orders not re-parented on accept |
| 4 | Attribution consistency | **Mostly yes** for start/hold; complete/resume skip reattribute; machine-state events stamp PPC shift; fix_shift_attribution*.sql not in repo |
| 5 | Exports vs UI shift | **No** for current shift (clock without machine); **Yes** when both key off explicit (date, shiftCode) -> shift_log_id |

---

## Q1 - Displayed shift vs pinned session

| # | Symptom | Root cause | Proposed fix |
|---|---------|------------|--------------|
| 1.1 | MH dashboard shiftSummary can show clock shift while operators remain pinned (overtime) | LiveService.getShiftQueueContext -> getCurrentShift({ userId }) without machineCode | Pass machine scope (or per-machine sessions) into dashboard context |
| 1.2 | Live plant KPIs / order filters use same clock context | LiveService.getSnapshot -> same getShiftQueueContext | Same as 1.1 |
| 1.3 | Plant Head rejected-orders export defaults to shift A | PlantHeadDashboard useState A + currentPlantDate() | Seed from server operational shift or require pick |
| 1.4 | Shift Summary export defaults to A + calendar date | ShiftSummaryExportPanel initial state | Seed from /shifts/current (machine-scoped) |
| 1.5 | Machine board card shiftCode from events, not session | LiveService.getMachineCards uses ev?.shift_code | Prefer ACTIVE machine_shift_session.shift_code |
| 1.6 | PPC import detected shift ignores sessions | PPCImportService -> getCurrentShift() with no machine/user | Keep as planning default; document as non-operational |

**Aligned (no issue):** operator shell (SixHiLayout + /shifts/current?machine=), handover create/accept/overview, Task 4 Shift Review (stored shift_log identity).

Core pin when machine present: ShiftDetectionService.getCurrentShift - ACTIVE live machine_shift_session wins (source: SESSION).

---

## Q2 - Stale sessions at shift boundaries

| # | Symptom | Root cause | Proposed fix |
|---|---------|------------|--------------|
| 2.1 | Stale ACTIVE rows sit until that operator hits ensureActiveSession | closeStaleOperatorSessions only from MachineHandoverService.ensureActiveSession; ShiftBoundaryScheduler.start() is a no-op | Periodic job (or widen close) for all non-live ACTIVE sessions per machine |
| 2.2 | Next operator blocked by previous operator stale ACTIVE (ACTIVE_SESSION_CONFLICT) | ensureActiveSession only closes current operator; otherActive ignores isSessionLive | Before conflict check, close any non-live ACTIVE on the machine |
| 2.3 | During overtime grace, attribution stays on previous shift while wall-clock rolled | Intentional: isSessionLive = end + SHIFT_OVERTIME_GRACE_HOURS | Keep for overtime; make MH UI match (see 1.1) |
| 2.4 | After grace, resolver uses clock but DB may still show ACTIVE | findActiveSession filters live but does not close | Close on first resolve after grace (or job 2.1) |
| 2.5 | Production can pin to another operator live session | findActiveSession falls back to any live ACTIVE; production gate is handover-only | Require caller ACTIVE session before start/hold/complete |
| 2.6 | Idle machines never auto-closed at boundary | Scheduler disabled by policy | Either idle-only close job, or rely on 2.1 |

Overnight circular-pin bug from ZEDRAL_BUG_STALE_SHIFT_SESSION_SPEC looks **fixed** via isSessionLive + non-circular close on login.

---

## Q3 - Handover A->B->C->A + midnight

| # | Symptom | Root cause | Proposed fix |
|---|---------|------------|--------------|
| 3.1 | Late C after 06:00 still resolves C->A (correct) | resolveOutgoingShift session pin + ShiftLogService.getNextShift / nextPlantShift (C->A+1 day) | Keep; covered by handover/plantTime tests |
| 3.2 | PENDING window has no ACTIVE session (closed on create, opened on accept) | createOutgoingHandover closes outgoing; acceptHandover opens incoming | Document clock fallback during PENDING, or keep PENDING_ACCEPTANCE session |
| 3.3 | New session never gets shift_log_id | acceptHandover / ensureActiveSession inserts omit column | Set shift_log_id on insert after ensureActiveShiftLog |
| 3.4 | 6HI open orders not re-parented on accept (other processIds are) | acceptHandover carry-forward branches exclude crm_order path | Re-parent open 6HI orders to incoming shift_log_id (or reattribute post-accept) |

---

## Q4 - Attribution (shift_log_id vs PPC plan_date)

| # | Symptom | Root cause | Proposed fix |
|---|---------|------------|--------------|
| 4.1 | Start/hold move order to operational shift (correct) | SixHiService.reattributeOrderToActiveShift from start/combined/reject | Keep as canonical rule |
| 4.2 | Complete does not reattribute | `endProduction` has no reattribute call | **Confirmed:** keep start-shift credit (overtime completes stay on start shift) |
| 4.3 | IN_PROGRESS early-return / stoppage resume skip reattribute | startProduction early paths | Reattribute on resume / after handover accept for open orders |
| 4.4 | Machine state events stamped with PPC batch.shift_code | MachineStateEventService.recordEvent callers pass PPC shift | Pass post-reattribute / session shift |
| 4.5 | fix_shift_attribution*.sql / _v2 not in repo | Spec references only; closest is migration 1909000000000_reattribute_backlog_production_shift.js | Restore/document SQL or treat 190900 + runtime reattribute as repair path |

Completed lists / shift summaries already filter by o.shift_log_id (aligned with 4.1).

---

## Q5 - Exports / reports vs UI

| # | Symptom | Root cause | Proposed fix |
|---|---------|------------|--------------|
| 5.1 | Live current shift ignores machine session pin | LiveService.getShiftQueueContext without machineCode | Pass machine scope (same as 1.1) |
| 5.2 | SHIFT_SUMMARY / DPR rows use shift_log_id (aligned) | ShiftSummaryReport / ExportReadRepository via order shift_log | Keep; seed UI pickers from session (1.4) |
| 5.3 | MH dashboard mixes clock context with shift_log totals | getMachineHeadDashboard + getShiftQueueContext | Unify with machine-scoped getCurrentShift |
| 5.4 | Plant Head backlog uses calendar plan_date; production uses shift_log.prod_date | ReportingService.getPlantHeadDashboard | Label backlog as planning-only or unify |

---

## Recommended iteration order

1. Unify shift resolution with machineCode + userId; stop cross-operator session borrow (1.1, 1.2, 2.5, 5.1, 5.3)
2. Fix MH dashboard + export defaults for operational shift (1.3, 1.4, 1.5)
3. Background stale-session sweeper at boundaries + close non-live before conflict (2.1, 2.2, 2.4)
4. Link machine_shift_session.shift_log_id on create/accept (3.3)
5. Align machine state events + resume/complete with post-reattribute shift (4.2-4.4); 6HI accept re-parent (3.4)
6. Restore/document fix_shift_attribution_v2.sql for legacy repair (4.5)

**Next step:** review findings together, then spec which items become the Task 5 iteration PR (no logic changes in this deliverable).