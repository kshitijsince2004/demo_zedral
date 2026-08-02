# Rewinding Line — Completion Plan (rolling-parity, as its OWN line)

Goal: bring the **Rewinding line** to feature-parity with Rolling — combine orders, start/end,
stoppages, hold, manual order, machine assignment (RWD **or** 2HI) — with a Machine-Head desk
toggle. Everything stays connected end-to-end.

## Correction (supersedes the earlier framing)

**Rewinding is its own line — NOT a sub-process of rolling.** The earlier draft proposed adding
`'REWINDING'` to `SixHiSubProcess` and treating it inside the CRM engine. That was wrong.

- `SixHiSubProcess` **stays `ROLLING | SKIN_PASS`, untouched.** No ~60-branch sweep. (This is a big
  de-risk — the rolling/CRM engine is not modified in its core.)
- `txn.crm_order` is **CRM-only** (it carries `sub_process`, roll-change, rolling/skin-pass). It is
  the *Rolling line's* order table. Rewinding must not live inside it.
- Rewinding is a **separate line** (like PKL/HRS/ANN/CRS/CTL are separate lines) that today has no
  order lifecycle — just the one-shot `RwdTensionForm → POST /production/rwd → txn.prod_rwd`.

So parity means: **give the Rewinding line its OWN order lifecycle that mirrors rolling's logic**,
reusing the generic, line-agnostic pieces — not folding rewinding into the CRM sub-process world.

## What's genuinely reusable vs line-specific

Reusable / generic (already not CRM-specific):
- `txn.stoppage` — keyed by `order_id` + `machine_code` + `shift_log_id` (no CRM FK). Reusable.
- The *algorithms*: combine eligibility check, stoppage-minutes math, the PENDING→IN_PROGRESS→
  STOPPAGE→COMPLETED / REJECTED state machine. These are logic, not CRM data.

Line-specific to Rolling (do NOT reuse by extension):
- `txn.crm_order` + `sub_process` + `SixHiSubProcess` + the rolling/skin-pass capture branches.

## Reuse strategy — LOCKED

**Isolated service + shared pure functions.** Build a standalone `RewindingOrderService` over its
own `txn.rwd_order`, mirroring rolling's lifecycle. Reuse rolling ONLY by extracting **pure
functions** that carry no CRM state — combine eligibility (`same machine + Mother/Slit/Finish
family`), stoppage-minutes math, the order state-machine transitions — into a shared module both
services import. **`SixHiService`'s data paths and `crm_order` are not modified.** Zero regression
risk to rolling; the only shared surface is side-effect-free helpers.

**Order table — LOCKED:** new `txn.rwd_order` (rewinding-specific, mirrors `crm_order`'s generic
columns, **no `sub_process`**). Not a shared `line_order`.

---

## Phase 0 — Rewinding order model (its own lifecycle)

- New table `txn.rwd_order` (LOCKED) mirroring the *generic* `crm_order` columns: `batch_id`,
  `batch_number`, `coil_no`, `slit_id`, `combined_group_id`, `status`, `machine_code` (RWD|2HI),
  `shift_log_id`, `prod_start_at`/`prod_end_at`/`prod_duration_min`, plan fields. **No `sub_process`**
  — the line is single-purpose.
- `txn.stoppage.order_id` now points at either table → add a small discriminator (`order_kind`
  `'CRM' | 'RWD'`, or a nullable `rwd_order_id`) so stoppage stays unambiguous.
- Rewinding stays route code `R`. Route-engine groundwork already applied
  (`'2HI:REWINDING':'R'` / add `('RWD','REWINDING')='R'`), operating at machine→route level, **not**
  via `SixHiSubProcess`.
- **Re-check the earlier seed**: `1948000000000_2hi_rewinding_sub_process.js` seeded
  `master.crm_sub_process`. If the rewind machine pool should be its own registry (not the CRM
  sub-process registry), move it to a rewinding-machine config so we don't imply 2HI has a CRM
  rewinding sub-process.

## Phase 1 — Machine assignment (RWD or 2HI)

