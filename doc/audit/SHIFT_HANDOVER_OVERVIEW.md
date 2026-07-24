# Shift Handover Logic Overview

The Shift Handover process ensures a smooth, auditable transition of a machine's state, production logs, and open events (like stoppages or active orders) from an outgoing operator to an incoming operator across shift boundaries. 

The system leverages an event-driven, snapshot-based approach where the outgoing operator captures the current state, and the incoming operator accepts it, transferring ownership of the active production session.

---

## 1. Outgoing Handover (Operator Leaving)

### Frontend (`CrmOutgoingHandoverPage`)
When an operator prepares to leave their shift, they open the Outgoing Handover page.
1. **Data Hydration (Preview):** The UI immediately calls the backend to build a comprehensive "preview" of the shift. This includes the current active order, open stoppages, accumulated scrap/coolant metrics, machine utilization percentages, and the roster of crew members.
2. **Drafting (`useFormDraft`):** As the operator fills out their handover remarks, machine condition, and metrics, a custom hook (`useFormDraft`) automatically persists their progress. It saves data locally via Capacitor `Preferences` and routinely sends it to the backend to create a `DRAFT` handover record. This prevents data loss if the tablet loses connectivity or the app crashes.
3. **Submission:** Upon clicking submit, the form triggers the final handover creation API, marking the handover as `PENDING`.

### Backend (`MachineHandoverService.createOutgoingHandover`)
1. **Validation:** Checks that the shift is within the allowed window to be closed (using `canCompleteOutgoingHandover`) and validates the shift log integrity.
2. **State Snapshot:** Aggregates a massive `production_snapshot` containing everything the incoming operator needs to know: active order details, open stoppages, utilization metrics, and the outgoing operator's manual remarks.
3. **Database Transactions:**
   - **Delete Draft:** Removes the temporary `DRAFT` record.
   - **Create Pending:** Inserts the final `machine_handover` row with status `PENDING`.
   - **Close Session:** Updates the outgoing operator's `machine_shift_session`, changing status from `ACTIVE` to `CLOSED` and recording the `closed_at` timestamp.
   - **Audit:** Writes a `HANDOVER_CREATED` event to `shift_event_audit`.
4. **Finalization:** Saves the final shift summary (scrap, coolant) to the `shift_log` and publishes domain events (e.g., `publishShiftClosed`) to trigger any downstream aggregations.

---

## 2. Shift Session Management & Staleness

Because operators often forget to formally log out or close a shift, the backend enforces automated session boundaries using the `ShiftDetectionService`.

- **Orphan Prevention:** When the `MachineHandoverService.ensureActiveSession` runs (triggered when an operator tries to interact with the machine), it checks if there is an existing `ACTIVE` session. 
- **Liveness Check:** A session is considered "live" (`isSessionDateLive`) if its `prod_date` belongs to the current plant day or the immediate previous plant day (to seamlessly support overnight shifts, like a C-shift continuing into the morning).
- **Auto-Closure:** If the existing session is older than the liveness window, it is considered an "orphan". The backend automatically calls `closeStaleOperatorSessions` to gracefully terminate it before spinning up a fresh session aligned with the current wall clock.

---

## 3. Incoming Handover (Operator Arriving)

### Frontend 
The incoming operator logs into the tablet and accesses the machine dashboard.
1. **Blocker:** The backend enforces a strict block (`assertProductionAllowed`): the incoming operator cannot execute new production mutations (like starting a new coil) until they resolve the `PENDING` handover.
2. **Review:** The operator views the handover summary, reading the notes left by the previous operator, acknowledging machine conditions, and reviewing carried-forward stoppages.
3. **Action:** The operator can either **Accept** the handover or **Request Clarification** if something is wrong.

### Backend (`MachineHandoverService.acceptHandover`)
1. **Acceptance:** Updates the handover row status from `PENDING` to `ACCEPTED`.
2. **Session Transfer:**
   - Closes any residual `ACTIVE` sessions on that machine.
   - Opens a brand new `ACTIVE` session (`machine_shift_session`) for the incoming operator, stamped with the new `shift_code` and `prod_date`.
   - Maps the accepted crew members to this new session via `session_crew`.
3. **Carry-Forward Logic (The "Baton Pass"):**
   - **Stoppages:** Any stoppage that has no `end_at` time is updated. Its `shift_log_id` is re-parented to the incoming operator's new shift log.
   - **In-Progress Work:** Based on the machine's specific process (e.g., ANN, PKL, SKP), any production entry with an `IN_PROGRESS` status is cleanly moved over to the new `shift_log_id`, ensuring the new shift gets credit and tracks the completion of the coil.
4. **Audit:** Records a `HANDOVER_ACCEPTED` event.

---

## Summary
The system acts as a rigid state machine. An **Active Session** owns production data. The **Outgoing Handover** packages that state into a snapshot and suspends machine operations. The **Incoming Handover** unpacks that state, re-parents open work to a new shift log, and creates a fresh **Active Session** to resume production seamlessly.

---

## 4. Auto Boundary Handover (Tier 1)

When an operator **forgets** to hand over and the session goes past shift-end + overtime grace, the scheduler runs Tier 1 instead of a bare session close:

1. Finalize outgoing shift (attribution + summary + `shift.closed`).
2. Ensure the incoming shift_log (same keys `ensureActiveSession` will use).
3. `reparentOpenWork` — shared with manual `acceptHandover`.
4. Close the stale session; insert `AUTO_COMPLETED` with `created_by_boundary=true` (no PENDING → machine not blocked).
5. Incoming operator logs in normally and finds carried-forward work already on their shift_log.

See `doc/audit/TIER1_AUTO_BOUNDARY_HANDOVER.md` for A→B→C→A lifecycle, rollout, rollback, and observability.

**Flags:** `AUTO_BOUNDARY_HANDOVER=off|shadow|on`, optional `AUTO_BOUNDARY_HANDOVER_MACHINES`.
