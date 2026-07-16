# ZedralV2 / M1 — Consolidation & Cleanup Plan

**Goal:** standardize the system on the machine/order model (Gen-B), retire the legacy
per-form duplicates (Gen-A), remove dead/phantom artifacts, and resolve half-wired
features — as one coordinated, full-consolidation program.

**Audience:** IDE / coding agent + reviewers. Each task lists the files to touch, the
change, how to verify, and how to roll back.

**Companion docs:** `ZEDRAL_FULL_AUDIT.md` (findings + rationale), `DB_AUDIT.md`
(table verdicts + pre-drop SQL), `SUPERVISOR_REMOVAL_SPEC.md` (role refactor). Paths below are
relative to the repo root unless noted; server code lives under `packages/server/src`.

**Sequencing with the role refactor:** `SUPERVISOR_REMOVAL_SPEC.md` should be executed **before**
this plan's Phase 1/3. It shares `routes/shiftLogRoutes.ts`, `routes/reportRoutes.ts`, and
`services/ReportingService.ts` with this plan, and it establishes the 4-role model those phases
assume. Do the supervisor removal, get it green, then start Phase 0 here.

---

## 0. Guardrails (apply to every task)

1. **One logical change per commit/PR.** Never mix a code refactor with a destructive migration.
2. **Every migration is reversible** (`exports.down` implemented and tested).
3. **Every table/column drop is gated** by the FK + row-count checks in `DB_AUDIT.md` §6, run against a production-like DB.
4. **`shift_log` stays the universal anchor.** Do not remove it; Gen-B sessions FK to it.
5. **Regenerate `db-types.ts`** (`kysely-codegen`) after any schema change; commit the regen separately.
6. **Green gates before merge:** `npm run build`, `npm test`, `npm run arch:check`, and the relevant smoke (`npm run smoke:api`).
7. **Expand → migrate → contract** for any table merge: add new, dual-write/backfill, cut reads over, then drop old in a later release.
8. **Feature-flag risky cutovers** where possible (e.g. `VALIDATION_STRICT` already exists as a precedent).

---

## 1. Dependency ordering (do phases in this order)

```
Phase 0  Safe deletions & hygiene        (no behavior change)   ── independent
Phase 1  Harden Model B (superset of A)  ── must precede Phase 3
Phase 2  Generalize Model B beyond 6HI   ── must precede Phase 3 (for non-6HI lines)
Phase 3  Repoint reports + retire Model A ── depends on 1 & 2
Phase 4  Resolve half-wired features      ── independent (can run parallel)
Phase 5  Collapse duplicate clusters      ── depends on 1–3 for handover; others independent
Phase 6  Prune canonical/master leftovers ── last; pure DB, FK-gated
```

---

## 2. Phase 0 — Safe deletions & hygiene *(reversible, no behavior change)*

| # | Task | Files | Verify | Rollback |
| --- | --- | --- | --- | --- |
| 0.1 | Delete orphaned `CoilTraceabilityService` (references phantom `txn.coils`, `txn.coil_process_history`; zero importers). | delete `services/CoilTraceabilityService.ts` | `grep -r CoilTraceabilityService src` → no hits; build passes | restore file |
| 0.2 | Regenerate DB types (drops non-existent `txn.skp_pass` alias, `txn.crm`). | `db-types.ts` (+ `db/types.ts` if hand-kept) | diff shows only removals; build passes | revert regen |
| 0.3 | Migration: drop `txn.crm` (crm6-redesign residue) after zero-row check. | new `migrations/19xx_drop_txn_crm.js` | `SELECT to_regclass('txn.crm')` null after up; `count(*)=0` precheck in migration | `down` recreates empty table |

**Exit criteria:** build + all tests green; no code references any deleted symbol/table.

---

## 3. Phase 1 — Harden Model B into a superset of Model A *(prerequisite for retiring A)*

Model B (`services/MachineHandoverService.ts`) currently lacks behaviors that only
live in Model A (`services/shiftLogService.ts::handover`). Port each before deleting A.
**Decision:** badge+PIN at accept (1.3) is **dropped** — so only three behaviors carry over
(validation gate, events, carry-forward).

