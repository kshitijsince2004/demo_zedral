# ZedralV2 / M1 — Full Architecture & Consolidation Audit

**Subject:** Hero Steels M1 Digital Data Collection (`hsl_zedral` monorepo)
**Focus:** shift-log lifecycle, the two shift-handover models, consolidation onto
Model B, and database/code drift.
**Companion:** table-level detail lives in `DB_AUDIT.md`; this report is the
architecture + handover + migration view.

---

## 0. Executive summary

The system is healthy at its core (clean request lifecycle, RLS tenant isolation,
a versioned validation engine, an event/canonical seam), but it is **mid-migration
from a per-form "process" model (Gen-A) to a machine/order-centric model (Gen-B)**,
and the migration was never finished. The evidence of that half-migration shows up
in three places:

1. **Two shift-handover mechanisms** exist side by side.
2. **The database carries two generations of tables** (cold rolling, stoppages,
   crew, history, skin pass, handover — each modeled twice).
3. **Dead/phantom artifacts** remain (an orphaned service against non-existent
   tables, stale generated types, half-wired features).

**Key finding that de-risks consolidation:** the **client UI has already fully moved
to Model B.** There is *no* client call to the Model A endpoint
(`POST /shift-logs/:id/handover`); every handover screen calls `/machines/handover/*`.
Model A is effectively legacy server code with no live caller. Consolidating onto
Model B is therefore mostly a *server-side cleanup* plus *hardening Model B* with the
safety features that historically lived in Model A — not a risky feature rebuild.

**Recommendation:** standardize on Model B; before deleting Model A, port the safety
behaviors into Model B — **three** after the badge+PIN drop decision (validation gate, event
publishing, open-work carry-forward) — and repoint the two handover *report* endpoints.
`CONSOLIDATION_PLAN.md` is the authoritative list.

---

## 1. Architecture baseline (context)

**Request lifecycle** (`app.ts`): every request passes
`contextMiddleware` (resolve tenant from `X-Tenant-Id`, open `AsyncLocalStorage`
context, correlation id) → `tenantScopeMiddleware` (default-deny if no tenant) →
`requireModule('M1', …)` (per-tenant feature flag) → `idempotencyMiddleware`
(replay by `X-Idempotency-Key` for offline retries) → `requireAuth` (JWT → `req.user`
with roles + line scopes).

**Security model — two layers:**
- **DB Row-Level Security** (`RlsDriver` in `db.ts`) sets `app.tenant_id` / `app.user_id`
  per connection; migrations enforce a `tenant_isolation` policy on ~40 tables under a
  non-superuser `m1_app` role. GUC values are regex-sanitized.
- **Application line-scoping** (`lineAccessPolicy.ts`): rank-based
  READ/WRITE/APPROVE checks per process line.

> **Observation (not a blocker):** DB RLS enforces *tenant* isolation, not *line*
> isolation. The "an operator cannot read another line's rows" guarantee is enforced
> in application code, not by a DB policy. Worth documenting so it isn't assumed to be
> DB-level.

**Shift-log state machine** (`ShiftLogService`): `DRAFT → SUBMITTED → APPROVED`, plus
`REOPENED`. `create` is idempotent on `(process, date, shift, mill)`. `submit`
runs the validation gate, snapshots `ruleset_version`, recomputes `total_prod_mt`,
and publishes `shift.closed`. `prod_date` is a **plant date** (night-shift C rolls the
date back), so data never scatters across calendar days.

**Validation engine** (`@m1/shared-validation`): per-process Zod schemas + a
configurable, **versioned** rule layer. Overrides can clear `WARN`s only (never
`BLOCK`), only for SUPERVISOR/ADMIN, only with a written reason, and are audited.

---

## 2. The two shift-handover models

### 2.1 Model A — Shift-Log handover (Gen-A, legacy)

Synchronous, form-centric, single call. State lives on the `txn.shift_log` row via
attestation columns added in `handover_attestation` migration:
`handover_notes`, `handover_outgoing_user_id`, `handover_incoming_user_id`,
`handover_at`; the incoming shift links back via `prev_shift_log_id`.

