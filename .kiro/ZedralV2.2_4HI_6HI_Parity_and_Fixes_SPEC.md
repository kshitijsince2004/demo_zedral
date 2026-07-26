# ZedralV2.2 — 4HI/6HI Parity, Queue, Handover & Reading Fixes: Implementation Spec

_Grounded in the extracted `ZedralV2.2` snapshot. Sequence: **after the repo cleanup**, and it dovetails with the auto-handover Tier 1 spec and the combine-key change (`Task 2`)._

## 0. Foundation — why "4HI vs 6HI" is mostly one code path

`SixHiService` / `/6hi` routes / `PPCImportService` are the **shared CRM engine** for `CRM_MILL_CODES = ['6HI','4HI','2HI']`, keyed by `machine_code` + `sub_process` (ROLLING = 6HI/4HI, SKIN_PASS = 2HI/4HI/6HI). **Business logic is identical by construction** — divergence only appears where code hardcodes a machine or a client route injects a mill. The parity audit (§7) hunts exactly those. Two concrete divergences already found:
- **Bug P1:** `routes/sixHiRoutes.ts:601` hardcodes `assertLineOperation(req.user, '6HI', 'WRITE')` in the **delete-order** guard — a 4HI machine head is checked against **6HI** access. Must use the order's actual machine.
- **Gap V1:** `getHandoverOverview` only queries `status='PENDING'` and `['ACCEPTED','CLARIFICATION_REQUESTED']` — a new `AUTO_COMPLETED` handover shows on **no** dashboard (§6).

---

## A. Combined production — per-order deselect checkbox

**Now:** the operator selects a card; the client auto-detects all compatible siblings (`detectCombinedRunFromQueue` / `findCompatibleOrdersForCombine` in `combinedProductionRun.ts`) into `combinedRun.batchNumbers`, and **Start Combined** posts the **whole set** (`SixHiLayout.handleStart` → `POST /6hi/orders/start-combined { batchNumbers: combinedRun.batchNumbers }`). The operator cannot drop one.

**Change (client-only — the server already accepts an arbitrary subset):**
1. Add a **selection set** (default: all compatible batches checked) to the combined-run UI (`CombinedProductionOrdersPanel.tsx` / the combine confirm modal / action rail).
2. Render a **checkbox per order** — visible **only when the order is part of a compatible combined run** (≥2 compatible orders). Toggling excludes/includes that batch.
3. `handleStart` sends **only the checked** batch numbers: `POST /6hi/orders/start-combined { batchNumbers: selected }`.
4. Guards: if the operator unchecks down to **1**, treat it as a **single-order start** (`/orders/{batch}/start`); block starting with **0**; show the running count ("3 of 5 selected").
5. Mirror the subset into the reject/stoppage combined-target logic (`rejectActionBatchNumbers`, `resolveCombinedStoppageTargets`) so a deselected order isn't held/stopped with the run.

_Example satisfied: 5 compatible orders detected → operator unchecks 2 → only the 3 checked run combined._

**Test:** deselect to 3/5 → only 3 go `IN_PROGRESS`; deselect to 1 → single start; the server key/compatibility guard (`Task 2`) still validates the chosen subset.

---

## 1. End Shift / Shift Handover console — must always open, no errors, no dup calls

**Now:** the outgoing console (`CrmOutgoingHandoverPage`), the accept gate (`HandoverAcceptGate` — `getPending` with a 15s timeout race), and `useShiftEndWatcher` (polls `/shifts/current` every 15s) each fetch handover state independently → duplicate `/machines/handover/*` calls and, on any one failing, a blank/blocked modal.