Reference the rolling/skin-pass allocation *pattern*, with rewinding's own machine pool.
- Rewinding machine pool = `['RWD','2HI']` (config/registry, line-agnostic — not `machineAllocation.ts`'s
  `CrmMillCode`, which is CRM mills only).
- Rewinding order enters unallocated → operator/MH picks RWD or 2HI (mirror `MachineAllocationModal`,
  but a rewinding-scoped copy driven by the rewinding pool). 2HI executing a rewinding order = 2HI in
  "rewinding mode"; the order still belongs to the **Rewinding line**.

## Phase 2 — Start/End, Stoppage, Hold

- `RewindingOrderService`: `start`, `end`, `stoppage start/patch/end`, `reject`/`reinstate` (hold) —
  mirroring `SixHiService`, operating on `txn.rwd_order` + `txn.stoppage`, using the shared
  state-machine/stoppage-math helpers.
- Routes `/rewinding/orders/:b/{start,end,stoppages/*,reject,reinstate}` mirroring `/orders/*`.
- Capture: `PATCH /rewinding/orders/:b/capture` writes `txn.prod_rwd` (RW tensions, surface finish,
  output thk) and links to the order's `shift_log_id`; end marks COMPLETED.

## Phase 3 — Combined orders

- Reuse the extracted combine-eligibility helper: same machine + same Mother Coil + `slit_id` +
  finish family; `machine_allocated` required. Implement `startCombinedRewinding` over `txn.rwd_order`.
- Combined weight split across members (mirror `allocateCombinedRemainderToBlanks`) for `prod_rwd`.
- Client: a rewinding combined panel/history (copy of `CombinedProductionOrdersPanel`/History,
  rewinding-scoped).

## Phase 4 — Manual order

- Rewinding manual-order modal (mirror `SixHiManualOrderModal`, no rolling fields): pick coil, grade,
  width, pre-stage thk, and RWD/2HI machine → creates a `txn.rwd_order` (unallocated by default).
- Server `createManualRewindingBatch` mirroring `createManualBatch`.

## Phase 5 — Machine-Head desk toggle (Rolling MH + Rewinding)

Reference `pklMhDesk.ts` / `annMhDesk.ts` + `MachineHeadShell` Line `<select>`.
- Add `rwdMhDesk.ts` (`isRwdMhDesk`/`syncRwdDeskFocus`) + `RWD_NAV_ITEMS` in `MachineHeadNav`.
- `MachineHeadShell` already shows the Line `<select>` when an MH has `>1` machine; add the routing
  branch for the rewinding desk. A Rolling MH also granted the Rewinding line (RWD and/or 2HI in
  `machineAccess`) then gets the toggle automatically. Requires the assignment grant (data).

## Phase 6 — Wire-up & tests

- Terminal entry: the RWD line operator and the 2HI "Rewinding" tab both open the rewinding order
  queue/capture (from the `2HI_Rewinding_Mode` plan) — now backed by `txn.rwd_order`, not one-shot.
- Tests: `tsc -b` clean; unit tests for rewinding combine eligibility, stoppage totals, manual
  create, machine-allocation pool `['RWD','2HI']`, hold/reinstate; **regression that Rolling/Skin-Pass
  are byte-for-byte unchanged** (their engine wasn't touched — the whole point of the correction).

---

## Requirement → phase map

| Your ask | Where |
|---|---|
| 1) Combine orders like rolling + all combine features | Phase 3 (shared eligibility helper, own `startCombinedRewinding`) |
| 2) Start/End, stoppages, hold — working & connected | Phase 2 (own service over `txn.rwd_order` + shared `txn.stoppage`) |
| 3) Manual order adding | Phase 4 |
| Toggle for Rolling MH assigned Rewinding (PKL/HRS pattern) | Phase 5 |
| Assign rewinding order to RWD or 2HI | Phase 1 |

## Sequencing & risk

Order: **0 → 1 → 2 → 4 → 3 → 5 → 6**. Rolling/CRM code is left intact; the only shared touch is
optional helper extraction (Option A) — otherwise fully isolated. Biggest constraint: this
share-copy has no deps, so `tsc -b`/tests can't run here — build where the TypeScript build runs.
Keep the current one-shot `/production/rwd` path alive until Phase 2's order-backed capture is proven,
then cut over.
