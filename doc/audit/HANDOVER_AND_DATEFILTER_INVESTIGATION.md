# Shift Handover + Operator Date-Filter — Investigation & Fix Spec

Scope: three reported problems — (1) handover console frozen / no input / intermittent `403`, (2) whether handover logic is sound and whether the PPC planned date is used, (3) whether the operator date filter works. This is a **diagnosis + where-to-edit** sheet. No code was changed.

---

## Issue 1 — Handover console freezes and won't take input (+ intermittent 403)

### 1a. The freeze — infinite render loop in `useManualDraft`

**File:** `packages/client/src/lib/useFormDraft.ts` — `useManualDraft`, load effect at **lines 85–108**.

The load effect lists `values` and `setValues` in its dependency array (line 108) and inside calls `setValues({ ...values, ...parsed })` (line 96). `setValues` produces a **new `values` object reference**, which re-triggers the effect, which calls `setValues` again → infinite loop that saturates the main thread and freezes the screen. The IDE's diagnosis is correct.

**It is worse in this screen because of how the caller invokes the hook.**
**File:** `packages/client/src/pages/sixHi/CrmOutgoingHandoverPage.tsx` — the `useManualDraft(...)` call at **lines 277–299**.

- 1st arg is `buildPayload()` — **called inline**, returning a brand-new object every render (even though `buildPayload` itself is a `useCallback`).
- 2nd arg is an **inline arrow function** — a new function reference every render.

So even the "reference-stable" deps aren't stable: `values` and `setValues` change on *every* render, so the load effect (and the save effect at lines 111–124) re-run on every render regardless. Combined with the `setValues`-triggers-render cycle, the page locks up and inputs never register.

**Where / what to edit (choose the hook fix; the caller fix is recommended too):**

