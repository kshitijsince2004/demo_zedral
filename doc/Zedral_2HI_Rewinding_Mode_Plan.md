# 2HI Rewinding Mode — Implementation Plan & Impact Analysis

**Goal:** Give the **2HI** mill a second operating mode. Today 2HI does **Skin Pass** only;
after this change 2HI supports **Skin Pass** *and* **Rewinding**, analogous to how 6HI/4HI
support Rolling + Skin Pass.

## Confirmed decisions

1. **Reuse the existing Rewinding capture** — `RwdTensionForm` → `POST /production/rwd` → `txn.prod_rwd`.
   No new form, table, or schema.
2. **Reuse rewinding route step `R`** — a rewinding order on 2HI is still route code `R`.
3. **Keep the standalone RWD line** — it is unchanged; 2HI is an *additional* rewinding executor.
4. **Full PPC-planned order flow** — rewinding orders can be planned/assigned to 2HI and appear
   in a queue on the 2HI terminal, like skin-pass orders.
5. **Auth by granting RWD line-scope** — the relevant 2HI operators receive WRITE scope on the
   `RWD` line (data/seed). No change to `lineAccessPolicy`.

## Core design principle (why this is low-risk)

**Do NOT add `'REWINDING'` to the `SixHiSubProcess` type** (`packages/shared-validation/src/types/sixHi.ts:15`).
That type is branched on in ~60 places as a binary `ROLLING ? … : (assume SKIN_PASS)`. Adding a third
value there would make every one of those silently mis-treat rewinding as skin-pass.

Instead, 2HI-rewinding rides the **existing rewinding pipeline** (sub_process marker, route `R`,
`prod_rwd`), which is entirely separate from the SixHi rolling/skin-pass engine. The SixHi engine
never sees a rewinding order because `SixHiService.getQueue(machineCode, subProcess)` filters on
`pb.sub_process = subProcess` — calling it with `'SKIN_PASS'` can never return a rewinding batch.

## Data flow (target state)

```
PPC rewinding plan row (machine = 2HI)
  → planning.ppc_batch { machine_code:'2HI', from_work_center:'R', sub_process:'REWINDING' }
  → route engine: routeCodeFromBatch('2HI','REWINDING') = 'R'
  → 2HI terminal, "Rewinding" tab: lists batches where machine_code='2HI' AND from_work_center='R'
  → operator opens order → RwdTensionForm (prefill resolves via from_work_center='R')
  → POST /production/rwd { machineCode:'2HI', … } → txn.prod_rwd
  → JourneyAdvanceConsumer advances past step 'R' (RWD already in ADVANCE_PROCESSES)
```

The dedicated RWD line keeps using `machine_code='RWD'` and is untouched.

## File-by-file changes

### Backend

**1. `packages/server/src/services/ProcessRouteService.ts` — route mapping (additive).**
In `routeCodeFromBatch`'s `map`, add:
```ts
'2HI:REWINDING': 'R',
```
Pure additive string-map entry; cannot affect existing keys. *(groundwork applied)*

**2. `packages/server/src/utils/rewindingPlanXlsxParser.ts` — allow a row to target 2HI.**
Add `'machine': 'machineCode'` (and `'work center'`) to `HEADER_MAP`, then per row:
```ts
const planMachine = String(raw.machineCode ?? 'RWD').trim().toUpperCase();
const isTwoHi = planMachine === '2HI';
// in the pushed row:
machineCode: isTwoHi ? '2HI' : 'RWD',
subProcess:  isTwoHi ? 'REWINDING' : 'RWD',
// keep fromWc default 'R' for both (prefill relies on it)
```
Default behaviour (no machine column, or `RWD`) is byte-for-byte identical to today.

**3. `packages/server/src/services/PPCImportService.ts` — persist the new sub_process.**
Confirm the rewinding-import path writes `sub_process` and `machine_code` straight from the parsed
row (it does for rolling/skin-pass). No transform should coerce `'REWINDING'`→`'SKIN_PASS'`. Verify
lines ~499–504 and ~1063 are gated on `'SKIN_PASS'`/`'ROLLING'` only and leave `'REWINDING'` alone
(they do — REWINDING falls through their `else`, which is correct here because rewinding rows carry
their own thickness fields).

**4. New queue read for the 2HI Rewinding tab.**
Add a light method (e.g. `SixHiService.getRewindingQueue(machineCode='2HI')` or a new
`RewindingQueueService`) returning `planning.ppc_batch` rows where
`machine_code='2HI' AND from_work_center='R'` and the coil has no `prod_rwd` entry yet.
**Do not route this through `getQueue`** — its card builder assumes rolling/skin-pass semantics
(passes, prep orders, destinations). Expose it as e.g. `GET /sixhi/rewinding-queue/2HI` or fold it
into the existing capture bootstrap.

