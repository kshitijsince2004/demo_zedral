# Follow-ups Work Package — All-Process Operator

> Hand this to the IDE agent the same way the three core spec files were handed
> over. It covers the four remaining workstreams after the green build:
> **(A)** verify the two custom-routing paths (ANN charge fan-out, CRS quality
> gate + For-CTL), **(B)** wire the shared sub-forms, **(C)** backbone tests,
> **(D)** feature flags then retire the generic capture page.
>
> **Names marked *(as implemented — confirm)* are the spec's intended symbol
> names.** The implementation was done in the Windows working tree; locate the
> actual symbol before editing and keep the real name.
>
> **Windows encoding guard:** after editing any `.ts`, if the client build throws
> `Invalid Character`, re-save UTF-8/LF:
> `python -c "import pathlib; p=pathlib.Path('FILE'); p.write_text(p.read_bytes().decode('utf-16-le'), encoding='utf-8', newline='\n')"`

---

## Workstream A — Verify ANN + CRS routing (correctness first)

The `JourneyAdvanceConsumer` advances only `{HRS,PKL,RWD,CRS,CTL}`. **ANN is
excluded on purpose** — so ANN correctness depends entirely on the charge-DONE
fan-out, and CRS correctness depends on the quality gate + For-CTL branch. Verify
these before building anything else; a miss here silently strands coils.

### A1. ANN charge-DONE fan-out (Requirement 7.4)

**Where to look:** the ANN charge service behind `POST /stations/ann/charges`
status transition *(as implemented — likely `ProcessStationService` or an
`AnnChargeService`)*.

**Confirm ALL of:**
- [ ] When a charge transitions to `DONE`, the handler **iterates the charge's
      coil roster** and calls `ProcessRouteService.advanceJourneyByCoil(coilNo, payload)`
      once per rostered coil.
- [ ] Advance is **idempotent** per coil (a charge re-saved at DONE does not
      re-enqueue) — mirror the consumer's "skip if current step COMPLETED" guard.
- [ ] `charge_wt_mt` and `no_of_coils` are **derived from the roster**, not read
      from the request body (Requirement 7.5).
- [ ] The transition is guarded so only `RW → DONE` (or the allowed predecessor)
      can reach DONE — no skipping states.

**Add a guard comment** where ANN is excluded in `JourneyAdvanceConsumer`
*(confirm file)* so nobody "fixes" it later:
```ts
// ANN is intentionally NOT advanced here. Annealing is charge-based (Archetype B):
// coils advance on charge DONE fan-out in the charge service, not per-coil from
// production.captured. Adding 'ANN' here would advance coils prematurely / double.
const ADVANCE_PROCESSES = new Set(['HRS', 'PKL', 'RWD', 'CRS', 'CTL']);
```

**If the fan-out is missing:** add it to the DONE branch:
```ts
// on transition to DONE, inside the same service:
const roster = await getChargeRoster(chargeId);           // coil_no[]
for (const coilNo of roster) {
  try {
    await ProcessRouteService.advanceJourneyByCoil(coilNo, {
      processCode: 'ANN', shiftLogId, entryId: String(chargeId),
    });
  } catch (err) {
    logger.error({ err, coilNo, chargeId }, 'ANN fan-out advance failed');
    // never throw — one bad coil must not block the rest or the transition
  }
}
```

### A2. CRS quality gate + For-CTL routing (Requirements 8.2, 8.3 / properties P6, P7)

**Where to look:** `ProductionService.saveCrs` and/or the consumer's CRS branch.

**Confirm ALL of:**
- [ ] Mandatory quality fields (hardness, UTS, elongation, Ra/Rz, camber) are
      validated against grade spec via the `shared-validation` rule runner.
- [ ] **Fail ⇒ set `CoilStatus.HOLD` and DO NOT advance** the journey.
- [ ] **Pass ⇒ advance**, with next step `LE` (CTL) when `for_ctl_mt > 0`, else
      `PKG` (packaging).