| # | Task | Where | Detail |
| --- | --- | --- | --- |
| 1.1 | **Validation gate** before close | `MachineHandoverService.createOutgoingHandover` (~L489) | Resolve the session's `shift_log_id`, call `ShiftLogValidationService.assertValid(shiftLogId, { user })` before inserting the PENDING row; surface `ShiftLogValidationGateError` as 400. |
| 1.2 | **Domain events** on close | same method, after commit | Call `publishShiftClosed({ shiftLogId, processId, totalProdMt })` from `platform/m1Events.ts` so `shift.closed` → `production.counted` → canonical write-back fire (Model B currently fires none). |
| 1.3 | ~~Badge+PIN attestation~~ — **DROPPED (decision)** | — | Decided **not** to require badge+PIN at accept. Keep own-login accept — this is Model B's current behavior, so no change. Revisit only if terminals become shared kiosks (then add a configurable PIN-only confirm). |
| 1.4 | **Generic open-work carry-forward** | `acceptHandover` (inside txn) | Re-parent open `stoppage_entry` (`time_to IS NULL`) and open process rows to the incoming `shift_log_id`, mirroring `shiftLogService.handover` steps 3–4, for the resolved process table. |

**Tests (add under `packages/server/tests`):** invalid shift blocked at outgoing; `shift.closed` observed on the bus after outgoing; open stoppage/coil moves to the incoming shift.

**Exit criteria:** Model B produces the same audit/event/validation outcomes as Model A did.

---

## 4. Phase 2 — Generalize Model B beyond 6HI *(prerequisite for all lines)*

Model B is coupled to 6HI (`txn.crm6_order`, `SixHiService`, `SixHiShiftService`). Make it
line-agnostic.

| # | Task | Where | Detail |
| --- | --- | --- | --- |
| 2.1 | **Order-source abstraction** | new `services/handover/OrderSource.ts` (interface) + per-line impls | Replace direct `crm6_order` lookups in `createOutgoingHandover`/`buildOutgoingPreview` with `resolveActiveWorkUnit(machineCode)`. 6HI impl → `crm6_order`; other lines → `planning.order_journey`/`order_journey_step` or the coil/shift_log entries. |
| 2.2 | **Machine identity for every line** | seed migration + `master.machine` | Ensure each of the 9 processes maps to a `master.machine` row, or make `machine_code` fall back to the process/line code (the code already sets `process_code = machineCode` in places). |
| 2.3 | **Generalize shift-summary/snapshot** | `buildOutgoingPreview`, `saveShiftSummary` | Extract the 6HI-specific summary into a per-process strategy so the snapshot builds for any line. |

**Tests:** a non-6HI line (e.g. PKL) can create → accept a handover end-to-end.

**Exit criteria:** handover works for at least one non-6HI line in tests.

---

## 5. Phase 3 — Repoint reports & retire Model A *(depends on Phases 1–2)*

| # | Task | Files | Detail |
| --- | --- | --- | --- |
| 3.1 | **Repoint handover reports** to `machine_handover` | `services/shiftLogService.ts::getHandoverSummary`, `routes/reportRoutes.ts` (`GET /handover` ~L167), `routes/shiftLogRoutes.ts` (`GET /:id/handover/summary`), `services/ReportingService.ts` | Read handover data from `txn.machine_handover` instead of `shift_log.handover_*` + `prev_shift_log_id`. Confirm PlantHead dashboard still renders. |
| 3.2 | **Delete Model A code** | remove `ShiftLogService.handover` + `HandoverContext`; delete `POST /shift-logs/:id/handover` in `routes/shiftLogRoutes.ts` (~L342); delete `services/ShiftHandoverService.ts` (deprecated delegate) | Client already never calls these — no client change needed. |
| 3.3 | **Migration: drop legacy columns** | new `migrations/19xx_drop_shiftlog_handover_cols.js` | Drop `shift_log.handover_notes/handover_outgoing_user_id/handover_incoming_user_id/handover_at` and `prev_shift_log_id` — **only after 3.1 is verified in prod**. Keep as a separate, later release. |

**Exit criteria:** `grep -r "\.handover\b\|ShiftHandoverService\|handover_notes" src` returns only Model B; reports return data.

---

## 6. Phase 4 — Resolve half-wired features *(independent; can run in parallel)*

### 6.1 `audit.change_request` — the correction workflow
Two branches, pick one:
- **Wire it:** implement `ChangeRequestService` + routes (`/change-requests`), tie into the
  post-lock edit path and audit (`app.change_request_id` GUC already exists in `RlsDriver`).
- **Drop it:** migration to drop `audit.change_request`; remove the GUC plumbing and doc references.

