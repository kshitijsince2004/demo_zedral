# Zedral M1–M4 — Plan-Conformance Correction Brief (for Dev Team)

**Date:** 2026-06-26
**Prepared by:** Z Company
**Inputs:** `zedral_m1_m4_audit_report.md` (code audit of `zedral_m3`) cross-checked against the approved plans & tech docs in `Zedral_v1/` (M1 Technical Blueprint M1-00→09 + `M1_schema.sql`; M2/M3/M4 Deep Plans, Dev-Handover specs, and `M{2,3,4}_schema.sql`).
**Purpose:** Tell the dev team exactly where the build diverges from the ratified plan, what is a **real defect** vs a **plan-compliant stub** (do NOT "fix"), and the corrective action per item.

> **How to read this:** The original audit lists 25 issues. This brief re-scopes them against the *plan*. Roughly a third of the audit's "High/Critical" items are things the specs explicitly told us to ship as v1 stubs — those are flagged **PLAN-COMPLIANT — DO NOT CHANGE** so we don't waste a sprint. The genuine plan-violations are concentrated in M4 and M3 and are listed first.

---

## 0. Severity & status legend

| Tag | Meaning |
|---|---|
| 🔴 **DEFECT** | Contradicts a plan MUST / schema; produces wrong output or breaks a cross-module contract. Fix before M5. |
| 🟠 **GAP** | Planned scope not delivered (not wrong, but incomplete vs spec). Schedule. |
| 🟡 **DIVERGENCE** | Conscious departure from the plan's architecture; acceptable only if we formally downgrade the related acceptance gate. |
| 🟢 **PLAN-COMPLIANT — DO NOT CHANGE** | Audit flagged it, but the spec *requires* this v1 behaviour. Remove from remediation list. |
| ⚪ **VERIFY** | Cannot confirm without the repo; dev to confirm against the named acceptance criterion. |

---

## 1. Priority 1 — Must fix before M5 (data-integrity & cross-module breaks)

These each break a specific MUST acceptance criterion. The M4 items are the most serious because the code **bypasses tables the schema already defines** — i.e. regressions, not missing work.

### 1.1 🔴 M4 — Quality factor hardcoded at 95%
- **Code:** `OeeCalcService.ts` L183 — `goodCount = Math.floor(totalCount * 0.95)`.
- **Plan it violates:** M4-02 §1 (`Quality = Good Count ÷ Total Count`), M4-03 §3 (good/scrap sourced from M1 `prod_*` → `ProductionCount`), acceptance **C-01** & **K-01**.
- **Why it matters:** Eliminates the Q factor; OEE = A×P×Q is structurally wrong and can never match the ISO 22400 worked example to 4 dp.
- **Schema already supports the fix:** `oee.oee_interval.good_count` / `total_count` exist with `CHECK (good_count <= total_count)`.
- **Correct action:** Read actual good/scrap counts from the M1 canonical `ProductionCount` rows for the (work_unit × bucket); populate `good_count`/`total_count` from real data. Remove the constant.

### 1.2 🔴 M4 — Ideal cycle time hardcoded at 60s
- **Code:** `OeeCalcService.ts` L193 — `idealCycleTimeSec: 60`.
- **Plan it violates:** M4-02 §4 (calls ideal-cycle the "make-or-break" denominator — keyed material × work-unit, versioned, `is_calibrated`), acceptance **C-04** + the Fidelity gate.
- **Schema already supports the fix:** `oee.ideal_cycle` exists (`source ∈ {NAMEPLATE, DEMONSTRATED_BEST, M3_PLAN_TARGET, MANUAL}`, `is_calibrated`, effective-dated).
- **Correct action:** Look up `oee.ideal_cycle` per material × work-unit (effective-dated). Where `is_calibrated = false`, mark the dependent OEE as **indicative** and raise the Fidelity gate — never present it as a confident number.

### 1.3 🔴 M4 — ReconciliationService compares a value to itself
- **Code:** `ReconciliationService.ts` L20–21 — `m1UnplannedMin` and `m4UnplannedMin` both read `interval.unplanned_downtime_min` (same row) → variance always 0.
- **Plan it violates:** M4-06 §4 / **K-04**, M4-01 **M-05**, M4-05 **P-03** (`Σ M4 unplanned-min = Σ M2 breakdown-min` on the shared `downtime_event_ref`; `total_count = Σ M3 ProductionCount`).
- **Correct action:** Query the M1/M2 canonical downtime separately (via the shared `downtime_event_ref` → `canon.event`) and compare against M4's computed figures. Wire it as the nightly job; raise the drift alert when seeded.