1. **Hook — `useFormDraft.ts`, load effect (lines 85–108):** make it run **once per `draftKey`**, not on every `values` change.
   - Remove `values` and `setValues` from the dependency array — leave only `[draftKey]` (silence `react-hooks/exhaustive-deps` on that line).
   - Guard re-entry with a `useRef(false)` "hasLoaded" flag (reset when `draftKey` changes), so a draft is applied only once on mount.
   - The load closure should stop reading the live `values`; apply `parsed` directly (the caller's setter already merges field-by-field).
2. **Hook — save effect (lines 111–124):** it recreates the `debounce` on every render and depends on `values`. Prefer creating the debounced saver once (`useRef`/`useMemo` keyed on `draftKey`) and feeding it the latest values, so saving doesn't churn on every keystroke-render.
3. **Caller — `CrmOutgoingHandoverPage.tsx` (lines 277–299):** pass **stable references**:
   - Memoize the payload: `const draftValues = useMemo(() => buildPayload(), [buildPayload]);` and pass `draftValues` instead of calling `buildPayload()` inline.
   - Wrap the restore callback in `useCallback(..., [])` (the setters are stable) instead of an inline arrow.

Fixing the hook (items 1–2) stops the freeze on its own; the caller change (item 3) removes the remaining wasteful re-runs and is good hygiene.

### 1b. The intermittent `403` — machine-access authorization, not the freeze

The `403` is a **separate** problem from the freeze. Trace:

- Client calls `POST /machines/handover/:machineCode/draft` and `.../outgoing` (`packages/client/src/services/machineHandoverService.ts`, lines 253–264).
- Route: `packages/server/src/routes/machineHandoverRoutes.ts`. Every handler calls `assertMachineAccess(req.user!, machineCode)` (e.g. lines 108, 160). On failure `handoverRouteStatus` maps it to **403** (lines 13–18).
- Policy: `packages/server/src/auth/machineAccessPolicy.ts`, `assertMachineAccess` (lines 20–29) — allows `ADMIN`/`PLANT_HEAD`, otherwise requires `machineCode` to be in `user.machineAccess`.
- `user.machineAccess` is **baked into the SuperTokens access-token payload at login** — set in `createNewSession` override (`packages/server/src/app.ts`) from `getAuthUserBySuperTokensId` → `security.machine_access` (`packages/server/src/services/authService.ts`, lines 227–248). `requireAuth` (`authMiddleware.ts`, lines 18–41) reads the payload and **never re-queries the DB**.

So a `403` on handover means the **token's `machineAccess` array does not contain the machine** (e.g. `6HI`). Likely causes, in order of probability:

1. **Stale token claims.** Machine access granted/changed *after* the operator logged in isn't reflected until they log out and back in (the claim is frozen in the token). Intermittent-by-user matches this.
2. **Session linkage / migration gap.** `getAuthUserBySuperTokensId` looks up `security.app_user.supertokens_user_id` (`authService.ts` ~line 254). That column is added by migration `1926000000000_add_supertokens_user_id`. If the **factory DB wasn't migrated** (the 17-migration gap from the earlier DB refactor) or a user's `supertokens_user_id` is `NULL`, the lookup returns `null`, the `createNewSession` override attaches **no `machineAccess`**, and *every* `assertMachineAccess` throws 403. Worth checking on the factory server specifically.
3. **Genuine missing grant** — no row in `security.machine_access` for that `(user, machine)`.

**Where / what to check or edit:**
- Verify on the factory DB: `SELECT user_id, username, supertokens_user_id FROM security.app_user;` (column exists? populated?) and `SELECT * FROM security.machine_access WHERE machine_code = '6HI';` for the affected operators.
- If stale claims are the cause, the durable fix is to stop trusting the frozen claim: in `requireAuth` (`authMiddleware.ts`), re-hydrate `machineAccess`/`roles` from the DB (via `getAuthUserBySuperTokensId`) per request, or add a SuperTokens session-claim validator that refreshes it — rather than reading only `payload.machineAccess`. (Trade-off: one extra query per request.)
- Ensure operators re-login after any access change until the above is in place.

### 1c. Is the draft being saved? (and does the 403 affect it?)

There are **two independent draft paths**, and the answer is "partly":

- **Local draft** → `useManualDraft` → Capacitor `Preferences` (device storage), key `draft_<machineCode>` (`useFormDraft.ts` lines 116, 54). This is what the freeze corrupts; it is **not** gated by auth.
- **Server draft** → `saveDraft()` → `POST /machines/handover/:machineCode/draft` (`CrmOutgoingHandoverPage.tsx` `saveDraft`, lines ~254–268; auto-saved every `AUTO_SAVE_MS`). This **is** gated by `assertMachineAccess` → if the user hits the 403, the server draft silently fails. Note the `catch { /* Non-fatal */ }` (line ~262) swallows the error, so the UI shows no failure even though nothing persisted server-side.

**Suggested edit:** surface server-draft failures instead of swallowing them — in `CrmOutgoingHandoverPage.tsx` `saveDraft`'s `catch`, set a visible "draft not saved" state (and specifically flag `403` as an access problem) so operators aren't misled into thinking work is saved.

---

## Issue 2 — Handover logic & PPC planned-date usage

### 2a. Handover logic (as implemented — for reference)

Server: `packages/server/src/services/MachineHandoverService.ts`.

1. **Session pinning** — `ensureActiveSession` (line 942) opens/pins a `txn.machine_shift_session` for the machine+operator so a shift closing after 06:00 stays `C→A` rather than jumping to the wall-clock shift.
2. **Preview** — `buildOutgoingPreview` (line 163): resolves the machine's process, then the current shift via `resolveOutgoingShift` → `ShiftDetectionService.getCurrentShift` (prefers the active session's `prod_date`, else a shift override, else the clock). Builds the queue snapshot, active-order detail, open stoppages, runtime.
3. **Draft** — `saveDraftHandover` (line 340): upserts a `DRAFT` row on `txn.machine_handover` with `outgoing_shift_code`/`outgoing_prod_date` from the resolved shift and computed `incoming_shift_code`/`incoming_prod_date` (next shift).
4. **Submit** — `createOutgoingHandover` (line 442): promotes `DRAFT → PENDING` and closes the session.
5. **Accept** — `acceptHandover` (line 721): the incoming operator accepts; a new shift log/session is created for `incoming_shift_code` + `incoming_prod_date` (lines 762–763), and stoppages/attribution carry across.
6. Authorization is enforced per call by `assertMachineAccess` / `assertHandoverMachineAccess` (see 1b).

The end-to-end logic is coherent. The practical failure modes are the **freeze (1a)** and **machine-access 403 (1b)**, not the handover state machine itself.

### 2b. Is the PPC planned date used? — **Yes, but it is deliberately decoupled from the operational production date.**

There are **two distinct dates**, and the code separates them on purpose:

- **PPC planned date** = `planning.ppc_batch.plan_date` (the planning intent from PPC import).
- **Operational production date** = `prod_date` on `txn.shift_log` / `txn.crm_order` / handover, derived from `ShiftDetectionService` (active session → override → clock).

`plan_date` **is** used — for queue/backlog bucketing, traceability, and reporting:
- `packages/server/src/services/SixHiService.ts` — backlog vs today bucketing compares `pb.plan_date` against the operational view date (lines ~355–376). Explicit comment at line 330: *"Operational production date from shift detection (**not** PPC plan_date)."*
- `packages/server/src/elastic/traceabilityIndexer.ts` (lines 23, 49–51) and `traceabilityIndex.ts` (line 42) index `plan_date`.
- `packages/server/src/export/definitions/RejectedOrdersReport.ts` (line 88) maps `pb.plan_date` → "Production Date".
- Import parsers write it: `ppcCsvParser.ts`, `rollingPlanXlsxParser.ts`.

