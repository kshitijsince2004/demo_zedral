# ZedralV2.2 — Auto Shift Handover (Tier 1): Boundary Carry-Forward Safety Net

_Scope (chosen): when an operator **forgets to hand over** and their session goes stale past the shift boundary, the system auto-closes the session, **carries forward open work** to the incoming shift, records a **system event with a stub note**, and leaves the machine **unblocked**. This is NOT full auto-handover — no auto-accept of a human handover, no removal of the manual flow. It hardens the already-existing (disabled) boundary path._

_Also in scope (added): **§10 machine-head notification** on every auto handover, **§11 crew capture moved to first-login** (a popup that records the shift's crew, replacing handover-time crew selection so it survives auto-handover), and **§12 Shift Review updates** (surface crew + flag auto-closed shifts)._

Read alongside `ZedralV2.2_SHIFT_HANDOVER_EXPLAINER.md` (esp. §7 blast radius). **Prerequisite: repo cleanup merged first** (per the other specs).

---

## 1. Principle & guardrails

- **Fires only on a STALE session** — past `shift end + OVERTIME_GRACE` (default 2h) and no PENDING handover exists. During live overtime the operator is untouched.
- **Machine is never left stuck** — Tier 1 does **not** create a blocking `PENDING`. The incoming operator logs in normally (`ensureActiveSession` sees no pending) and finds the open work already re-parented.
- **Production is attributed correctly** — outgoing shift finalized, open work moved to the incoming shift-log with the same keys the incoming operator's session will resolve.
- **Traceable** — every auto action writes a system handover record (`created_by_boundary=true`, stub note) + `shift_event_audit`.
- **Manual handover stays primary** — the operator's `ShiftEndModal` prompt is unchanged; Tier 1 is the fallback when they ignore it.

---

## 2. What exists vs. what's missing

**Exists (but not enough):**
- `ShiftBoundaryScheduler` runs every 60s but only calls `closeAllStaleActiveSessions()` — it **closes stale sessions and nothing else** ("Auto-handovers remain disabled").
- `ShiftBoundaryService.processMachine/processAllMachines` exist but are **never invoked**, are **CRM-only** (`listCrmMachineCodes` where `process_code='CRM'`), **skip active production**, and do **no carry-forward**.
- `acceptHandover` already contains the correct **carry-forward** logic (re-parent open stoppages + CRM orders + per-process entries) — but it's inline and only runs on manual accept.

**Missing for Tier 1:**
1. Carry-forward on the stale-close path (today it just flips status to CLOSED).
2. All-machine coverage (not just CRM).
3. A system handover record + stub note + audit on the auto path.
4. `shift.closed` emission on the auto path (reporting depends on it).
5. Idempotency + a feature flag.

---

## 3. Trigger & guard (precise)

Hook into the stale-session sweep. For each machine with a stale ACTIVE session (`isSessionLive === false`), before/at close:

Run Tier 1 **only if ALL**:
- `AUTO_BOUNDARY_HANDOVER` flag = `on` (or `shadow`, see §7) for this machine.
- No `PENDING` handover exists for the machine (operator did submit → leave it).
- No auto handover already recorded for this machine + outgoing shift (idempotency, §8).

Otherwise: fall back to the existing plain close (unchanged behaviour).

---

## 4. The Tier 1 algorithm (per stale session, one transaction)

1. Resolve **outgoing** (the stale session's `shift_code`/`prod_date`) and **incoming** (next shift/date via `resolveBoundaryShifts` / `ShiftLogService.getNextShift`).
2. Resolve **process_id** and the **strategy** (`getOrderSourceStrategy(machineCode)`).
3. Resolve/ensure the **outgoing** and **incoming** shift-log ids via the strategy (`resolveShiftLogIdForPlan` / `ensureActiveShiftLog`) — using the **same keys** `ensureActiveSession` will later use for the incoming operator, so they align.
4. **Finalize outgoing shift:** `ShiftAttributionService.attributeMachineOrder(machine, outgoingShift, outgoingDate)` + strategy `saveShiftSummary(outgoingShiftLogId, …, SYSTEM_USER_ID)`.
5. **Carry forward open work** (the shared function, §5) from `outgoingShiftLogId → incomingShiftLogId`: open stoppages (`end_at IS NULL`), open CRM orders (`IN_PROGRESS`/`STOPPAGE`, rewrite shift_code/prod_date), and per-process open entries (ANN/PKL/SKP/RWD/CRS/CTL by `process_id`).
6. **Close** the stale session (`status='CLOSED'`, `closed_at`).
7. **Insert a system handover record** into `txn.machine_handover`: `status='AUTO_COMPLETED'` (new, §6), `created_by_boundary=true`, `outgoing_operator_id`=the stale operator, `incoming_operator_id`=`NULL`, `machine_status` derived from the latest `MachineStateEvent` (fallback `IDLE`), `remarks`=stub *"System-generated at shift boundary — operator did not submit handover before shift end."*, minimal snapshot (last known active order/queue). No `PENDING` → **machine not blocked**.
8. **Audit** `shift_event_audit` `event_type='AUTO_HANDOVER_BOUNDARY'` (+ keep the existing `SHIFT_BOUNDARY_IDLE`/`SHIFT_BOUNDARY` events where relevant).
9. After commit: **`publishShiftClosed({ shiftLogId: outgoingShiftLogId, processId, totalProdMt })`** so reporting/export aggregation fires exactly as it does for manual handover.

> The incoming operator's later `ensureActiveSession` finds no pending, creates their session against the **same incoming shift-log**, and the carried-forward work is already there. No block, correct attribution.

---

## 5. Critical refactor (do this first) — one carry-forward, two callers

The re-parent block currently lives **inline inside `acceptHandover`**. Extract it verbatim into a shared, transaction-aware helper:

```ts
// services/handover/carryForward.ts
export async function reparentOpenWork(trx, args: {
  machineCode: string;
  processId: number | null;
  outgoingShiftLogId: string;
  incomingShiftLogId: string;
  incomingShiftCode: string;
  incomingProdDate: string;  // YYYY-MM-DD
}): Promise<void> { /* open stoppages + CRM orders + per-process entries */ }
```

Call it from **both** `acceptHandover` (manual) and the Tier 1 path (auto). **This is the single most important structural change** — it prevents the two paths from drifting (the classic "manual carries PKL forward, auto silently doesn't" bug). Covered by the existing per-process branch set (2/4/5/6/7/8).

---

## 6. New handover status + migration

`txn.machine_handover.status` has a CHECK constraint (`machine_handover_status_check`, last set in migration `1799`). Add `'AUTO_COMPLETED'`:

- New migration `19xxxxx_handover_auto_completed_status.js` — drop & re-add `machine_handover_status_check` to include `AUTO_COMPLETED` (same drop/re-add pattern as `1796`/`1799`).
- **Alternative (no migration):** reuse `status='ACCEPTED'` with `created_by_boundary=true` + `incoming_operator_id=SYSTEM_USER_ID`. Cleaner for reporting (already handles ACCEPTED) but less explicit. **Recommend the distinct `AUTO_COMPLETED`** so dashboards can flag "system handover" and so it never looks like a human accepted.

No new tables — reuses `machine_handover`, `machine_shift_session`, `shift_event_audit`.

---

## 7. Feature flag & rollout

`AUTO_BOUNDARY_HANDOVER = off | shadow | on` (env, and ideally a per-machine override in machine master so it can be enabled line-by-line).

- **off** — current behaviour (plain stale close). Default.
- **shadow** — compute everything, **write only the audit row** describing what it *would* carry forward, **no mutations**. Run this in production first to validate against real boundaries with zero risk.
- **on** — full Tier 1.

Rollout: `off → shadow` (all machines, observe a few days) → `on` for 1–2 pilot machines → widen to all 20.

---

## 8. Idempotency

The sweep runs every 60s, so Tier 1 must be exactly-once per machine per boundary:
- Guard: skip if a handover row already exists for `(machine_code, outgoing_shift_code, outgoing_prod_date)` with `created_by_boundary=true` OR status in `('PENDING','AUTO_COMPLETED')`.
- Consider a partial unique index on `(machine_code, outgoing_shift_code, outgoing_prod_date) WHERE created_by_boundary` to make it race-proof.

---

## 9. Blast radius — what changes downstream (from explainer §7)

- **Attribution / reporting / DPR:** some shifts now close via system instead of a human. Because Tier 1 runs the same `attributeMachineOrder` + `saveShiftSummary` + `publishShiftClosed`, the numbers land the same way — but reports/overview should visually mark `AUTO_COMPLETED` so a shift closed with no operator note is distinguishable.
- **Production gate (`assertProductionAllowed`):** unchanged — Tier 1 creates **no** PENDING, so incoming operators are never blocked. (That's the "not stuck" guarantee.)
- **`shift.closed` event:** now also emitted on the auto path → export/reporting consumers behave identically.
- **Client:** `HandoverAcceptGate` unaffected (no pending to gate). Handover **overview** should show an "Auto / system" badge for `AUTO_COMPLETED`. `ShiftEndModal` still nudges the operator *before* they leave — Tier 1 only catches the ones who ignore it.
- **Per-process:** correctness rides entirely on the shared `reparentOpenWork` covering all `process_id` branches.
- **Single-active-session invariant:** preserved — Tier 1 only closes, never opens a competing session.

---

## 10. Machine-head notification (CONFIRMED — on)

When Tier 1 fires, notify the machine head responsible for that line: _"Shift closed automatically on {machine} — {operator} did not submit a handover before shift end."_ Rationale: an auto-closed shift is a shift **with no operator note** — exactly the data-quality gap the Hero Steels cadence wants surfaced, so audit-only is not enough.

- **In-app dashboard only (LOCKED §15.4)** — no push for now. Raise a notification the **Machine-Head dashboard already polls** (a lightweight `txn.notification` row keyed by `machine_code`). **Target = machine-access mapping:** the MHs whose `machine_access` includes this machine. The notification stays unresolved until the shift is signed off (§12).
- Payload: machine, outgoing shift/date, outgoing operator, `handover_id`, and a link into **Shift Review** (§12) for that shift-log so the MH can action it in one hop.
- Fire-and-forget after commit (never block/So a notification failure can't roll back the carry-forward).

---

## 11. Crew capture at login (replaces handover-time crew capture)

**Why here:** today crew is captured *through the handover* (`acceptHandover` copies `selectedCrewMembers` → `session_crew`). With Tier 1 auto-handover there is **no operator to select crew**, so that path captures nothing. Moving crew capture to **session start** means each shift's crew is recorded by whoever actually works it — independent of whether the prior shift was handed over manually or auto-closed. The plumbing already exists: `txn.session_crew` (crew↔session), `master.machine_crew_roster` (per-machine register), and `POST /crew { shiftLogId, operatorId, roleCode }` → `CrewService.create`.

**Flow:** after shift over → logout → **first login** of the next shift → crew popup → recorded as the crew for that shift (via `session_crew` on the new session's `shift_log_id`) → surfaces in reports and Shift Review.

**Build:**
- **Trigger (primary):** when `ensureActiveSession` **creates** a fresh session (not when it *resumes* a live/overtime one). Prompt only if the session has no `session_crew` yet.
- **Trigger (secondary):** on a detected **shift change while still logged in** (overtime, no logout — the `ShiftEndModal`/shift-watcher already fires here). Without this, overtime shifts silently inherit the previous crew.
- **Popup (client):** pre-fill from `machine_crew_roster` (roster), allow confirm/add members + role (`OPERATOR/ASST/HELPER/CRANE/MTL`); on submit POST each to `/crew` for the current `shiftLogId`. Consider a small **batch** variant (`POST /crew/batch`) so the whole crew saves in one call.
- **Soft-mandatory (LOCKED §15.5):** the popup is **required but non-blocking** — the operator may skip/snooze it (reuse the `ShiftEndModal` "remind me later" pattern) and it **keeps re-prompting until crew is entered**. It does **not** hard-block production; instead an un-filled crew is flagged in Shift Review (§12) so the MH can chase it.
- **Handover crew-selection:** keep it only as a **pre-fill default** (carry the prior crew into the popup); drop it as the authoritative capture point — login is now the single source.

**Reflects as "crew on that shift":** `session_crew → machine_shift_session (shift_code, prod_date, shift_log_id)` already makes crew-per-shift derivable; reporting joins it (`CrewService.listByShiftLog`, `lineLogQuery`).

---

## 12. Shift Review updates ("working accordingly")

Shift Review (`PlantShiftReviewPage` → `GET /shift-logs/:id/review` → `ReportingService.getShiftReview`; close via `PUT /shift-logs/:id/complete`) shows per-shift overview MT/attainment, stoppage/breakdown/utilization, completed + in-progress orders, and stoppages. Two additions make it consistent with Tier 1 + crew:

1. **Surface crew** — `getShiftReview` currently returns **no crew**. Add `CrewService.listByShiftLog(shiftLogId)` to the bundle and render a "Crew this shift" section. This is where the crew-at-login data becomes visible for the MH/PH.
2. **Handle auto-completed shifts + MH sign-off (LOCKED §15.6)** — a Tier-1-closed shift still has a summary (Tier 1 runs `saveShiftSummary` + `publishShiftClosed`), but the note is the system stub and no operator reviewed it. Shift Review must **flag `AUTO_COMPLETED`** (badge "Auto-closed — no operator handover" + stub note via `getMachineHandoverSummary`) **and require explicit MH sign-off before it counts as reviewed**. Model this with a review state: an auto-closed shift is **`PENDING_REVIEW`** until the MH signs off (`PUT /shift-logs/:id/complete` or a dedicated ack), at which point it becomes reviewed and the §10 notification resolves. Reporting must distinguish "reviewed" vs "auto-closed, awaiting sign-off," and such shifts stay on the MH action list until signed off.
3. **Un-filled crew flag** — if the shift's `session_crew` is empty (operator skipped the §11 popup), surface it in the review as a data-quality item so the MH can chase it.

---

## 13. Operator shift-data fields under auto-handover

The outgoing handover console mixes system-computed fields with **operator-entered readings**. When Tier 1 fires there is no operator, so each field is handled by bucket:

**A — system-derived (Tier 1 already fills):** date/shift/machine/process, scheduled + actual times, next shift, total stoppage/breakdown minutes, rolling/skin-pass MT, `total_prod_mt`, and `machine_status` (from last `MachineStateEvent`, §15.2). Produced by `attributeMachineOrder` + `saveShiftSummary`.

**B — operator-entered fields. Split three ways (most ARE fillable):**

- **B1 — status/judgment → derive from `MachineStateEvent`** (no human needed). Machine **condition** (open/recent `BREAKDOWN`→CRITICAL/ATTENTION; `MAINTENANCE_STARTED` unclosed→ATTENTION; else NORMAL), **breakdown code + downtime minutes + maintenance status** (from BREAKDOWN/MAINTENANCE events + durations), **priority** (default MEDIUM; HIGH if shift ended in breakdown). Tier 1 fills these from the event stream.
- **B2 — free-text narrative → auto-generated structured summary.** Compose the handover note/remark from facts: _"System handover at {out}→{in} boundary. Produced {MT} ({n} orders). Carried forward: {batches}. Stoppage {x} min, breakdown {y} min. Machine ended {status}."_ Satisfies the ≥20-char rule. The *qualitative* operator tip can't be invented → left blank, optional backfill.
- **B3 — physical readings (Coolant Temp °C, Coolant Pressure Kg/cm²) → operator-entered, captured IN-SHIFT (no connector for now).** There is no telemetry, so these stay human input — but because the operator skipped the handover form, capture is **decoupled from handover** (same pattern as crew, §11): a lightweight **"Shift Readings" quick-entry** (coolant temp/pressure, scrap, shift remarks) the operator logs during the shift, written to `txn.crm_shift_summary` against the current shift-log. **Auto-handover snapshots the latest operator-entered readings** for that shift. If none were logged → null → flagged in Shift Review → **MH backfill at sign-off**. (A PLC/SCADA connector remains the future upgrade, but is explicitly out of scope now.)
  - **Prompt cadence (choose):** always-available on-demand entry **+** capture on the existing shift-end prompt (`ShiftEndModal`) is the recommended combo; a periodic in-shift prompt is the most reliable if readings are mandatory per SOP.

**C — partly derivable:** **Scrap (Kg)** — production entries carry `scrap_mt`/`scrap_pct`, so a shift scrap total *can* be summed, but it differs from the operator's manual `scrap_kg`. **Order snapshot** — derivable from active-order state.

**What Tier 1 fills automatically vs. what needs backfill:**
1. **Auto-filled:** Bucket A (all), **B1** (condition/priority/breakdown from events), **B2** (auto-summary note), and **C** (scrap pre-filled from `Σ scrap_mt`). Written to `txn.crm_shift_summary` + the handover snapshot.
2. **From in-shift operator entry:** **B3** coolant temp + pressure (and any operator-typed scrap/remarks) — auto-handover snapshots the **latest "Shift Readings" values** the operator logged during the shift.
3. **Left null only if never entered:** coolant/remarks with no in-shift reading. The `AUTO_COMPLETED` shift is `PENDING_REVIEW`; Shift Review **flags the still-empty fields** as a data-quality gap.
4. The **MH sign-off form exposes those remaining fields** so the MH backfills them from the operator's paper/verbal report **before** signing off — matching the cadence's "anything noted on paper goes into M1 the same shift."

**New capability required:** the `crm_shift_summary` manual columns must be **editable post-hoc** — but **only** for `AUTO_COMPLETED`/`PENDING_REVIEW` shifts, gated (MH/PH), and **audited**, so backfill can never silently overwrite values a real operator already entered on a manual handover. Add a small `PATCH /shift-logs/:id/manual-fields` (or fold into the sign-off `complete` call).

**Open sub-decision:** auto-**sum Scrap from production entries** (`Σ scrap_mt`) as a pre-fill the MH confirms, or leave scrap entirely to manual backfill? (Recommend: pre-fill from entries, MH can override.)

---

## 14. Files touched

**Server**
- `jobs/ShiftBoundaryScheduler.ts` — in `tick()`, when closing stale sessions, invoke Tier 1 per machine (behind the flag).
- `services/ShiftBoundaryService.ts` — new `autoCarryForwardStale(machineCode, staleSession, boundary)` (generalize beyond CRM; add carry-forward + system record + `shift.closed`).
- `services/handover/carryForward.ts` — **new** shared `reparentOpenWork` (extracted from `acceptHandover`).
- `services/MachineHandoverService.ts` — `acceptHandover` calls the shared helper (behaviour identical).
- `services/ShiftDetectionService.ts` — optionally have `closeStaleSessionsOnMachine` return the closed session rows (shift/date/operator) so Tier 1 has what it needs.
- `migrations/19xxxxx_handover_auto_completed_status.js` — add `AUTO_COMPLETED`.
- Flag plumbing (`config/…`), optional per-machine override in machine master.
- **Notification (§10):** Tier 1 writes an MH notification row/event; MH-dashboard feed (`ReportingService.getMachineHandoverSummary` / dashboard query) surfaces it.
- **Crew (§11):** `services/ancillaryServices.ts` (`CrewService`) — optional `POST /crew/batch`; `MachineHandoverService.acceptHandover` — demote handover crew to pre-fill; `crewRoutes.ts` if batch added.
- **Shift Review (§12):** `services/ReportingService.ts` `getShiftReview` — add crew list + `AUTO_COMPLETED` flag/notes.
- **In-shift Shift Readings (§13 B3):** new endpoint to log coolant temp/pressure + scrap + remarks during the shift → upsert `crm_shift_summary` for the current shift-log; auto-handover reads the latest.
- **Manual-field backfill (§13):** `services/sixHi/…` / `shiftLogService.ts` — allow post-hoc edit of `crm_shift_summary` (`scrap_kg`/`coolant_*`/remarks) gated to `AUTO_COMPLETED`+audited; new `PATCH /shift-logs/:id/manual-fields` (or fold into `complete`); optional `Σ scrap_mt` pre-fill.
- **Client (§13 B3):** "Shift Readings" quick-entry (on-demand + on `ShiftEndModal`).

**Client**
- Handover overview UI — badge/label for `AUTO_COMPLETED` (system handover).
- **Crew popup (§11):** new modal wired into the fresh-session path (`ensureActiveSession` result) + the shift-change watcher (`useShiftEndWatcher`/`ShiftEndModal`); posts to `/crew`.
- **Shift Review (§12):** `pages/plant/PlantShiftReviewPage.tsx` — "Crew this shift" section + `AUTO_COMPLETED` badge/stub-note.
- **MH dashboard (§10):** surface the auto-handover notification with a deep link to Shift Review.

---

## 15. Tests (regression + new)

- Stale session with an **open IN_PROGRESS order** → order + open stoppage re-parented to incoming shift-log; session CLOSED; `AUTO_COMPLETED` row + audit; **no PENDING**; `shift.closed` emitted.
- **Live overtime** session → untouched.
- **Manual PENDING** exists → Tier 1 skips (no double handling).
- **Idempotency** → repeated sweeps produce exactly one auto handover per boundary.
- **Per-process** → run for a CRM mill and at least one all-process mill (e.g. PKL) — carry-forward branch fires for both.
- **Shadow mode** → audit written, zero mutations.
- **Incoming login alignment** → operator logging in after auto handover gets a session on the same incoming shift-log and sees the carried-forward work.
- **MH notification (§10)** → auto handover raises exactly one MH notification linking to Shift Review.
- **Crew at login (§11)** → fresh session prompts, resumed live session does **not**; submitted crew appears in `session_crew` for the correct shift-log; overtime shift-change also prompts.
- **Shift Review (§12)** → review bundle includes the crew list; an `AUTO_COMPLETED` shift shows the auto badge + stub note.
- **Manual fields (§13)** → in-shift "Shift Readings" persist to `crm_shift_summary`; auto-handover snapshots the **latest** logged coolant/scrap/remarks; if none logged, fields are null + flagged; MH backfill writes them (audited) and is rejected on a manually-completed shift.
- Existing gates: `tests/shiftHandoverFlow.test.ts`, `tests/shiftBoundary.test.ts`, `tests/reinstateAndShiftSummary.test.ts`, `tests/integration/machineHeadLifecycle.integration.test.ts`, plus `npm run arch:check`, `e2e:smoke`.

---

## 16. Decisions (LOCKED)

1. **Status → `AUTO_COMPLETED`.** Distinct status (not reuse of `ACCEPTED`); needs the migration in §6 to extend `machine_handover_status_check`.
2. **Stub `machine_status` → derived from the last `MachineStateEvent`** for the machine (RUNNING/IDLE/BREAKDOWN/…), with `IDLE` as the fallback when no recent event exists.
3. **Enablement → global flag + per-machine override in machine master.** `AUTO_BOUNDARY_HANDOVER` is the master switch; a per-machine column/flag in machine master gates staged rollout (pilot machines first, then widen). Effective = `global.on AND machine.enabled`.
4. **MH notification → in-app dashboard only** (no push for now). Still to wire: "the MH for this line" resolves via **machine-access mapping** (machine heads whose `machine_access` includes this machine).
5. **Crew capture → keep handover crew-selection as a pre-fill; login popup is soft-mandatory.** The popup is **required but non-blocking**: the operator may skip/snooze it (reuse the `ShiftEndModal` "remind me later" pattern), and it **keeps re-prompting until crew is entered**. It does **not** hard-block production — a shift can start, but it's nagged (and flagged in Shift Review, §12) until crew is filled.
6. **Shift Review → an `AUTO_COMPLETED` shift requires explicit MH sign-off before it counts as reviewed.** Add a review state: an auto-closed shift is `PENDING_REVIEW` until the MH signs off (via `PUT /shift-logs/:id/complete` or a dedicated ack). Until then it stays on the MH's action list and the §10 notification is unresolved. Reporting should be able to distinguish "reviewed" vs "auto-closed, awaiting sign-off."

**Implications now baked in:**
- §6 migration is required (status is `AUTO_COMPLETED`).
- §10: notification target = machine-access-mapped MHs; in-app feed only.
- §11: crew popup is soft-mandatory (skippable + persistent re-prompt), not a production gate.
- §12: Shift Review gains a **sign-off** action + a `PENDING_REVIEW` state for auto-closed shifts.

_Build order: (1) extract `reparentOpenWork` + prove manual accept unchanged → (2) migration for `AUTO_COMPLETED` → (3) Tier 1 in shadow mode → (4) crew-at-login capture (soft-mandatory, §11) → (5) Shift Review crew + auto-flag + MH sign-off (§12) → (6) MH notification via machine-access mapping (§10) → (7) flip pilot machines to `on` (per-machine flag) → (8) widen._