### 1.4 🔴 M4 — Event-name mismatch + orphaned pipeline subscription
- **Code:** `register.ts` L13 declares `canon.state.changed`; `M4ModuleEventBus.ts` L9 subscribes to `canon.state_event`; `OeePipelineOrchestrator.ts` subscribes to `oee.state.changed`, which nobody publishes.
- **Plan it violates:** M4-03 §2, M4-05 §1, M4-07 §2 (M4 **consumes** `canon.state_event` / `canon.downtime_event` / `canon.production_count`).
- **Why it matters:** The OEE pipeline is not actually fed by M1 state changes → acceptance **S-04** ("non-null OEE from M1 bootstrap") fails end-to-end.
- **Correct action:** Align all three names on the canonical contract (`canon.state_event`). Confirm the M1 bootstrap publishes the event the resolver subscribes to.

### 1.5 🔴 M3 — Inbound event consumers completely disabled
- **Code:** `eventWiring.ts` L11 — `INBOUND_EVENTS` is an empty array; `bus.subscribeInbound` commented out (L28–39).
- **Plan it violates:** M3-07 §4 (inbound constraints: M2 PM windows, M4 live state, M6 quality holds) and M3-03 §7 **MUST** ("treat M2 PM windows and M4 down-state as hard unavailability").
- **Why it matters:** The scheduler is deaf to sibling modules → it cannot honour the finite-capacity-with-unavailability guarantee; M3 is effectively disconnected from the event fabric.
- **Correct action:** Populate `INBOUND_EVENTS` with the spec-07 §4 set and re-enable `subscribeInbound`. Feed PM windows + down-state into the scheduler's unavailability input.

### 1.6 🔴 M3 — MasterDataService returns stub for capacity
- **Code:** `MasterDataService.ts` L123 — returns `{ stub: true }` for capacity queries.
- **Plan it violates:** M3-03 §7 **MUST** ("never exceed `work_center_capacity` in a committed schedule").
- **Schema already supports the fix:** `ops.work_center_capacity` is fully defined (basis, available_minutes/qty, efficiency_pct, effective-dated).
- **Correct action:** Return real rows from `ops.work_center_capacity`; the finite-capacity check (`load_pct = required ÷ (available × efficiency)`) is unverifiable until this is live.

### 1.7 🔴 M3 — PlanningConfigRepository returns stub
- **Code:** `PlanningConfigRepository.ts` L43 — `{ ...payload, updated: true, stub: true }`.
- **Plan it violates:** M3-02 (posture switch) + M3-01 §5 + acceptance **MUST** ("support all three postures without schema change") — and this is **M3-0**, the foundation phase.
- **Why it matters:** `ops.planning_config.posture` is the A/B/C ("posture is data, not a code fork") switch. A stub means posture isn't really persisted, undermining the whole design.
- **Correct action:** Implement real read/write to `ops.planning_config` (posture, `mrp_enabled`, `optimiser_enabled`, `schedule_grain`); audit-log changes.

### 1.8 🔴 Security — No rate limiting on M1 `/auth`
- **Code:** login/refresh at `/auth` have no rate limiter (M4 OEE endpoints do — 100/15min).
- **Plan it violates:** M1-01 §10 Security NFR (least-privilege, hardened access); inconsistent with the rate limiting already applied elsewhere.
- **Correct action:** Add a rate limiter to `/auth` login/refresh (and PIN) routes.

### 1.9 🟠 DevOps — Dockerfile excludes M3/M4 clients, connectors, domain modules
- **Code:** `Dockerfile` L13–14 — builder stage missing `m3-client`, `m4-client`, `connectors`, and the `m{3,4}` domain modules.
- **Plan it violates:** Production-readiness (deployable per plan). M3/M4 cannot ship from the current build.
- **Correct action:** Add all packages to the `COPY`/build instructions; verify a clean multi-stage build produces all four clients + server.

---

## 2. Priority 2 — Planned scope not yet delivered (schedule, not emergencies)