- [ ] Child-coil spawn for CRS slits uses `"<motherCoilNo>-<slotLabel>"` (same as
      HRS) — Requirement 8.4.

**Reference routing shape:**
```ts
if (!qualityPass) {
  await setCoilStatus(coilNo, CoilStatus.HOLD);
  return; // no advance — MACHINE_HEAD review
}
const nextRoute = entry.forCtlMt > 0 ? 'LE' : 'PKG';
await ProcessRouteService.advanceJourneyByCoil(coilNo, { processCode: 'CRS', nextRoute, shiftLogId, entryId });
```
*(If `advanceJourneyByCoil` derives next-step purely from `route_raw`, ensure the
coil's `route_raw` encodes the For-CTL decision, or pass an explicit override.)*

### A3. Smoke-verify manually
- [ ] Roster 2 coils into an ANN charge → DONE → both appear in the skin-pass queue.
- [ ] CRS a coil with a failing hardness → coil goes HOLD, not in CTL queue.
- [ ] CRS a coil with `for_ctl_mt > 0` → appears in CTL queue; `= 0` → does not.

_Covers: Requirements 7.4, 7.5, 8.2, 8.3, 8.4_

---

## Workstream B — Wire shared sub-forms into CaptureWorkspace (task 11.2)

Operators cannot log stoppages, defects, or crew until these are wired.

**Target:** `packages/client/src/components/process/CaptureWorkspace.tsx`
*(as implemented — confirm)*.

**Reuse (do not rebuild):**
| Sub-form | Component | Endpoint |
| --- | --- | --- |
| Crew | `components/forms/CrewSubForm.tsx` | `/crew` (`routes/crewRoutes.ts`) |
| Stoppage | `components/sixHi/OrderStoppagePanel.tsx` + `StoppageCodeSelect.tsx` | `/stoppages` (`routes/stoppageRoutes.ts`) |
| Defect | `components/sixHi/DefectTagSelector.tsx` | `/defects` (`routes/defectRoutes.ts`) |

**Steps:**
- [ ] B1. Render the three panels (drawer/modal from the action rail's Stop /
      Defect / crew actions) inside `CaptureWorkspace`, bound to the active
      `shiftLogId` + `coilNo`.
- [ ] B2. Feed each panel the **per-process code list** seeded by migration
      `1932000000000_process_subform_codes.js` (fetch via the existing master-code
      endpoints; mirror `sixHiRoutes` `GET /master/stoppage-categories`,
      `GET /master/defect-codes`).
- [ ] B3. Submit through the **offline outbox** (`operator/sync/submitOrQueue.ts`),
      not direct fetch — same as capture.
- [ ] B4. Stoppage start/stop must drive the red live timer already in
      `ProcessLayout` (reuse `hooks/useLiveTimer.ts`); confirm start-then-stop
      writes one stoppage row with from/to/total.
- [ ] B5. Map each process's crew roles onto the `CrewRole` enum per design §11
      (ANN: Operator/Engineer + Shift Incharge; PKL: Helper 1/2/3; CTL: Asstt.
      Operator; HRS: Crew 1/2/3).

**Verify:** on any station, log a stoppage + a defect + crew → all three appear in
the shift review and in `PlantStoppages`/`PlantDefects`.

_Covers: Requirements 11.1, 11.2, 11.3_

---

## Workstream C — Backbone tests (task 1.3, 8.4, 7.4-check, e2e)

Test tooling in this repo: **vitest + fast-check** for server units
(`packages/server/tests/**/*.test.ts`, run `npm run test:unit -w @m1/server`),
**Playwright** for e2e (`e2e/tests/*.spec.ts`, run `npm test -w` in `e2e/`).

### C1. Consumer property tests — `packages/server/tests/journeyAdvanceConsumer.test.ts`
- [ ] **P1 — one commit ⇒ exactly one advance; redelivery ⇒ no double-enqueue.**
      Publish the same `production.captured` envelope twice; assert
      `enqueueNextStep` called once and the step is COMPLETED once.
- [ ] **P2 — handler never rejects the publish chain.** Stub
      `advanceJourneyByCoil` to throw; assert the consumer resolves (does not
      reject) and logs — proving a committed capture can't be 500'd by routing.
```ts
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
// import { JourneyAdvanceConsumer } from '../src/modules/m1-collection/consumers/JourneyAdvanceConsumer';

describe('JourneyAdvanceConsumer', () => {
  it('P1: idempotent advance on redelivery', async () => {
    // arrange spies on ProcessRouteService.advanceJourneyByCoil / enqueueNextStep
    // act: handle(envelope); handle(envelope)  // same key twice
    // assert: advance effected once
  });
  it('P2: never re-throws', async () => {
    // stub advance to reject
    await expect(handle(envelope)).resolves.toBeUndefined();
  });
});
```

### C2. Routing property tests — `packages/server/tests/crsAnnRouting.test.ts`
- [ ] **P6** CRS fail-spec ⇒ HOLD, no advance.
- [ ] **P7** `for_ctl_mt > 0 ⇒ next = LE` else `PKG` (fast-check over amounts).
- [ ] **P8** ANN DONE ⇒ each roster coil advanced exactly once.

### C3. HRS e2e — `e2e/tests/hrs-operator.spec.ts`
- [ ] Login as an HRS operator → Hub shows queue → open a mother coil → add slits
      A/B → submit → assert children `MOTHER-A`, `MOTHER-B` created and each
      appears in the **PKL** queue; mother HRS step COMPLETED.

_Covers: Requirements 3.1, 3.3, 3.4, 5.3, 8.2, 8.3, 7.4_

---

## Workstream D — Feature flags, then retire GenericCapturePage (tasks 12.3, 13.1)

Order matters: ship flags first so a station can fall back if its workspace regresses.

### D1. Per-process feature flags (task 12.3)
- [ ] Reuse the `tenant_module_flags` pattern (migration
      `1901000000000_tenant_module_flags.js`) to add a per-process station flag
      (e.g. `station.hrs`, `station.pkl`, …).
- [ ] In `UserScopeShell`, when a station's flag is **off**, route that machine to
      the legacy `GenericCapturePage`; when **on**, route to `ProcessLayout`.
- [ ] Default new flags **on** in non-prod, **off** in prod until each is signed off.

### D2. Retire the generic page (task 13.1) — only after all six flags are on in prod
- [ ] Remove the HRS/PKL/ANN/RWD/CRS/CTL configs from
      `packages/client/src/pages/capture/ProcessForms.tsx`.
- [ ] Drop the `/capture/:machineCode` route + `GenericCapturePage` import from
      `packages/client/src/App.tsx` (and delete `GenericCapturePage.tsx`,
      `ProcessForms.tsx` if nothing else references them).
- [ ] Grep for lingering references: `rg "GenericCapturePage|/capture/:machineCode"`.

### D3. Full regression (task 13.2)
- [ ] `npm run build -w @m1/server && npm run build -w @m1/client` green.
- [ ] `npm run test:unit -w @m1/server` green.
- [ ] `e2e/` smoke + new HRS spec green.
- [ ] Manually confirm **CRM mills (6HI/4HI/2HI) unchanged** — still render
      `SixHiLayout`, rolling/skin-pass flows intact (Requirement 14).

_Covers: Requirements 12.4, 14.1, 14.3_

---

## Suggested execution order

1. **A** (verify ANN fan-out + CRS gate) — pure correctness, may reveal a stranding bug.
2. **B** (sub-forms) — unblocks real operator use.
3. **C** (tests) — lock the backbone and A/B behaviour.
4. **D** (flags → retire) — staged rollout and cleanup last.

## Still-open questions (unchanged)
OQ-2 (ANN Base No source / single-grade), OQ-3 (PKL chart cadence), OQ-4 (CTL
squareness interval), **OQ-5 (CRS partial For-CTL split — next logic-affecting
one)**, OQ-6 (furnace master).
