# Bug Spec — Stale shift-session pins operator to yesterday's shift

**Target tree:** mounted **`hsl_zedral-main`**. **Spec only** — no edits made. Confirm line numbers
before editing (not git-tracked).

## Summary
On login the operator is placed in **yesterday's C→A shift** instead of the current one, must hand over
repeatedly to "catch up," and returns to the old shift after logout/login. Root cause: a
`machine_shift_session` left `ACTIVE` overnight is treated as **live** for a full plant day, so the
resolver pins to it and reuses it — and the stale-close path derives its "current shift" from that same
stale session (circular), so it's never closed.

## Root cause (verified, with locations)
All in `packages/server/src/services/ShiftDetectionService.ts` unless noted.

1. **`isSessionDateLive` (line 20-22)** — liveness is a flat 1-plant-day calendar window:
   ```ts
   function isSessionDateLive(prodDate) {
     const earliestLive = addPlantDays(currentPlantDate(), -1);   // 'YYYY-MM-DD'
     return formatDbDate(prodDate) >= earliestLive;               // yesterday counts as LIVE
   }
   ```
   A C session with `prod_date = yesterday` is "live" all day today — even at 14:00, long after C ended
   at 06:00. It cannot tell "C 30 min past 06:00" (legit overtime) from "C from a full day ago" (stale).

2. **`findActiveSession` (line 155-185)** — same flat window in SQL:
   `.where('s.prod_date', '>=', parsePlantDateOnly(addPlantDays(currentPlantDate(), -1)))` → returns
   yesterday's ACTIVE session, `orderBy started_at desc`.

3. **`getCurrentShift` (line 232+)** — pins to that session unconditionally: *"ACTIVE session wins even
   when clock has rolled"* → returns `source: 'SESSION'` = yesterday C.

4. **`MachineHandoverService.ensureActiveSession` (line 942+)** — the reuse + circular close:
   ```ts
   if (existing) {
     if (ShiftDetectionService.isSessionDateLive(existing.prod_date)) {
       return { session: existing, ... };                 // ← yesterday reused → pinned
     }
     const clock = await ShiftDetectionService.getCurrentShift({ machineCode }); // ← STILL pins to session!
     await ShiftDetectionService.closeStaleOperatorSessions(machineCode, operatorUserId, clock.prodDate, clock.shiftCode);
   }
   ```
   Two defects: (a) `isSessionDateLive` returns true for yesterday → early `return` (reuse), close never
   runs; (b) even when it does run, `getCurrentShift({ machineCode })` resolves via `findActiveSession`
   again → `clock` = the stale session's shift → `closeStaleOperatorSessions` keeps the stale session
   (it "matches operational"). **Circular.**

5. **`ShiftBoundaryScheduler` is a no-op** (`jobs/ShiftBoundaryScheduler.ts`) — by policy no auto-advance,
   so an un-handed-over C shift stays "current" until a manual handover. (Keep this policy; it's fine
   once staleness is bounded.)

## Reproduction
C shift on a machine is never handed over overnight → its session stays `ACTIVE`, `prod_date = yesterday`.
Next day the operator logs in → resolver returns yesterday C (steps 1-4) → to reach "now" they hand over
per shift boundary crossed (2 boundaries → 2 handovers) → logout/login re-runs the same resolution →
back to yesterday C.

## The fix — bound "live" by the shift's actual end + grace (not a calendar day)

Define a single liveness rule: a session is **live** only while
`now ≤ (its shift-window end datetime) + GRACE`. `GRACE` covers legitimate overtime (e.g. C running a bit
past 06:00). New env `SHIFT_OVERTIME_GRACE_HOURS` (default **2**).

### Change 1 — add a shift-end helper + time-aware liveness (`ShiftDetectionService.ts`)
Add near the other helpers:
```ts
const OVERTIME_GRACE_MS = (Number(process.env.SHIFT_OVERTIME_GRACE_HOURS) || 2) * 3_600_000;

/** End datetime of a shift window; C (end < start) ends next calendar day. */
function shiftEndDateTime(prodDate: Date | string, startTime: string, endTime: string): Date {
  const base = parsePlantDateOnly(formatDbDate(prodDate as Date)); // 00:00 of prod_date
  const [eh, em] = endTime.split(':').map(Number);
  const [sh]      = startTime.split(':').map(Number);
  const end = new Date(base);
  end.setHours(eh, em, 0, 0);
  if (eh < sh) end.setDate(end.getDate() + 1);   // crosses midnight (night C)
  return end;
}

/** Live only until shift end + grace — replaces the flat 1-day window. */
function isSessionLive(session: { prod_date: Date | string; start_time: string; end_time: string }): boolean {
  return Date.now() <= shiftEndDateTime(session.prod_date, session.start_time, session.end_time).getTime() + OVERTIME_GRACE_MS;
}
```
Keep `isSessionDateLive` only if other callers need it; otherwise replace its body to delegate to
`isSessionLive` (it now needs the window, so callers must pass start/end — see Change 4).

