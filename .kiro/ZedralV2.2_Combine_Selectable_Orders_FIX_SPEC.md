# ZedralV2.2 — Combined Production with Selectable Orders (corrected plan)

_Fixes the combine breakage introduced by §A of the 4HI/6HI spec. Applies to all CRM mills (6HI/4HI/2HI) since they share one engine._

## The one idea that fixes everything

The old code had **one list** — "the matching orders" — and every button used it. The checkbox feature needs **two separate lists**:

1. **Matching list** (detected automatically) — every order that *could* combine. The system owns this. It refreshes freely. **Never edited by hand.**
2. **Picked list** (the ticks) — the orders the operator actually wants to run together. Starts as "all matching," operator unticks the ones they don't want. **Every button (Start / End / Hold / Stoppage) uses this list, not the matching list.**

Keeping these two apart is what stops the checkboxes from being wiped on refresh and stops End/Hold from touching orders that were left out.

## Decisions (locked with you)

| Case | Behavior |
|------|----------|
| Untick down to **1** | Runs as a normal **single** order (not a "combined run of 1"). |
| Untick down to **0** | **Start disabled.** |
| **Leftover** (unticked) orders | Stay in the queue as normal separate orders; can be combined into their own group later. |
| **Refresh** while picking | Keep the ticks. A newly-appeared matching order shows up **unticked**. A ticked order that vanished/changed status **drops out** quietly. |
| Untick the **main** order | System **auto-picks a new main** from the remaining ticked orders. |
| Group **first appears** | All matching orders **ticked by default**. |
| Unticking window | **Before starting only.** |
| Once **started** | The started group **starts / ends / holds / stops all together** — including if one coil turns out bad (whole group holds). |

## How it maps to the code

**Where the two lists live** (`store/sixHiStore.ts`):
- Keep `combinedRun` as the **matching list** (the detected `{ primaryBatchNumber, batchNumbers[], orders[] }`) — detection still writes it, but nothing else mutates it.
- **Add** a picked list: `combinedSelectedBatches: string[]` (+ `toggleCombinedSelected(batch)`, and it's set whenever `combinedRun` changes — see reconcile below).

**Detection stays where it is** (`pages/sixHi/SixHiHub.tsx`): `findCompatibleOrdersForCombine` → `buildCombinedRunFromCards` → `setCombinedRun(...)`. No change to *what* it detects. The only addition is the **reconcile** step inside the store's `setCombinedRun`:

```
on setCombinedRun(newRun):
  if newRun is null          → selection = []
  else if new group (anchor/primary differs from current)
                             → selection = newRun.batchNumbers   // all ticked (first appearance)
  else (same group refreshed)→ selection = previousSelection ∩ newRun.batchNumbers
                                // keeps ticks, drops gone ones, new ones stay UNticked
  if selection is non-empty and primary ∉ selection
                             → primary = first order in selection  // auto-pick new main
```

This single rule delivers: default-all-ticked, refresh keeps ticks, dropped orders leave, new ones come in unticked, and the main order auto-heals.

**The checkbox UI** (`components/sixHi/CombinedProductionOrdersPanel.tsx`, and the pre-start confirm modal/action rail):
- Show a checkbox per order **only when it's a real group** (matching list ≥ 2).
- Tick state = `combinedSelectedBatches.includes(batch)`; click → `toggleCombinedSelected(batch)`.
- Header shows **"3 of 5 selected."**
- Start button **disabled at 0 selected.**

**The buttons — switch them all from the matching list to the picked list** (`components/sixHi/SixHiLayout.tsx`). This is the part §A missed:
- `activeBatch` → derive from the picked list's main order (not `combinedRun.primaryBatchNumber` blindly).
- **Start** (`handleStart`):
  - `selected.length >= 2` → `POST /6hi/orders/start-combined { batchNumbers: selected }`
  - `selected.length === 1` → `POST /6hi/orders/{that}/start` (single)
  - `selected.length === 0` → disabled
- **After a successful start**, set the run to the **started subset** (so the run now *is* those orders): `setCombinedRun(run built from selected)` and selection = those. Leftovers were never started → they reappear as normal queue orders on the next refresh.
- **End / Hold / Stoppage targets** (`endTargets`, `rejectActionBatchNumbers`, `resolveCombinedStoppageTargets`) → use the **running group's members** (the started subset), never the wider matching list. Since after-start the run = the started subset, this is automatic once the buttons read the run's current members.

**Server:** no change. `startCombinedProduction` already accepts any subset and re-checks that the chosen orders share coil + slit + finish (the Task-2 rule), so a hand-picked subset is validated the same way. Combined hold/end already cascade across the group (Task 3 / `combined_group_id`).

## Why this won't fight the auto-refresh

The auto-refresh (item 2) rebuilds the **matching list** — that's fine, it's supposed to. The **picked list** is only ever changed by the operator's ticks and the intersect-on-refresh rule, so a refresh can no longer wipe a deselection. That was the core clash; separating the two lists removes it.

## Test cases (the acceptance list)

1. 5 matching → untick 2 → **3 of 5** shown → Start → only those 3 go running; the other 2 remain as normal pending orders.
2. Untick down to 1 → Start runs it as a **single** order; no "combined" wrapper.
3. Untick all → **Start disabled.**
4. Untick 2, wait for an auto-refresh → the same 2 stay unticked (ticks **not** wiped); a newly-arrived matching order appears **unticked**.
5. Untick the **main** order → panel/buttons move to another ticked order automatically; nothing gets stuck.
6. Start a group of 3 → End / Hold / Stoppage each act on **all 3**; a defect on one holds all 3.
7. Leftover 2 → operator combines them into their **own** group and runs them together.
8. A ticked order gets completed by the time Start is pressed → it silently drops; only the still-valid ticked orders run.
9. Run on **both 4HI and 6HI** → identical behavior.

## Build order

1. Add the picked list + reconcile rule to the store (the heart of the fix).
2. Point the checkboxes at it (UI).
3. Switch Start / End / Hold / Stoppage to the picked list; add the 1 = single, 0 = disabled rules; set run = started subset after start.
4. Verify against the 9 test cases on both mills.

_This supersedes §A of `ZedralV2.2_4HI_6HI_Parity_and_Fixes_SPEC.md`._