**Changes:**
1. **Single source of truth for handover state** — route `pending` / `preview` / `draft` through one keyed fetch (SWR keyed by `machineCode`) so `HandoverAcceptGate`, the console, and the watcher **share one deduped request** (`dedupingInterval`), instead of three parallel ones.
2. **Modal always opens** — the outgoing console must render even if `preview` fails: show the form with a non-blocking inline error + Retry; never gate the whole modal on a failed enrichment call. Locked/computed fields degrade to "—", manual fields stay editable.
3. **Graceful API failure** — wrap each handover call so a 4xx/5xx surfaces an inline message (not an unhandled rejection / white screen); 401 → login (already handled in the gate); network → retry with the apiClient timeout (see perf plan).
4. **Remove duplicate calls** — audit the mount effects: `HandoverAcceptGate.checkPending`, the console's preview/draft load, and the watcher's `/shifts/current` — collapse overlapping fetches; don't re-fetch `pending` on every re-render (memoize the key).

**Test:** open Shift Handover with the preview endpoint forced to fail → modal still opens, form usable, one error shown; network tab shows a single `pending`/`preview` call, not duplicates.

---

## 2. Operator Queue — Completed / Hold / Pending rules + auto-refresh

Queue source: `GET /6hi/queue` → `SixHiQueueService.getQueue`; terminal orders via `SixHiService.fetchTerminalBatches`; completed list also via `GET /6hi/orders/completed`.

**Completed** — _only current Production Date + current Shift._
- **Already correct:** `fetchTerminalBatches` scopes `COMPLETED` to the resolved shift-log(s) for the active prodDate/shiftCode. Keep. Verify the client Completed tab uses the shift-log-scoped result (not a calendar-day query).

**Hold (REJECTED)** — _show ALL held orders (all shifts/dates) until completed; never show completed._
- **Change:** `fetchTerminalBatches` currently scopes **both** COMPLETED **and** REJECTED to the current shift-log. **Split them:** keep COMPLETED shift-scoped; fetch **REJECTED machine-wide, no shift/date filter** (`o.status='REJECTED'`, `pb.machine_code=…`, `sub_process=…`). A held order leaves the hold queue only when reinstated (→ PENDING/PREPARING) or completed.

**Pending / Running** — _continue into the next shift._
- Running (`IN_PROGRESS`/`STOPPAGE`) already carries forward via handover re-parenting (`acceptHandover` / Tier 1 `reparentOpenWork`). Pending appears by plan. **Verify** the pending/running queue is **not** hard-filtered to a single shift-log so carried-forward work shows for the new shift.

**Auto-refresh** — _after Shift Handover, Shift Accept, Shift Change, or Order Status update._
- There's a `PRODUCTION_SYNC_EVENT` bus (`productionSync.ts`) + SWR `refreshInterval: 15000` on capture pages. **Wire the queue to it:** dispatch `notifyProductionChanged()` (or SWR `mutate` of the queue key) after `createOutgoingHandover`, `acceptHandover`, shift-change detection (`useShiftEndWatcher`), and every order status mutation (start/end/reject/reinstate/allocate). The queue subscribes and revalidates immediately (no 15s wait).

**Test:** hold an order in Shift A, roll to Shift B → it still shows in Hold; complete it → leaves Hold, shows in Completed only for the shift it completed in; run an order → after End-Shift/Accept it continues in B's queue; every mutation refreshes the queue without manual reload.

---

## 3. Reading Details + Crew — single source of truth, auto-load, persist

**Fields:** Temperature, Coolant Pressure, Scrap, Shift Remarks (+ configured readings); **Crew** members/roles.
**Stores:** readings → `txn.crm_shift_summary` (`coolant_temp_degc`, `coolant_press_kgcm2`, `scrap_kg`, remarks in snapshot); crew → `txn.session_crew` (↔ session ↔ shift-log). Endpoints exist: `/crew` (GET/POST by shiftLogId), handover `saveShiftSummary`.