### Change 2 — `findActiveSession` filters by real liveness (line ~171-184)
The query already joins `master.shift` (has `start_time`,`end_time`). Keep the 1-day SQL prefilter (cheap),
then drop stale rows in JS:
```ts
// after fetching candidate rows (user-scoped then machine-scoped), before returning:
const live = (row: SessionRow | undefined) =>
  row && isSessionLive({ prod_date: row.prod_date, start_time: row.start_time, end_time: row.end_time }) ? row : null;

if (userId) {
  const u = await sessionSelect().where('s.operator_user_id', '=', userId).executeTakeFirst();
  const r = live(u as SessionRow); if (r) return r;
}
const a = await sessionSelect().executeTakeFirst();
return live(a as SessionRow);
```
Result: a session past `shiftEnd + grace` is **not** returned → `getCurrentShift` falls through to the
clock/override (step 3 no longer pins to yesterday).

### Change 3 — `closeStaleOperatorSessions` decides "stale" from liveness, not a passed-in shift (line 196-225)
Remove the circular `prodDate/shiftCode` inputs; close any of this operator's ACTIVE sessions that are no
longer live:
```ts
static async closeStaleOperatorSessions(machineCode: string, operatorUserId: number): Promise<number> {
  const stale = await db.selectFrom('txn.machine_shift_session as s')
    .innerJoin('master.shift as w', 'w.shift_code', 's.shift_code')
    .select(['s.session_id', 's.prod_date', 'w.start_time', 'w.end_time'])
    .where('s.machine_code', '=', machineCode)
    .where('s.operator_user_id', '=', operatorUserId)
    .where('s.status', '=', 'ACTIVE')
    .execute();
  const toClose = stale.filter((s) => !isSessionLive(s));
  if (!toClose.length) return 0;
  await db.updateTable('txn.machine_shift_session').set({ status: 'CLOSED', closed_at: new Date() })
    .where('session_id', 'in', toClose.map((s) => String(s.session_id))).execute();
  return toClose.length;
}
```
Update the JSDoc: it's now safe (and expected) to call this on login — it only closes genuinely-expired
sessions, never live overtime.

### Change 4 — `ensureActiveSession` uses liveness + a non-circular clock (`MachineHandoverService.ts` ~942-970)
```ts
// 'existing' comes from selectAll() (no window). Look up the window for the liveness check:
const existingLive = existing
  ? await ShiftDetectionService.isSessionLiveById(existing.session_id)   // small helper: join master.shift, run isSessionLive
  : false;

if (existing && existingLive) {
  return { session: existing, pendingHandover: null };     // genuine live/overtime reuse
}
if (existing) {
  // break the circular pin: clock/override ONLY (no machineCode)
  await ShiftDetectionService.closeStaleOperatorSessions(machineCode, operatorUserId);
  // fall through to create a fresh session for the CURRENT clock shift
}
```
Key edits: (a) replace `isSessionDateLive(existing.prod_date)` with the window-aware `isSessionLiveById`;
(b) **delete** the `getCurrentShift({ machineCode })` call (that's the circular pin) and call
`closeStaleOperatorSessions(machineCode, operatorUserId)` with no shift args (Change 3).
Add the tiny helper `ShiftDetectionService.isSessionLiveById(sessionId)` (join `master.shift`, run
`isSessionLive`).

### Change 5 — single ACTIVE session guarantee on accept (`MachineHandoverService.acceptHandover`, ~721)
Before opening the incoming session, close **all** other ACTIVE sessions for the machine (any operator):
```ts
await db.updateTable('txn.machine_shift_session').set({ status: 'CLOSED', closed_at: new Date() })
  .where('machine_code', '=', machineCode).where('status', '=', 'ACTIVE').execute();
// then insert exactly one fresh ACTIVE session for the accepted/current shift
```
The partial unique index `ux_machine_shift_session_one_active` already enforces ≤1 ACTIVE per machine;
this makes accept deterministic and prevents an orphan surviving the cutover.

## Expected behavior after fix
- Login the next day → the un-handed-over C session is **past shift-end + 2h grace** → not pinned →
  resolver returns the **current clock shift**; the stale session is auto-closed on `ensureActiveSession`.
- Legit overtime (C at 06:30, within grace) still pins to C — policy preserved.
- No need to hand over twice to "catch up"; logout/login is stable (doesn't bounce back to yesterday).

## Tests (`packages/server/tests`)
1. Session `prod_date=yesterday`, shift C, `now` = today 14:00 → `isSessionLive` false; `findActiveSession`
   returns null; `getCurrentShift` = clock shift; `ensureActiveSession` closes it and opens a fresh one.
2. Session C `prod_date=today-ish`, `now` = 06:30 (≤ end 06:00 + 2h) → live; still pinned to C (overtime).
3. `closeStaleOperatorSessions` closes an expired ACTIVE session and **keeps** a live-overtime one.
4. `acceptHandover` leaves exactly one ACTIVE session for the machine; login resolves to it, not an older one.
5. Regression: normal same-shift login reuses the live session (no spurious close).

## Rollout / risk
- Config: `SHIFT_OVERTIME_GRACE_HOURS` (default 2) — tune to the plant's real overtime tolerance.
- Behavior-guarded; no schema change. Ships as a code-only PR.
- This is the concrete instance of the shift-resolution fragility in
  `ZEDRAL_TASKS_1-3_FIX_SPEC_hsl.md` §2 — ideally folded into the single `resolveShift()` there, but the
  five changes above fix the reported bug standalone.

## Still to confirm (diagnostic)
Were the two handovers **accepted** or only **submitted (left PENDING)**? If only submitted, Change 5 +
Change 4 are the critical ones (no fresh ACTIVE was ever created); if accepted, Changes 1-4 (liveness) are
the critical ones (a stale session kept winning). Both are covered above.