What `plan_date` is **not** used for: it is **never written into the operational `prod_date`** of shift logs / produced orders / handovers. Those come from shift detection (`SixHiService` lines 63, 115/130, 746/782; comment at 466: *"attributed via crm6_order.shift_log_id (never PPC plan_date)"*).

**Implication for the handover screen:** the "production date" shown/stored on a handover is the **shift-detected operational date, not the PPC planned date.** If the business expectation is that a handover reflects the PPC planned date, that link does **not** exist today.

**Where to change (only if the business wants them linked):** production attribution in `SixHiService.ts` (`ensureActiveShiftLog` line 61 and the order-attribution writes around lines 746–796) is where `prod_date` is chosen; that is the single place to source `prod_date` from the order's `ppc_batch.plan_date` instead of the shift clock. Recommend confirming intent before touching — the current decoupling is deliberate.

---

## Issue 3 — Operator date filter (SixHiHub) — **partially working**

**Operator screen:** `packages/client/src/pages/sixHi/SixHiHub.tsx`. Date filter input at **lines 600–609** (`viewDate` state, line 86); the fetch `loadQueue` uses `date` and lists it in deps (lines 129–189), so **changing the date does refetch** — the client wiring is fine.

**The bug is in what gets scoped by date vs by the active shift log.**

- `loadQueue` sends both `date` **and** `shiftLogId` when a `shiftLogId` is set (`SixHiHub.tsx` lines 137–141). That `shiftLogId` is the **currently active** shift log (today), not the selected date's.
- Backend `GET /6hi/queue` (`packages/server/src/routes/sixHiRoutes.ts`, lines 316–349): it honors the passed `shiftLogId` as-is; only when absent does it resolve one — and even then from `detected.prodDate` (**today**), never from `viewDate` (lines 335–338). Comment at 337: *"Prefer operational detection date so completed/hold stay on the active shift."*
- `SixHiService.getQueue` → completed/rejected block (`SixHiService.ts` lines 466–506): scopes those lists by `effectiveShiftLogId = shiftLogId ?? resolveShiftLogIdForPlan(prodDate, ...)`, then by sibling shift logs sharing that shift log's `prod_date`.

**Net effect:** the **live queue / pending-allocation / backlog** columns follow the date filter (they key off `viewDate` → `plan_date`/`prod_date`), but the **Completed / Rejected / Order-Hold** columns stay pinned to **today's active shift log**. So selecting a past date does not show that date's completed/rejected orders — the filter looks broken for those columns.

**Where / what to edit (pick one side; client-side is smaller):**

- **Client — `SixHiHub.tsx` `loadQueue` (lines 137–141):** only attach `shiftLogId` when the selected `viewDate` equals today (`currentPlantDate()`). For a historical date, send just `date` (+ `shift`) and omit `shiftLogId`, forcing the backend to resolve the shift log from the selected date.
- **Backend — `sixHiRoutes.ts` `/queue` (lines 335–338):** when `req.query.date` is present and differs from `detected.prodDate`, resolve `shiftLogId` from `viewDate` (`resolveShiftLogIdForPlan(viewDate, shiftCode)`) instead of honoring the passed active `shiftLogId` / today's detection.

Either change makes the Completed/Rejected/Hold columns honor the date filter. (The same active-shift-pinning pattern exists in the Machine-Head / Plant-Head dashboards; apply the same logic there if those filters are also expected to browse history.)

---

## Summary

| # | Symptom | Root cause | Primary file(s) |
|---|---|---|---|
| 1a | Console freezes, no input | Infinite render loop: `values`/`setValues` in load-effect deps + inline unstable args | `lib/useFormDraft.ts` (85–108); `pages/sixHi/CrmOutgoingHandoverPage.tsx` (277–299) |
| 1b | Intermittent 403 | `assertMachineAccess` fails — stale token `machineAccess` claim / missing `supertokens_user_id` link / no grant | `routes/machineHandoverRoutes.ts`, `auth/machineAccessPolicy.ts`, `middleware/authMiddleware.ts`, `services/authService.ts` |
| 1c | "Saved" but not saved | Server draft POST hits 403 and error is swallowed (`catch {}`) | `pages/sixHi/CrmOutgoingHandoverPage.tsx` `saveDraft` |
| 2 | PPC planned date usage | Used for planning/traceability/reports, but **decoupled** from operational `prod_date` by design | `services/SixHiService.ts` (comments at 330, 466) |
| 3 | Date filter "not working" | Completed/Rejected/Hold pinned to active `shiftLogId` (today), not the selected date | `pages/sixHi/SixHiHub.tsx` (137–141); `routes/sixHiRoutes.ts` (335–338); `services/SixHiService.ts` (466–506) |

**Likely linkage:** the 403 (1b) may be a downstream symptom of the earlier **17-migration gap** on the factory server — if `supertokens_user_id` isn't present/populated, sessions carry no `machineAccess` and every handover call 403s. Confirm the factory DB is migrated (see the earlier DB refactor deliverables) before chasing per-user grants.