**Rules to implement:**
1. **Single source of truth** — readings live in `crm_shift_summary` keyed by shift-log; crew in `session_crew`. All screens **read from these**, not from local/handover-only copies.
2. **Auto-load everywhere** — the outgoing handover form (`CrmOutgoingHandoverPage`) currently pre-fills from the **draft** snapshot; change it to load from the **persisted `crm_shift_summary` + `session_crew`** for the current shift-log so values appear even without a draft (after logout/login, on a fresh device, on accept).
3. **Never duplicate entry / never blank if data exists** — if a reading/crew value exists for the shift-log, the field is pre-filled and read-only-until-edit; the operator isn't asked twice (in-shift Shift Readings + handover share the same store — see Tier 1 §13 / §11).
4. **Persist across save, reopen, logout/login, accept** — because the store is server-side per shift-log, reopening or a different operator (post-accept) loads the same values. Verify `acceptHandover` does **not** wipe the summary/crew.
5. **Save once, reuse** — one write path (`PATCH/POST` to `crm_shift_summary` / `/crew`); handover submit reads, doesn't re-collect.

**Test:** enter Temp/Scrap/Crew mid-shift → logout/login → open handover → all pre-filled; accept as next operator → prior shift's readings/crew still attached to the prior shift-log; no field blank when data exists.

---

## 4. Machine Shift Review — only the active shift

**Now:** `PlantShiftReviewPage` lists shift-logs for a date/status and renders `getShiftReview` per log; it can show multiple shifts.

**Change:** default the review to the **currently active shift only** (e.g., today + Shift A → show only A; B/C hidden until they become the active clock shift). Resolve the active shift via `ShiftDetectionService.getCurrentShift` (same source the queue uses) and filter the shift-log list to it. Keep an explicit override (date/shift picker) for MH/PH historical review, but the **default view = active shift**.
**Auto-update on shift change** — subscribe to the shift-change signal (`useShiftEndWatcher` / clock poll) and re-resolve the active shift so the view rolls A→B→C automatically.

**Test:** at Shift A only A shows; at the A→B boundary the view switches to B automatically; historical shifts reachable only via explicit picker.

---

## 5. Auto Shift Handover — visible & consistent on 3 screens

**Now (Gap V1):** `getHandoverOverview` returns only `PENDING` + `['ACCEPTED','CLARIFICATION_REQUESTED']`. A Tier 1 `AUTO_COMPLETED` handover appears on **none** of the screens.

**Change — surface `AUTO_COMPLETED` (and `PENDING_REVIEW`) everywhere:**
1. **Machine Head Dashboard → Handover Queue** and **Plant Head Dashboard → Shift Handover Queue** — include `AUTO_COMPLETED` in the overview query (`getHandoverOverview` recent/logs branch) with an **"Auto / system"** badge + review status.
2. **Shift Handover Logs** — list all statuses incl. `AUTO_COMPLETED`.
3. **Consistency** — all three read the same source (`txn.machine_handover` via `getHandoverOverview` / `getMachineHandoverSummary`) and show identical fields: **status, production date, shift, machine, timestamps (created/accepted), operator (outgoing + incoming/`SYSTEM`)**. No screen computes its own subset.

**Test:** trigger a Tier 1 auto handover → it appears on MH dashboard, PH dashboard, and Logs with the same machine/shift/date/timestamps/operator and an Auto badge; `PENDING_REVIEW` stays until MH sign-off (Tier 1 §12).

---

## 6. 6HI ↔ 4HI parity audit

Because the engine is shared, parity = **eliminate machine-hardcoded branches** and verify both mills exercise the same path. Checklist:
- **Fix Bug P1** — `sixHiRoutes.ts:601` delete-order guard: replace hardcoded `'6HI'` with the order's resolved machine (or the route's `crmMill`).
- **Grep sweep** — `'6HI'|'4HI'|'2HI'` literals in `SixHiService`, `sixHiRoutes`, `client/src/**/sixHi/**` outside the mill-catalog constants; each hit is a parity risk to justify or remove. (Current sweep: only P1 in server; verify client `machine=` injection in `apiClient` treats 4HI/6HI identically.)
- **Verify identical for both mills:** End Shift, Shift Handover, Operator Queue, Machine Shift Review, Reading Details, Auto Handover, API responses, data persistence, validations, error handling, UI behavior.
- **Sub-process note (not a bug):** 4HI and 6HI both do ROLLING **and** SKIN_PASS; 2HI is SKIN_PASS-only. Parity is between 4HI and 6HI — confirm SKIN_PASS behaves identically on both.