**5. `packages/server/src/services/AutoSourceService.ts` — no change required.**
`loadScopedPlanBatch` matches `from_work_center='R' OR machine_code=…`; a 2HI rewinding batch keeps
`from_work_center='R'`, so RWD prefill already resolves it. (Verify, don't edit.)

### Client

**6. `packages/client/src/lib/millConfig.ts` — add the mode.**
```ts
export type MillProcessTab = 'rolling' | 'skinpass' | 'rewinding';
export function millProcessTabs(machine: MillCode): MillProcessTab[] {
  if (machine === '2HI') return ['skinpass', 'rewinding'];
  return ['rolling', 'skinpass'];
}
// add { id:'rewinding', label:'Rewinding' } to MILL_HUB_TABS
// update normalizeMillTab / defaultMillTab to accept 'rewinding'
```

**7. `packages/client/src/pages/sixHi/SixHiHub.tsx` — render the rewinding tab.**
- **Guard line ~118**: `const apiSubProcess = activeTab === 'rolling' ? 'ROLLING' : 'SKIN_PASS';`
  must NOT run when `activeTab === 'rewinding'` — skip the SixHi queue fetch entirely for that tab.
- When `activeTab === 'rewinding'`: fetch the rewinding queue (step 4) and, on order select, render
  `RwdTensionForm` with `machineCode='2HI'` (submits to `/production/rwd`).
- Audit the other binary ternaries in this file (~502, ~681) so a rewinding card doesn't render as
  "Skin Pass".

### Data / migrations

**8. New migration — registry seed (additive).**
```sql
INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
  ('2HI_REWINDING', '2HI Rewinding', '2HI')
ON CONFLICT (sub_process_code) DO NOTHING;
```
`MachineMasterService` maps only `ROLLING`/`SKIN_PASS` to capability flags, so this row is inert
there (safe). Add a `rewinding` capability flag only if the machine-master UI needs to show it.

**9. Operational — grant RWD line-scope to 2HI operators.**
For each 2HI operator who will rewind, add a `WRITE` line scope on process `RWD` (same mechanism as
their existing 2HI/ROLLING line scope). This is per-user security data, not code. Pattern:
```sql
-- grant WRITE on the RWD line to the operator's role/user scope (match existing seed shape)
```
Without this, `POST /production/rwd` returns 403 for a 2HI operator (endpoint is line-gated on `RWD`).

## Impact / regression map — "what could be hampered"

| Area | Mechanism | Verdict |
|---|---|---|
| ~60 `ROLLING?…:SKIN_PASS` branches (`SixHiService`, `LiveService`, reporting, ~30 client ternaries) | `SixHiSubProcess` type | **Safe** — type is NOT extended; rewinding never enters this world |
| 2HI **skin-pass** queue/tab | `getQueue('2HI','SKIN_PASS')` filters `sub_process` | **Safe** — rewinding batches (`sub_process='REWINDING'`) are excluded; must guard `apiSubProcess` (line 118) |
| Standalone **RWD line** | uses `machine_code='RWD'` / `RWD:` route keys | **Safe** — untouched |
| 6HI / 4HI rolling & skin-pass | not referenced | **Safe** |
| Post-rolling **REWINDING destination** (`SixHiDestination`) | different concept (where a rolled coil goes next) | **Safe** — name overlap only |
| Reporting / traceability / live | switch on CRM `ROLLING`/`SKIN_PASS` records | **Safe** — a 2HI rewind is a `prod_rwd` row, flows through existing RWD reporting, not CRM |
| Existing rewinding PPC import (RWD line) | parser default unchanged | **Safe** — 2HI path is opt-in via machine column |
| **`POST /production/rwd` auth** | line-gated on `RWD` | **Action required** — step 9 (grant line-scope) |
| PPC CSV validator `['ROLLING','SKIN_PASS']` allow-list (`ppcCsvParser.ts:193`) | rejects unknown sub_process | **Check** — rewinding uses the xlsx path, not this CSV path; if 2HI rewind ever comes via CSV, add `'REWINDING'` there |

## Test checklist (run in an environment with the build)

- `npx tsc -b` clean (catches any missed exhaustive branch).
- `routeCodeFromBatch('2HI','REWINDING') === 'R'`; `('RWD','') === 'R'` still holds.
- `parseRewindingPlanXlsx` with no machine column → rows still `machine_code='RWD', sub_process='RWD'` (snapshot unchanged).
- `parseRewindingPlanXlsx` with machine `2HI` → `machine_code='2HI', sub_process='REWINDING', from_work_center='R'`.
- 2HI skin-pass queue unchanged (regression) with a rewinding batch present in the DB.
- 2HI Rewinding tab lists the 2HI rewinding batch; opening it prefills via `from_work_center='R'`.
- 2HI operator with RWD line-scope can `POST /production/rwd`; without it → 403.
- Existing `packages/server/tests/rwdPrefill.test.ts` and `rewindingPlanXlsxParser.test.ts` pass; add cases for the 2HI branch.

## Open assumptions

- Sub_process marker for 2HI rewind is `'REWINDING'` (distinct from the RWD line's `'RWD'`) so the two
  are separable in queues/reporting. If you'd rather reuse `'RWD'`, change the route key to `'2HI:RWD'`
  and the queue filter accordingly.
- The 2HI rewinding queue is a **new, lightweight** view — not the SixHi card builder — to avoid
  rolling/skin-pass assumptions.