**Flow** (`ShiftLogService.handover`, one transaction):
1. Timing guard `canCompleteOutgoingHandover` (can't close early unless clock rolled).
2. `assertValid` — outgoing shift must pass validation (or valid overrides).
3. Compute next `(shift, date)` via `nextPlantShift` (A→B→C→A+1d).
4. Close outgoing → `SUBMITTED` + attestation + `ruleset_version` + `total_prod_mt`.
5. Create incoming → `DRAFT`, `prev_shift_log_id = outgoing`.
6. Carry forward open stoppages (`time_to IS NULL`) and open coils to the new log.
7. Publish `shift.closed` → `production.counted` → canonical write-back.

**Attestation:** incoming operator authenticates with **badge + PIN**
(`validateBadgePin`) at the moment of handover.

**Endpoint:** `POST /shift-logs/:id/handover` (in `shiftLogRoutes.ts`).
**Live client callers:** **none found.** (`ShiftHandoverService` is a `@deprecated`
thin delegate; there is no `/handovers` route and no `shiftHandoverRoutes.ts`.)

### 2.2 Model B — Machine handover (Gen-B, current)

Asynchronous, machine-session-centric, two-phase. The live unit is a
`txn.machine_shift_session` (one operator logged into one machine). The handover is a
durable object with its own state machine.

**Tables** (`machine_centric_shift` migration):
- `txn.machine_shift_session` — `status ∈ {ACTIVE, PENDING_ACCEPTANCE, CLOSED}`,
  guarded by partial unique index `ux_machine_shift_session_one_active
  ON (machine_code) WHERE status='ACTIVE'` → **one active session per machine,
  enforced by Postgres.**
- `txn.machine_handover` — `status ∈ {PENDING, ACCEPTED, CLARIFICATION_REQUESTED,
  CANCELLED}`, with rich JSONB snapshots (`production_snapshot`, `queue_snapshot`,
  `open_stoppages`).
- `txn.shift_event_audit` — append-only event log.

**Flow:**
1. Login → `POST /:machineCode/session` (`ensureActiveSession`): resume own session,
   else block on `ACTIVE_SESSION_CONFLICT` if another operator holds it, else open one.
2. Optional `POST /:machineCode/draft` (repeatable).
3. `POST /:machineCode/outgoing` (`createOutgoingHandover`): guards (remarks ≥ 20 chars,
   no existing PENDING, timing check), build full snapshot, insert `machine_handover`
   as `PENDING`, close the outgoing session, audit `HANDOVER_CREATED`, finalize the
   6HI shift summary.
4. Incoming operator `POST /accept/:handoverId` (`acceptHandover`): set `ACCEPTED`,
   close lingering sessions, open a fresh `ACTIVE` session, audit `HANDOVER_ACCEPTED`
   — **or** `POST /clarification/:handoverId` to bounce it back.

**Production lock:** while a handover is `PENDING`, `assertProductionAllowed` blocks
production mutation on that machine unless the caller already accepted.

**Endpoints:** `/machines/handover/*` (mounted in `app.ts`).
**Live client callers:** `HandoverAcceptPage`, `CrmOutgoingHandoverPage`,
`HandoverAcceptGate`, `HandoverOverviewPanel`, `handoverQueue`,
`machineHandoverService` — **all of them.**

### 2.3 Side-by-side

| | Model A (shift-log) | Model B (machine) |
| --- | --- | --- |
| Live unit | `shift_log` (DRAFT) | `machine_shift_session` (ACTIVE) |
| Record | attestation columns on the log | dedicated `machine_handover` row |
| Shape | synchronous, one call | asynchronous, two-phase |
| Completed by | outgoing op, with incoming **badge+PIN** | incoming op, on own login |
| States | none intermediate | DRAFT→PENDING→ACCEPTED / CLARIFICATION |
| Snapshot | notes + carried-forward rows | full JSONB (production/queue/stoppages/crew) |
| Concurrency guard | shift-log state check | DB partial unique index + PENDING lock |
| Validation gate | **yes** (`assertValid`) | no |
| Domain events | **yes** (`shift.closed` + canonical) | no |
| Client usage | **none (dead)** | **all handover UI** |

---

## 3. Consolidating onto Model B — impact analysis

Because the client already uses Model B exclusively, the risk is far lower than a
raw "delete a feature" would imply. What remains are **capabilities that lived only in
Model A** and must be preserved in Model B, plus **two report endpoints** to repoint.

### 3.1 Must-port into Model B before deleting Model A

| # | Capability (Model A only) | Where to add in Model B | Severity |
| --- | --- | --- | --- |
| 1 | **Domain events** `shift.closed` → `production.counted` → canonical write-back | `createOutgoingHandover` (after commit) | **High** — downstream/canonical seam goes dark on close. *Mitigation: `submit()` also fires `shift.closed`, so events still fire if shifts are submitted separately.* |
| 2 | **Validation gate** (`assertValid`) before close | `createOutgoingHandover` (before insert) | **High** — otherwise an invalid shift can be handed over. |
| ~~3~~ | ~~Badge + PIN attestation~~ — **DROPPED (decision)** | — | Not porting. Keep own-login accept (Model B's current behavior). See `CONSOLIDATION_PLAN.md` §1.3. |
| 4 | **Carry-forward of open stoppages/coils** for non-6HI process tables | `acceptHandover` (generic re-parent) | **Medium** — only if form lines will use B; 6HI handles this via order attribution. |

> **Note:** this table originally listed four behaviors; badge+PIN (row 3) was **dropped by
> decision**, so **three** carry over (events, validation gate, carry-forward). This is unrelated
> to the `verifySupervisorOverridePin` override-PIN mechanism, which is a different feature that stays.

### 3.2 Repoint (not rebuild)

- `GET /reports/handover` and `GET /shift-logs/:id/handover/summary` call
  `getHandoverSummary`, which reads `shift_log.handover_*` + `prev_shift_log_id`.
  Repoint these to read `machine_handover` (the PlantHead dashboard consumes them).

### 3.3 Prerequisite decision

Model B is keyed on `machine_code`. Either **(a)** give each of the nine non-6HI lines
a `master.machine` identity (the migrations already lean this way; `createOutgoingHandover`
falls back to `process_code = machineCode`), or **(b)** anchor Model B on `shift_log`
(the session already carries a `shift_log_id` FK). Pick one before generalizing.

### 3.4 Safe to delete once 3.1–3.3 are done

- Server: `ShiftLogService.handover`, `HandoverContext`/`HandoverSummary` handover
  branch, `POST /shift-logs/:id/handover` route, `ShiftHandoverService.ts` (deprecated
  delegate).
- DB (later, non-urgent): retire the `shift_log.handover_*` columns + `prev_shift_log_id`
  once reports read `machine_handover`.
- Client: nothing to delete — it never used Model A.

### 3.5 Not affected (safe)

`shift_log` itself and the DRAFT→SUBMITTED→APPROVED lifecycle; 6HI/machine lines
(already B); machine crew (`machine_crew_roster`).

---

## 4. Database drift (summary — full detail in `DB_AUDIT.md`)

**Phantom (code → missing table):** `txn.coils`, `txn.coil_process_history` (orphaned
`CoilTraceabilityService`, imported by nobody → delete the service); `txn.crm`
(migration residue).

**Stale types:** `db-types.ts` aliases non-existent `txn.skp_pass` → regenerate.

**Dead (DB → no code), 11 tables:** `audit.change_request` (correction workflow
unwired — biggest functional gap), `coil.coil_process_history` (superseded by
`order_journey_step`), `txn.prod_glv` (GLV never captured), `canon.cost_rate`,
`canon.personnel`, `security.tenant` (FK — verify), and master ref tables
`furnace` / `rp_oil_grade` / `surface_finish` / `crm_sub_process` / `line_area`
(likely FK/seed — verify, don't blind-drop).

**Duplicate clusters (the Gen-A / Gen-B split):**

| Concept | Gen-A | Gen-B |
| --- | --- | --- |
| Cold rolling | `txn.prod_crm` | `txn.crm6_order` + `crm6_rolling` + `crm6_rolling_pass` + `crm6_skinpass` + `crm6_shift_summary` |
| Stoppages | `txn.stoppage_entry` | `txn.order_stoppage` |
| Crew | `txn.crew_entry` | `master.machine_crew_roster` |
| History | `coil.coil_process_history` (dead) | `planning.order_journey_step` (live) |
| Skin pass | `txn.prod_skp` / `prod_skp_pass` | `txn.crm6_skinpass` |
| Handover | `shift_log.handover_*` | `machine_handover` |

---

## 5. Consolidated migration plan

**Phase 0 — free wins (no behavior change)**
- Delete `CoilTraceabilityService.ts`; regenerate `db-types.ts`; drop `txn.crm` after zero-row check.

**Phase 1 — harden Model B (Section 3.1)**
- Port event publishing, validation gate, and carry-forward into `MachineHandoverService`. (Badge+PIN **dropped** by decision — not ported.)
- Repoint the two handover report endpoints to `machine_handover`.

**Phase 2 — retire Model A (Section 3.4)**
- Delete `ShiftLogService.handover`, its route, and `ShiftHandoverService.ts`.
- Schedule removal of `shift_log.handover_*` + `prev_shift_log_id` columns.

**Phase 3 — decide half-wired features**
- `audit.change_request`: wire the correction workflow or drop.
- `txn.prod_glv`: implement GLV capture or remove.

**Phase 4 — collapse duplicate clusters (one at a time, with backfill)**
- Stoppages → one table; crew → one source; history → `order_journey_step`;
  cold rolling → decide `prod_crm` vs `crm6_*` end-state.

**Every drop** gated by the `information_schema` / `pg_constraint` checks in
`DB_AUDIT.md` §6 (inbound FKs + row counts) against a production-like DB.

---

## 6. Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Dropping an FK/seed master table breaks inserts | Medium | Run §6 FK checks before every drop. |
| Model B close stops emitting `shift.closed` | High if not ported | Port event publishing in Phase 1; `submit()` is a partial safety net. |
| Non-6HI lines have no machine identity | Medium | Resolve Section 3.3 decision before generalizing B. |
| Handover reports read empty data | Medium | Repoint to `machine_handover` in Phase 1. |
| Correction workflow assumed to work but is unwired | High | Phase 3 decision; communicate current state to stakeholders. |

---

*Prepared from a full read of `packages/server` (routes, services, middleware,
migrations, `db.ts`, `db-types.ts`), `packages/shared-validation`, `packages/platform`,
and `packages/client` handover surfaces. Approximate counts are flagged; confirm each
specific table with the queries in `DB_AUDIT.md` before acting.*