### 2.1 🟠 M1 — Non-CRM process forms are "Coming Soon"
- **Code:** `MachineComingSoon.tsx` — HRS, PKL, CTL, etc. redirect to a placeholder; only 6Hi/CRM is fleshed out.
- **Plan it violates:** M1-02 scopes **10 capture forms across all 8 processes** as in-scope for M1, each with its defining section (HRS slit-combination builder; PKL coil-log + hourly chart; ANN charge/base builder + O₂ gate; SKP pass-wise thickness 1–6; CRS full QC + For-CTL routing; CTL kg→MT + piece count).
- **Note:** The platform kernel, COIL_NO spine, validation, audit, and export **do** match the plan — this is a *breadth* gap, not an architecture gap. (It tempers the audit's 85/100 against M1-02's stated scope.)
- **Correct action:** Build out the remaining process forms against M1-02 §§2–9. Sequence by pilot need (M1-00 names Pickling as a pilot candidate because it exercises both capture styles).

### 2.2 🟠 M3 — MRP engine placeholder date logic
- **Code:** `mrpEngine.ts` L68 — placeholder `startDate`, lead-time offset not applied in recursive parent calls.
- **Plan reference:** M3-02 §3 (MRP run: BOM explosion, netting, lead-time offset) — but this is **Posture C**, build phase **M3-3** (M3-01 §7).
- **Decision needed:** If Hero Steels v1 targets **Posture A/B** (ingest the SAP-PP CSV), MRP is a legitimate phase deferral — finish it when Posture C is scheduled. If Posture C is in v1 scope, this is a defect. **Confirm posture scope with product owner before assigning.**

### 2.3 🟠 M2 — KPI Redis caching is a stub
- **Code:** `KPIService.ts` L159 — `Redis Stub`.
- **Plan reference:** Caching is an NFR/performance optimisation, not a v1 acceptance MUST. Low urgency; implement when the KPI read path needs it.

### 2.4 ⚪ VERIFY — M2 predictive health stub must return *readiness*, not fabricated values
- **Code:** `health.ts` — `Predictive Health Stub` / `Remaining Useful Life Stub` (audit calls it "mock data").
- **Plan reference:** M2-08 §4 + acceptance **F-02**: the stub **MUST** return `readiness:{history_pct}` / `not_available` — **never a fabricated RUL/health value**.
- **Action:** Confirm the stub returns honest readiness, not fake numbers. If it returns fabricated data → 🔴 DEFECT against F-02. If it returns readiness → 🟢 compliant. *(This is the one MUST hiding inside an otherwise plan-compliant stub.)*

---

## 3. PLAN-COMPLIANT — remove from the remediation list (DO NOT "fix")

The audit flagged these as High/Critical, but the specs **require** this exact v1 behaviour. Changing them would violate the plan.

### 3.1 🟢 M3 — Optimiser/scheduler endpoints return 501
- Audit: "Optimiser returns 501 stub / dead endpoints in production."
- **Plan:** M3-08 §5 **MUST** — "gate all optimiser endpoints behind `optimiser_enabled=false` by default (return 501/not-enabled)." `ops.planning_config.optimiser_enabled` defaults `FALSE` in the schema. **This is correct.**

### 3.2 🟢 M4 — Loss-prediction controller returns an empty stub
- Audit: "Loss prediction is a stub / High."
- **Plan:** M4-08 **F-01** — "No v1 code path writes `oee.loss_prediction`." The table is even commented `FUTURE-SCOPE stub` in `M4_schema.sql`. The empty stub **is** the spec.

### 3.3 🟢 M2 — Predictive health / RUL endpoints are stubs
- Audit: "Predictive Health is stub-only / High."
- **Plan:** M2-08 §8 — "Explicit do NOT build in v1." Stub is correct. *(See §2.4 for the one caveat: it must return readiness, not fake values.)*

### 3.4 🟢 M4/M3 — "Future-scope" optimiser/prediction tables exist but are unwritten
- Audit treats unused future tables as incompleteness.
- **Plan:** M3-01 §7 (M3-4 "optimiser tables stay as-is") and M4-08 §5 require these to exist **empty** in v1 so the later build is a switch-on, not a re-model.

---

## 4. Architectural divergences — ratify or schedule (don't silently pass the gate)

These aren't necessarily wrong, but the plan assumes something different. **Either implement to plan, or formally downgrade the related acceptance criterion so it isn't a phantom "pass."**

### 4.1 🟡 In-memory EventEmitter instead of Kafka/Redpanda
- **Plan:** M3-07 §2 and M4-05 §1 assume durable topics with **exactly-once + replay**; M4-05 §1 specifies a **Flink stream + Airflow batch dual path** ("live tile and shift report cannot disagree" — acceptance **P-01**). M4-05 **P-04** and M3-05 require idempotent/replay-safe events.
- **Impact:** Fire-and-forget EventEmitter + in-memory idempotency `Set` (resets on restart) cannot meet the exactly-once/replay MUSTs.
- **Action:** Acceptable for a single-node v1 **only if** we explicitly mark P-01/P-04 as deferred and document the limitation. Otherwise deploy Kafka/Redpanda.

