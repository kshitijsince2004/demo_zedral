# M3 · 04 — Shift Handover & Execution Spec (M3a)
**Deep-plan ref:** §7. **Standards:** HSE HSG48 human factors (structured, two-way, written+verbal); digital shift-logbook practice. **Scope note:** M3a serves the PPC loop (continuity + plan-vs-actual feedback), not a standalone safety product.

## 1. Two jobs
1. **Execution & confirmation** — run dispatched orders this shift; capture `production_confirmation` actuals (good/scrap/setup/run minutes), updating `production_operation`/`production_order` status.
2. **Shift handover** — at the boundary, compile a structured `shift_handover` that (a) carries every open order/WIP/stoppage forward (the **no-orphan guarantee**), (b) records **plan-vs-actual** for the shift, (c) feeds that variance back to planning (specs 02/03).

## 2. Handover lifecycle (`ops.handover_status`)
`ACCUMULATING → DRAFTED → REVIEWED → SIGNED_OFF`. Open orders/WIP/stoppages auto-accrue as `handover_carryover` while `ACCUMULATING`. `DRAFTED` auto-pulls actuals (no re-keying). `REVIEWED` enforces mandatory sections. `SIGNED_OFF` is immutable + audit-logged.

## 3. Mandatory, non-skippable sections (`handover_carryover.is_mandatory`)
| Section | `kind` | Source |
|---|---|---|
| Open orders / WIP carryover | `OPEN_ORDER` / `WIP` | `production_order` still in progress |
| Running stoppages / degraded assets | `STOPPAGE` | M1 stoppages / M2 |
| Safety: permits, isolations, temporary controls, incidents | `SAFETY` | first-party capture |
| Quality holds | `QUALITY_HOLD` | M1 defects / M6 |
| Instructions / priorities for next shift | `INSTRUCTION` | supervisor |
Header (shift in/out, supervisors, crew) + production-vs-plan (`planned_qty`/`produced_qty`/`oee_pct`/`variance_note`) live on `shift_handover`.

## 4. Relationship to M1 (graduation)
M1 already carries open **coils** + running stoppages to the next shift log. M3a **generalises** this to any canonical order/WIP, adds the structured production-vs-plan + safety + instruction sections, enforces mandatory fields, and writes a canonical `shift_handover`. Where M1 exists, reuse its capture UX, **offline-tolerance**, and RBAC; where it doesn't, M3a stands alone (works for non-M1 clients). The shift's `produced_qty` vs `planned_qty` is the planning **feedback signal** (spec 06 adherence; specs 02/03 re-plan).

## 5. Confirmation → canonical ProductionCount (the M3↔M4 rule)
A confirmation books **one** `canon.event` ProductionCount (soft-linked via `production_confirmation.canon_event_ref`). M3 reads it for attainment; M4 reads it for OEE. Never written twice (deep-plan §12).

## 6. Interfaces
- `POST /exec/confirm` — body: order/op, good/scrap/rework, setup/run minutes, operator, shift → books ProductionCount + updates status.
- `POST /handover` (open) · `POST /handover/{id}/draft|review|signoff`.
- `GET /handover/{id}` → full structured handover (for the verbal+written meeting).
- `GET /handover/open-carryover?area&shift` → live no-orphan list.

## 7. Acceptance criteria
- **MUST** prevent `SIGNED_OFF` while any `is_mandatory` carryover is unacknowledged.
- **MUST** auto-carry every in-progress order (no orphan) into the draft.
- **MUST** make `SIGNED_OFF` immutable + audit-logged (who/when, both supervisors).
- **MUST** book exactly one ProductionCount per confirmed quantity.
- **MUST** be offline-tolerant (queue + sync) like M1.
- **SHOULD** auto-populate produced-vs-plan + OEE from M4 so the supervisor confirms, not types.