**Test:** run the §8 E2E on **both** 4HI and 6HI; diff API responses/states — must match except machine code.

---

## 7. Files touched (by area)

**Client**
- Combine (A): `components/sixHi/CombinedProductionOrdersPanel.tsx` (+ the combine confirm modal / action rail), `components/sixHi/SixHiLayout.tsx` (`handleStart`, reject/stoppage targets), `lib/combinedProductionRun.ts`.
- End Shift (1): `components/HandoverAcceptGate.tsx`, `pages/sixHi/CrmOutgoingHandoverPage.tsx`, `hooks/useShiftEndWatcher.ts`, `services/machineHandoverService.ts` (share one keyed fetch).
- Queue (2): the queue view/tabs (`SixHiHub` / capture page), `lib/productionSync.ts` wiring.
- Readings/Crew (3): `CrmOutgoingHandoverPage.tsx`, the Shift Readings + crew popups (Tier 1 §11/§13).
- Shift Review (4): `pages/plant/PlantShiftReviewPage.tsx`.
- Auto-handover visibility (5): MH dashboard (`MachineHeadDashboard`), PH dashboard (`PlantHeadDashboard`), handover logs view.

**Server**
- Parity (6/P1): `routes/sixHiRoutes.ts` delete-order guard.
- Queue (2): `services/SixHiService.ts` `fetchTerminalBatches` (split COMPLETED vs REJECTED scoping); `services/sixHi/SixHiQueueService.ts`.
- Readings/Crew (3): `crm_shift_summary` read path in handover preview; `CrewService`.
- Auto-handover visibility (5): `services/MachineHandoverService.ts` `getHandoverOverview` (+ `ReportingService` handover feeds) — include `AUTO_COMPLETED`/`PENDING_REVIEW`.

---

## 8. End-to-end verification & acceptance criteria

**Flow (run on BOTH 4HI and 6HI):**
Start Shift → Process Orders → Hold Order → Complete Order → End Shift → Open Handover → Submit → Logout → Login (Next Shift) → Accept Handover.

**Acceptance criteria (all must pass):**
- No console or API errors anywhere in the flow.
- Shift Handover **always** opens (even with a failing enrichment call).
- Completed queue = **only** current Production Date + current Shift.
- Hold queue = **all** held orders (any shift/date) until completed; never shows completed.
- Pending/Running orders **continue** into the next shift.
- Reading Details + Crew **auto-fill everywhere** and **persist** across save/reopen/logout/login/accept; no duplicate entry; never blank when data exists.
- Machine Shift Review shows **only the active shift**, auto-updates on shift change.
- Auto Shift Handover appears in **MH dashboard, PH dashboard, and Shift Handover Logs** with consistent status/date/shift/machine/timestamps/operator.
- **4HI and 6HI identical** functionality and business logic (diff = machine code only).

**Regression gate:** `tests/shiftHandoverFlow.test.ts`, `tests/shiftBoundary.test.ts`, `tests/reinstateAndShiftSummary.test.ts`, `tests/machineAllocation.test.ts`, `tests/orderAssignmentBoard.integration.test.ts`, `tests/integration/machineHeadLifecycle.integration.test.ts`, plus `npm run arch:check`, `e2e:smoke`.

---

## 9. Suggested order

1. §6 P1 fix + parity grep (cheap, unblocks correct 4HI testing).
2. §2 queue rules (Hold scoping split + auto-refresh).
3. §3 readings/crew single-source (depends on Tier 1 §11/§13 stores).
4. §1 handover console dedupe + graceful open.
5. §A combine deselect.
6. §4 shift-review active-shift filter.
7. §5 auto-handover visibility (after Tier 1 `AUTO_COMPLETED` exists).
8. §8 E2E on both mills.

_Open items inherited: Tier 1 sign-off/state decisions; combine same-machine/sub-process guard scope (Task 2)._