### 4.2 🟡 God-class services drift from the planned service decomposition
- **Code:** `SixHiService.ts` (1,798 lines), `WorkOrderService.ts` (1,071), `LiveService.ts` (37 KB), `ReportingService.ts` (36 KB).
- **Plan:** M1-01 §3.2 specifies focused, separately-deployable services (Capture / Validation / Master-data / Reporting / Export). The monoliths are tech debt that the architecture doc explicitly wanted to avoid; they will slow M5.
- **Action:** Decompose along the M1-01 service boundaries — schedule before/early in M5, not emergency.

### 4.3 🟡 Cross-module reconciliation chain is only as good as M4
- **Plan:** M2-09 and M3-06 §3 both make M2↔M4↔M3 count/downtime reconciliation a **MUST**.
- **Impact:** All three currently fail because M4's reconciliation is the self-compare in §1.3. Fixing §1.3 unblocks the M2 and M3 reconciliation acceptance tests too.

### 4.4 🟡 Type-safety erosion (`as any`) on event payloads & cross-schema reads
- **Code:** `OeePipelineOrchestrator.ts` (`envelope.payload as any`), `OeeCalcService.ts` (`canon.production_count as any`).
- **Plan:** M4-01 §4 (referencing rules) intends typed soft-references to `canon.event`. The casts hide exactly the cross-schema contract the plan is careful about.
- **Action:** Type the canonical event payloads; remove `as any` on the `canon` read path.

---

## 5. Consolidated correction checklist (hand to dev)

| # | Item | Module | Tag | Plan ref | Est. |
|---|---|---|---|---|---|
| 1 | Read real good/total counts; remove 95% constant | M4 | 🔴 | M4-02 C-01, K-01 | 4h |
| 2 | Read `oee.ideal_cycle`; remove 60s constant; honour Fidelity gate | M4 | 🔴 | M4-02 C-04 | 4h |
| 3 | Reconcile against M2/M3 canonical figures (not self) | M4 | 🔴 | M4-06 K-04, M-05 | 8h |
| 4 | Align event names on `canon.state_event`; wire pipeline feed | M4 | 🔴 | M4-05/07 | 8h |
| 5 | Enable M3 inbound consumers (PM windows + down-state) | M3 | 🔴 | M3-07 §4, M3-03 §7 | 16h |
| 6 | Real `work_center_capacity` reads (finite-capacity guarantee) | M3 | 🔴 | M3-03 §7 | 8h |
| 7 | Real `planning_config` persistence (posture switch) | M3 | 🔴 | M3-02, M3-01 §5 | 4h |
| 8 | Rate-limit `/auth` login/refresh/PIN | M1/Sec | 🔴 | M1-01 §10 | 2h |
| 9 | Add M3/M4 clients, connectors, modules to Dockerfile | DevOps | 🟠 | prod-readiness | 4h |
| 10 | Build remaining M1 process forms (HRS/PKL/ANN/SKP/RWD/CRS/CTL) | M1 | 🟠 | M1-02 §§2–9 | scope |
| 11 | Finish MRP lead-time offset **(only if Posture C in v1)** | M3 | 🟠 | M3-02 §3 | 16h |
| 12 | Confirm M2 predictive stub returns readiness, not fake RUL | M2 | ⚪ | M2-08 F-02 | 2h |
| 13 | Decide: Kafka/Redpanda vs formally defer P-01/P-04 | Platform | 🟡 | M4-05, M3-07 | decision |
| 14 | Decompose god-class services per M1-01 §3.2 | M1/M2 | 🟡 | M1-01 §3.2 | M5-adjacent |
| 15 | Remove `as any` on canon read/event-payload paths | M3/M4 | 🟡 | M4-01 §4 | 4h |

**Do NOT touch (plan-compliant):** M3 optimiser 501 · M4 `loss_prediction` empty stub · M2 predictive stub (subject to #12) · unused future-scope tables.

---

## 6. One-line verdict

Architecture and M1/M2 are well-aligned with the blueprints. The real pre-M5 work is **5 M4/M3 defects (items 1–7) + auth rate-limit + Dockerfile** — most of which are *re-wiring to tables and contracts the plan already defines*, not new design. Everything the audit labelled a "predictive/optimiser stub" is the plan working as intended; leave it alone.