### 6.2 `txn.prod_glv` — GLV capture
- **Wire it:** add `ProductionService.saveGlv` + `POST /production/glv`, use existing `glvSchema`/`mapGlvEntry`.
- **Drop it:** remove `prod_glv` from `audit/auditedTables.ts`, the process-id map in `shiftLogService.ts` (id 9) and `ReportingService.ts`; migration to drop the table.

**Decision needed from stakeholders** on each; plan both branches so execution is unblocked.

---

## 7. Phase 5 — Collapse duplicate clusters *(expand → migrate → contract each)*

Do these **one cluster at a time**, each as its own multi-release sequence.

| # | Cluster | Keep (Gen-B) | Retire (Gen-A) | Migration notes |
| --- | --- | --- | --- | --- |
| 5.1 | Stoppages | `txn.order_stoppage` (or a unified `stoppage`) | `txn.stoppage_entry` | Backfill A→B; dual-write during transition; cut reads (`StoppageService`, reports, exports); drop A. |
| 5.2 | Crew | `master.machine_crew_roster` | `txn.crew_entry` | Map per-shift crew onto roster+session; update `CrewService`. |
| 5.3 | Process history | `planning.order_journey_step` | `coil.coil_process_history` | Confirm journey covers all lineage; repoint traceability; drop A. |
| 5.4 | Cold rolling | decide `crm6_*` vs `prod_crm` end-state | the other | Biggest one — pick target, migrate CRM capture path, deprecate loser. Depends on Phase 2. |
| 5.5 | Skin pass | (fold into chosen CRM model) | `prod_skp`/`prod_skp_pass` or `crm6_skinpass` | Follow 5.4's decision. |

**Per-cluster exit criteria:** reads/writes go to one table; old table has 0 new writes for a full release; then drop.

---

## 8. Phase 6 — Prune canonical/master leftovers *(last; pure DB, FK-gated)*

| # | Table | Action | Gate |
| --- | --- | --- | --- |
| 6.1 | `canon.cost_rate`, `canon.personnel` | Drop if canonical costing/personnel not on roadmap | confirm no roadmap need |
| 6.2 | `master.furnace`, `rp_oil_grade`, `surface_finish`, `line_area`, `crm_sub_process` | Verify inbound FKs; keep if referenced, else drop | `DB_AUDIT.md` §6.1 per table |
| 6.3 | `security.tenant`, `security.permission` | Drop if unused after FK check | §6.1 (tenant likely FK — probably keep) |

---

## 9. Test & verification strategy

- **Unit/property:** Vitest + `fast-check` for validation and handover state transitions.
- **Integration:** `supertest` against routes — handover create/accept/clarify, event emission, RLS scoping.
- **Architecture:** `npm run arch:check` (dependency-cruiser + arch tests) to catch layering regressions.
- **Smoke:** `npm run smoke:api` / `smoke:pilot` after each phase.
- **Migration round-trip:** apply `up` then `down` in CI on a scratch DB for every new migration.
- **DB drift:** re-run the code-vs-DB diff (the audit method) after Phase 5 to confirm no new orphans.

---

## 10. Rollback posture

- Phases 0–4 are code + additive/guarded migrations → revert commit / run `down`.
- Phase 3.3 and Phase 5 drops are the only hard-to-reverse steps → ship them a release *after*
  their read-repoint lands, behind the FK/row-count gates, with a verified `down`.
- Keep a tagged pre-consolidation baseline for fast full revert.

---

## 11. Suggested commit/PR sequence (small, reviewable)

1. `chore: remove orphaned CoilTraceabilityService` (0.1)
2. `chore: regenerate db-types; drop txn.crm` (0.2, 0.3)
3. `feat(handover): validation gate + events in Model B` (1.1, 1.2)
4. `feat(handover): carry-forward of open work on accept` (1.4)
5. `refactor(handover): order-source abstraction (de-6HI)` (2.1–2.3)
6. `refactor(reports): read handover from machine_handover` (3.1)
7. `chore(handover): delete Model A code + route` (3.2)
8. `feat|chore(glv/change_request): wire or drop` (4.x)
9. `refactor(stoppages|crew|history|crm): cluster N expand→migrate→contract` (5.x, one each)
10. `chore(db): drop legacy handover cols` (3.3) — after 6 verified in prod
11. `chore(db): prune canon/master leftovers` (6.x)

---

*Every destructive step is gated on the `DB_AUDIT.md` §6 checks. Nothing in Phases 3.3, 5, or 6
should be executed until its read-side repoint is proven in a production-like environment.*
