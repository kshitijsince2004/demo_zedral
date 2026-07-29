# ZedralV2.2 — Quality Spec-Sheet Module (QSS)

**Status:** Draft for review · **Owner surface:** Quality team · **Analogy:** SAP ZSPS (spec-as-configuration, resolved on demand)
**Date:** 2026-07-25

---

## 1. Intent (one paragraph)

Give the Quality team one place to author, version, and edit **spec sheets** — the acceptance parameters a material must meet — and then let those specs be **resolved and consumed everywhere they are needed** (order planning, shop-floor QC pass/fail, on-screen reference, DPR/reporting, and any future caller) **without any of it being hardcoded**. A spec is never a standalone document that lives in someone's inbox; it is a governed master record that the platform reads through a single resolver, the same way SAP screens pull a ZSPS entry by key rather than re-typing limits per order.

The guiding constraint from the requirements review is **"nothing is hardcoded, wherever it gets called."** That single sentence is what forces most of the design below. Two follow-on requirements sharpen it: the Quality team needs a **fully editable config dashboard** — including the ability to add new parameters ("columns") themselves, with **warnings on structurally dangerous edits** (§15) — and the module should also help author **process sheets** (the routing/where-checked layer, §16), the way SAP keeps the material specification and the routing as separate but linked artifacts (§17).

---

## 2. What already exists (and why it isn't enough)

The codebase already has a **dormant** foundation:

- **`master.grade_spec`** — keyed by `(grade_code, customer_id)`, columns: `hardness_hrb_min/max`, `uts_nmm2_min/max`, `elongation_pct_min`, `ra_um_max`, plus `spec_id`, `tenant_id`. Multi-tenant, already on the **audit trail** (`auditedTables.ts`).
- **`MasterDataService.createGradeSpec()` / `getGradeSpec(gradeCode, customerId)`** — the resolver already implements the **customer-specific-then-default fallback** we want to keep.

But three things block it from being the Quality module you described:

1. **The parameters are hardcoded as columns.** Adding a new acceptance property (e.g. yield strength, coating weight, a customer-specific dimensional tolerance) means a migration and a code change. That directly violates "nothing hardcoded."
2. **There is no versioning.** No `version_no`, `status`, `effective_from`, `approved_by`. A spec change silently overwrites, and orders already produced against the old limits lose their basis.
3. **There are no consumers.** Nothing in the platform calls `getGradeSpec` today — no UI, no planning attach, no QC validation. It is a contract with no screen and no readers.

So the module is: **(a)** convert the spec from fixed columns to a **parameter catalog + values** model, **(b)** add **versioning + governance**, **(c)** wire a **single resolver** into every consumption surface, and **(d)** build the **Quality-facing UI**. The existing `(grade_code, customer_id)` key and fallback logic are preserved as decided.

---

## 3. Design principles

1. **Spec key stays `(grade_code, customer_id)` with default fallback.** Confirmed. A customer-specific spec wins; otherwise the grade default applies. No new key dimensions in this phase (finish/width deferred — see Open Questions).
2. **Parameters are data, not columns.** The set of acceptance properties is a Quality-editable master (`master.spec_parameter`). Adding a parameter is a data operation, never a migration. This is the core of "nothing hardcoded."
3. **One resolver, one shape.** Every caller — planning, capture, DPR, a screen — goes through `SpecResolverService.resolve(...)` and gets the same normalized object. No consumer re-implements fallback or limit logic.
4. **Specs are versioned and immutable once active.** Editing an ACTIVE spec creates a new version; it never mutates published values. Orders snapshot the version they were planned against.
5. **Resolve-then-snapshot for orders; resolve-live for display.** An order freezes the spec version applicable at planning time (so history is defensible). Read-only screens may resolve live.
6. **Fail safe, never fail loud.** A missing spec must never 500 a committed production capture (same rule as `JourneyAdvanceConsumer`). No spec → "not evaluated," not an error.

---

## 4. Data model

### 4.1 Parameter catalog — `master.spec_parameter`

The Quality-editable dictionary of *what can be specified*. This is what makes the system non-hardcoded.

| Column | Type | Notes |
|---|---|---|
| `parameter_code` | text PK | e.g. `HARDNESS_HRB`, `UTS_NMM2`, `ELONGATION_PCT`, `RA_UM`, `COATING_GSM` |
| `label` | text | Display name, e.g. "Hardness (HRB)" |
| `unit` | text | e.g. `HRB`, `N/mm²`, `%`, `µm` |
| `data_type` | enum | `NUMERIC` \| `TEXT` \| `ENUM` |
| `limit_kind` | enum | `MIN_MAX` \| `MAX_ONLY` \| `MIN_ONLY` \| `TARGET_TOL` \| `EXACT` |
| `applies_to` | text[] | Process codes this parameter is relevant to (`HRS`,`PKL`,`CRM`,…) or `ALL` — drives which capture screens surface it |
| `sort_order` | int | Display ordering |
| `is_active` | bool | Soft delete |
| `tenant_id` | text | Multi-tenant |

Seed migration back-fills the four existing properties as parameter rows so nothing is lost. **The real seed catalog is `Zedral_Quality_SpecSheet_Column_Catalog.xlsx`** — the ~90 columns from the current spec sheet, aligned into parameters (min/max pairs collapsed to one `MIN_MAX` parameter) across groups: Chemistry (C, Mn, Si, S, P, Al×2, N, Ti, B, Nb, Micro-alloy, RPC), Dimensional Tolerances, Mechanical (Hardness, ECV, Yield, UTS, Elongation, r-bar, Bend), Metallurgical (grain size, inclusion rating), Surface/Shape (Rz, Flatness, Waviness, RP-oil), Test Config, Packing, and 4 custom requirement flags. **Identity/key fields (Grade, Material code, Surface finish, Width, Finish thickness, Length, Customer — see §4.2a) and metadata (Revision, Created by/on, Remarks, Name) are NOT parameters** — they map to the spec header/version and are kept on a separate sheet. Note the nominal Width/Thickness/Length/Surface-finish are identity, while their *tolerances* stay parameters. A dozen ambiguities (duplicate Aluminium pair, "Elongation Sex" typo, ECV/RPC/ISI meanings) are listed on the catalog's "Data Issues" tab for confirmation.

### 4.2 Spec header — `master.spec_sheet`

One row per `(grade_code, customer_id)` logical spec — the identity that versions hang off.

| Column | Type | Notes |
|---|---|---|
| `spec_sheet_id` | serial PK | |
| `grade_code` | text FK→`master.grade` | **Identity key** |
| `material_code` | text | **Identity key** |
| `surface_finish` | text FK→`master.surface_finish`, nullable | **Identity key** |
| `width_mm` | numeric, nullable | **Identity key** |
| `finish_thk_mm` | numeric, nullable | **Identity key** |
| `length_mm` | numeric, nullable | **Identity key** (cut-to-length; null for coil-form) |
| `customer_id` | int FK→`master.customer`, nullable | **Identity key** (`NULL` = default) |
| `title` | text | Human label, e.g. "SPCC / ACME — 1250×0.8 BA" |
| `is_active` | bool | Retire the whole spec |
| `tenant_id` | text | |

Unique: `(tenant_id, grade_code, material_code, surface_finish, width_mm, finish_thk_mm, length_mm, customer_id)` — this **is** the identity rule from §4.2a. A change in any of these = new row; anything else = new version. Nullable dimensional keys are compared null-safely (a coil-form spec with no length is distinct from a CTL spec with a length).

### 4.2a Spec identity — when a NEW spec row is created vs a NEW version

**Rule (from requirements):** a **new spec sheet row** is created *only* when one of the **identity key fields** changes. If none of them change, edits produce a **new version of the existing sheet**, never a duplicate row.

**Identity key fields** (the "natural key" of a spec sheet):

1. **Grade** (`grade_code`)
2. **Material code** (`material_code`)
3. **Surface finish** (`surface_finish`)
4. **Width**
5. **Finish thickness**
6. **Length** (cut-to-length)
7. *(retained from earlier decision)* **Customer** (`customer_id`, nullable = default)

> This expands the earlier "grade + customer" key and **closes OQ-1**: the dimensional + material attributes are part of the identity, not acceptance parameters. Consequently **Width, Finish Thickness, Length, and Surface Finish move out of the parameter catalog** (they were mistakenly listed as `TARGET` parameters) and become key columns on `spec_sheet`. Their *tolerances* (finish-width tol, finish-thickness tol, CTL tol) remain parameters — the nominal value identifies the spec, the tolerance is what the spec asserts.

**The guard (enforced on save):**

```
onSaveSpec(draft):
  key = (grade, materialCode, surfaceFinish, width, finishThk, length, customerId)
  existing = findSpecSheetByKey(key)
  if existing:
      # identity unchanged → NOT a new row
      block "A spec with this exact Grade/Material/Finish/Width/Thickness/Length already exists."
      offer → "Create a new VERSION of that spec instead" (opens its version editor)
  else:
      # at least one key field differs → legitimately a new spec row
      create spec_sheet + v1 DRAFT
```

So changing chemistry limits, hardness, packing, etc. on the *same* dimensional/material combination is a **version bump**; changing the width (or thickness, length, grade, finish, material) is a **new spec**. This is exactly how SAP keeps one material-specification per characteristic-value combination and versions the rest.

### 4.3 Spec version — `master.spec_sheet_version`

Governance + immutability live here.

| Column | Type | Notes |
|---|---|---|
| `version_id` | serial PK | |
| `spec_sheet_id` | int FK | |
| `version_no` | int | 1,2,3… per sheet |
| `status` | enum | `DRAFT` \| `ACTIVE` \| `SUPERSEDED` \| `RETIRED` |
| `effective_from` | timestamptz | When it becomes authoritative |
| `effective_to` | timestamptz, nullable | Set when superseded |
| `created_by` / `created_at` | | Author (Quality) |
| `approved_by` / `approved_at` | nullable | Reviewer, if approval required |
| `notes` | text | Change reason / revision remark |

Invariant: **at most one `ACTIVE` version per sheet at any instant.** Publishing v(n) supersedes v(n-1) and stamps its `effective_to`.

### 4.4 Parameter values — `master.spec_value`

The actual limits, one row per parameter per version. Because these are rows, a version can carry *any* subset of the catalog — add a parameter to a spec by inserting a row, no schema change.

| Column | Type | Notes |
|---|---|---|
| `version_id` | int FK | |
| `parameter_code` | text FK→`master.spec_parameter` | |
| `min_value` | numeric, nullable | For MIN/MIN_MAX/TARGET_TOL |
| `max_value` | numeric, nullable | For MAX/MIN_MAX |
| `target_value` | numeric, nullable | For TARGET_TOL/EXACT |
| `tolerance` | numeric, nullable | For TARGET_TOL |
| `text_value` | text, nullable | For TEXT/ENUM parameters |
| `is_mandatory` | bool | Must be measured for the coil to pass |

PK `(version_id, parameter_code)`.

### 4.5 Order attachment (snapshot) — `planning.plan_order_spec`

Freezes which version an order was planned against. `planning.plan_order` already carries `grade_code` + `customer_id`, so resolution is automatic at planning.

| Column | Type | Notes |
|---|---|---|
| `plan_order_id` | int8 FK | |
| `version_id` | int FK | Resolved at attach time |
| `resolved_at` | timestamptz | |
| `resolved_by` | text | User or `SYSTEM` |
| `override_reason` | text, nullable | If Quality manually pinned a non-default version |

### 4.6 QC measurement + verdict — `txn.qc_measurement`

The consumption point for **pass/fail at capture**. Today's `txn.prod_*` tables record dimensions/weights but **not** measured mechanical/quality results, so this is net-new. Keyed by coil so it works across all processes.

| Column | Type | Notes |
|---|---|---|
| `qc_id` | serial PK | |
| `coil_no` | text | Mother or child coil |
| `process_code` | text | Where measured |
| `parameter_code` | text FK | |
| `measured_value` | numeric / text | |
| `version_id` | int FK, nullable | Spec version evaluated against (from the order snapshot) |
| `verdict` | enum | `PASS` \| `FAIL` \| `NOT_EVALUATED` |
| `shift_log_id`, `entry_id` | | Ties back to the production entry |
| `measured_by`, `measured_at` | | |

Verdict is **computed by the resolver**, not typed, so the rule lives in one place.

> All six new tables follow the existing multi-tenant + audit conventions; `spec_sheet_version` and `spec_value` are added to `auditedTables.ts` alongside the already-audited `grade_spec`.

---

## 5. The resolver (single source of truth)

`SpecResolverService` — the only thing that knows how to turn a `(grade, customer)` into limits and a measurement into a verdict. Every consumer calls it.

```
resolve({ gradeCode, materialCode, surfaceFinish, width, finishThk, length, customerId, atTime? }) → ResolvedSpec | null
  1. Find spec_sheet by the identity key (§4.2a). Fallback ladder if no exact match:
       (a) drop customer  → grade-default for same dimensional/material combo
       (b) then, if configured, relax dimensional keys per a tolerance-band match
     First hit wins; nothing matches → null.
  2. Pick the version that is ACTIVE at atTime (default now); DRAFTs never resolve.
  3. Join spec_value rows; return { versionId, parameters: [{ code, label, unit, limitKind, min, max, target, tol, mandatory }] }.
  4. None found → return null (caller treats as "no spec", never an error).

evaluate({ versionId, parameterCode, measuredValue }) → 'PASS' | 'FAIL' | 'NOT_EVALUATED'
  - Applies limit_kind math (min/max/target±tol). Missing limit or value → NOT_EVALUATED.

resolveForOrder(planOrderId) → ResolvedSpec
  - Reads the frozen version_id from plan_order_spec (snapshot), NOT a live re-resolve.
```

Caching: resolved versions are immutable, so cache by `version_id`; invalidate only on publish. Follows the low-network performance constraints already noted for the platform.

---

## 6. Consumption surfaces ("wherever it gets called")

All four requested surfaces are driven by the resolver; adding a fifth later is a new caller, not a new rule.

**A. Attach to order at planning.** When a `plan_order` is created/imported (grade + customer known), a hook calls `resolve(...)` and writes `plan_order_spec` (the snapshot). Quality can re-pin a specific version with an `override_reason`. This is the "used according to the order requirement" behavior.

**B. QC pass/fail at capture.** On the operator/QC capture screens for HRS/PKL/ANN/RWD/CRS/CTL and the CRM mills, the parameters whose `applies_to` includes that process are surfaced (dynamically — driven by the catalog). Entered values are written to `txn.qc_measurement` and stamped with a verdict via `evaluate(...)` against the order's snapshot version. Out-of-spec coils are flagged; **a missing spec yields `NOT_EVALUATED`, never a blocked/500 capture.**

**C. Reference display.** Live/order-detail screens (e.g. `OrderDetailModal`) render the resolved spec read-only so operators can see the target before measuring. Live resolve is fine here.

**D. DPR / reporting.** DPR manager and export definitions (e.g. `RejectedOrdersReport`, certificate-of-analysis style outputs) read verdicts and resolved limits, so rejection reasons and CoA values trace to a specific spec version.

Because every surface reads the same normalized `ResolvedSpec`, none of them hardcodes a parameter name, limit, or unit — they iterate the catalog.

---

## 7. Governance & versioning workflow

Quality authors in **DRAFT**, where values are freely editable and nothing downstream sees them. Publishing transitions DRAFT → **ACTIVE**, sets `effective_from`, and supersedes the prior active version (stamping its `effective_to`). Published versions are **immutable**; a correction is a new version, never an in-place edit. Orders keep the snapshot they were planned against, so re-publishing never rewrites history for already-planned material. Retiring a sheet stops new resolutions without deleting the audit trail.

Whether a separate **approval** step (a reviewer distinct from the author) is required before ACTIVE is a policy toggle — the columns exist (`approved_by`); default is "author may publish" unless the plant enables review. (Open Question OQ-3.)

---

## 8. Roles & permissions

There is **no `QUALITY` role today** — only `OPERATOR`, `MACHINE_HEAD`, `PLANT_HEAD`, `ADMIN` (`shared-validation/src/types/roles.ts`). Two options; recommendation is the first:

- **(Recommended) Add `QUALITY` to `UserRole`.** A `requireRole([QUALITY, ADMIN])` gate protects all spec-authoring routes; capture screens need only READ on resolved specs. Clean separation, matches how the plant actually delegates.
- **Reuse `PLANT_HEAD`/`ADMIN`.** No enum change, but conflates quality authority with plant management and can't be granted independently.

Read access to *resolved* specs is open to any authenticated production role (operators must see targets). Write access to catalog + specs is Quality/Admin only.

---

## 9. UI — the Quality dashboard

A new section under the client (sibling to `pages/admin`, `pages/live`), `RoleRoute`-gated to QUALITY/ADMIN. Screens:

1. **Spec list / search** — all spec sheets, filter by grade/customer/status, "default vs customer-specific" badges, active-version-at-a-glance, where-used count.
2. **Spec editor** — pick grade + optional customer; add/remove parameters *from the catalog* (dynamic form, not fixed fields); enter limits per the parameter's `limit_kind`; save DRAFT; **Publish**. Shows a live diff vs the current active version.
3. **Version history** — timeline of versions with status, effective dates, author/approver, change notes; open any version read-only.
4. **Parameter catalog admin** — manage `master.spec_parameter` (add "Yield strength (N/mm²)" etc. with no code change); set `applies_to` so it appears on the right capture screens.
5. **Where-used** — for a spec/version, list orders (via `plan_order_spec`) and recent QC verdicts, so Quality sees the blast radius before publishing.

Reuse the existing master-data admin patterns and API/`requireRole` conventions rather than inventing new UI scaffolding.

---

## 10. API surface (indicative)

```
# Catalog (Quality/Admin)
GET   /quality/parameters
POST  /quality/parameters
PATCH /quality/parameters/:code

# Spec sheets & versions (Quality/Admin)
GET   /quality/specs?grade=&customer=&status=
POST  /quality/specs                      # create sheet
GET   /quality/specs/:id/versions
POST  /quality/specs/:id/versions         # new DRAFT
PUT   /quality/versions/:versionId        # edit DRAFT values
POST  /quality/versions/:versionId/publish
GET   /quality/versions/:versionId/where-used

# Resolver / universal fetch (all production roles, READ) — see §17a
GET   /quality/resolve?grade=&customer=&at=
GET   /quality/orders/:planOrderId/spec   # snapshot
GET   /quality/fetch?by=&orderId=&grade=&customer=&coil=&groups=&parameters=&process=&mode=&projection=
POST  /quality/fetch/batch                 # many orders/coils in one call (DPR, exports)

# QC capture (Operator/QC, WRITE)
POST  /quality/qc-measurements            # value in → verdict out
```

---

## 11. Migrations

1. `master.spec_parameter` (+ seed the 4 existing properties as rows).
2. `master.spec_sheet`, `master.spec_sheet_version`, `master.spec_value` (+ unique key, + audit registration).
3. `planning.plan_order_spec`.
4. `txn.qc_measurement`.
5. **Data migration:** for each existing `master.grade_spec` row, create a spec_sheet + a v1 ACTIVE version + spec_value rows, then keep `grade_spec` readable during transition (dual-read) and retire it once the resolver is live. (Windows UTF-16 `.ts` editing caveat applies to any TS touched — verify Vite build after edits.)
6. Add `QUALITY` to `UserRole`.

---

## 12. Non-functional

Multi-tenant `tenant_id` on every table; full audit on catalog, versions, and values; low-network friendly (immutable-version caching, no chatty re-resolves on capture); capture-path safety (spec failures degrade to `NOT_EVALUATED`, never block a committed production entry). Sequencing note: like the M1 change-set, this should land **after** any in-flight repo cleanup to avoid edit-target overlap.

---

## 13. Open questions

- **OQ-1 (key richness): RESOLVED (§4.2a).** Identity key = Grade + Material code + Surface finish + Width + Finish thickness + Length + Customer. A new spec row is created only on a change to one of these; everything else is a version bump.
- **OQ-2 (approval):** Is a reviewer distinct from the author required before ACTIVE, or may Quality self-publish? Columns exist either way.
- **OQ-3 (mandatory QC gating):** For `is_mandatory` parameters, does a FAIL *block* order sign-off, or only flag it? (Recommend flag-only in phase 1, consistent with fail-safe capture.)
- **OQ-4 (ANN):** ANN advances on charge fan-out, not per-coil — does QC attach per coil or per charge for ANN?
- **OQ-5 (CoA):** Is a customer-facing Certificate of Analysis an output of this module now, or a later report built on the verdicts?

---

## 14. Task breakdown (phased)

**Phase 0 — Foundation:** parameter catalog + spec_sheet/version/value tables + seed/data migration + resolver service (with fallback + evaluate) + `QUALITY` role. *No UI yet; unit-test the resolver against the migrated grade_spec data.*

**Phase 1 — Authoring UI:** Quality dashboard (list, editor, version history, catalog admin, publish workflow). Read-only resolve endpoint live.

**Phase 2 — Order attach:** `plan_order_spec` snapshot hook on plan-order create/import + manual re-pin. Reference display on order/live screens.

**Phase 3 — QC capture:** dynamic per-process parameter forms on capture screens → `txn.qc_measurement` + verdicts. Out-of-spec flagging.

**Phase 4 — Reporting + full config dashboard:** DPR / rejected-orders / CoA read verdicts and resolved limits. Where-used view. Tiered destructive-edit guardrails (§15) across catalog and specs.

**Phase 5 — Process sheets:** operation-level routing overlay (`process_sheet` tables, §16) so inspection points are defined per process step, upgrading the phase-1 `applies_to` process-level granularity.

Each phase is independently shippable; the resolver in Phase 0 is the spine everything else plugs into.

---

## 15. Fully-editable config dashboard & destructive-edit guardrails

The requirement is a **fully functioning config profile where everything is editable — including adding new "columns" (parameters) — with warnings for major structural changes.** The parameter-catalog model in §4.1 is exactly what makes "add a column" a safe data operation instead of a schema migration: a new acceptance property is a new `spec_parameter` row, instantly available to every spec and every capture screen via its `applies_to`. No developer, no deploy.

But "everything editable" cuts both ways, so edits are tiered by blast radius, and the dashboard must gate the dangerous ones:

**Tier 1 — safe / free edits (no warning):** editing a DRAFT version's values, adding a *new* parameter to the catalog, editing a label/unit/sort order, creating a new spec sheet. These touch nothing already relied upon.

**Tier 2 — governed edits (confirmation + reason required):** publishing a version (supersedes the active one), re-pinning an order to a non-default spec version, changing a parameter's `applies_to` (changes which capture screens surface it). The dashboard shows a confirm dialog and records the reason in the audit trail.

**Tier 3 — destructive / structural edits (hard warning + where-used blast radius + typed confirmation):**
- Retiring a parameter that is used by active spec versions.
- Changing a parameter's `data_type` or `limit_kind` after values exist (can invalidate stored limits and past verdicts).
- Retiring a spec sheet that is attached to open orders.
- Deleting a customer-specific spec that orders resolved through.

For Tier 3 the dashboard must **show the where-used count and list first** (how many spec versions, open orders, and recent QC verdicts are affected), require the user to type the spec/parameter name to confirm, and **never hard-delete** — everything is soft-delete (`is_active=false`) so the audit trail and historical verdicts stay intact. Published versions remain immutable regardless of tier; the only way to "change" active values is a new version. This mirrors how SAP refuses to let you silently mutate a released inspection plan.

Practical rule: **a structural change can never retroactively flip a coil that already passed.** Snapshots (§4.5) and immutable versions guarantee it.

---

## 16. Process sheets (the routing layer)

"Help in making the process sheets" is a **distinct but adjacent** artifact from the quality spec sheet, and SAP separates them the same way:

- **Quality spec sheet (this module's core)** = *what* the material must satisfy (SAP Material Specification / MIC + limits).
- **Process sheet** = *how it is produced and where it is checked* — the ordered sequence of process operations (HRS → PKL → … → CTL) for a grade/order and the inspection points at each step (SAP **Routing**, where operations carry assigned inspection characteristics).

Zedral already has the raw material for the routing side: `master.route_code`, the process-route engine, and `planning.order_journey` / `order_journey_step`. A process sheet is a Quality-authored, versioned overlay on that: for a `(grade, customer)` — or a route template — define the operation sequence and, **per operation, which spec parameters are inspected** (a join from the process-sheet step to `spec_parameter`). At capture time, the operator's screen for a given process shows exactly the parameters that process sheet says to check at that step, resolved against the order's spec version. This is the same dynamic, nothing-hardcoded principle applied to the route dimension.

Recommended sequencing: build the **quality spec sheet + resolver first (Phases 0–3)**, then add the **process-sheet overlay as Phase 5** once the parameter catalog and journey model are both stable — trying to author operation-level inspection points before the parameter catalog exists would be backwards. The `applies_to` field on parameters is the phase-1 stand-in (process-level granularity); the process sheet upgrades that to operation-level granularity.

**New tables (Phase 5, indicative):** `master.process_sheet` (header, keyed like spec_sheet), `master.process_sheet_step` (operation sequence, links to `route_code`), `master.process_sheet_step_check` (which `parameter_code`s are inspected at that step). Same versioning/governance/guardrail model as the quality spec sheet.

---

## 17a. Generic parameter-fetch contract (fetch anything, anywhere, for any purpose)

The explicit requirement is that **any parameter can be fetched for any purpose as per requirement.** This only holds if fetching is generic — driven by the catalog, never by per-parameter code. The design guarantees it with a single, uniform read surface that every consumer (planning, capture, DPR, another module, an export, a future screen) calls the same way.

**One query, flexible selectors.** A caller describes *what it wants* and *for which material context*; it never names hardcoded fields.

```
SpecFetchService.fetch({
  # WHICH spec (any one context selector)
  by:        'order' | 'grade+customer' | 'coil' | 'sheet',
  orderId?, gradeCode?, customerId?, coilNo?, specSheetId?,

  # WHICH parameters (all optional → default = everything applicable)
  parameters?: ['UTS','HARDNESS', ...],   # explicit codes
  groups?:     ['CHEM','MECH'],           # whole groups
  process?:    'ANN',                      # only params whose applies_to includes this
  mandatoryOnly?: true,

  # WHICH version
  asOf?:  timestamp,        # resolve the version active then
  mode?:  'resolved' | 'snapshot' | 'draft',   # live vs order-frozen vs working

  # SHAPE of the answer
  projection?: ['code','label','unit','min','max','target','verdict']
}) → ParameterView[]
```

**Uniform return shape.** Every fetch returns the same normalized row per parameter, so no consumer parses a bespoke structure:

```
{ code, label, group, unit, dataType, limitKind,
  min, max, target, tolerance, textValue, mandatory,
  versionId, source: 'customer'|'default',   # which fallback tier answered
  measuredValue?, verdict? }                  # populated only when a coil/order context implies results
```

**Why "any new parameter is automatically fetchable":** because parameters are catalog rows and the fetch selects rows, the moment Quality adds a parameter it is returned by the same endpoint with zero code change. Adding a purpose (a new caller) is likewise just a new consumer of one stable contract — the two axes the requirement cares about ("any parameter" × "any purpose") are both open by construction.

**Access channels (same contract, three doors):**
- **In-process service** — `SpecFetchService.fetch(...)` for server code (planning hook, capture validation, report builders).
- **REST** — `GET /quality/fetch?by=order&orderId=…&groups=CHEM,MECH&projection=code,min,max` (and the resolver/snapshot endpoints in §10). Read is open to any authenticated production role; write stays Quality/Admin.
- **Bulk / export** — the same fetch backs CSV/Excel export and a `POST /quality/fetch/batch` that resolves many orders/coils at once, so DPR and external systems pull without N+1 calls.

**Fetch rules that keep it safe and fast:**
1. **Read-only and side-effect-free.** Fetch never mutates; it cannot publish, verdict-stamp, or advance a journey.
2. **Version-honest.** `mode:'snapshot'` returns exactly what the order was planned against; `mode:'resolved'` returns the current active version; `draft` is Quality-only. A caller can never accidentally read a DRAFT into production.
3. **Fallback-transparent.** Every row says whether it came from the customer-specific or grade-default spec (`source`), so consumers can display/trust provenance.
4. **Projection-first.** Callers request only the fields they need — a DPR cell might ask for `min,max,verdict` only — keeping payloads small on low-network shop-floor devices.
5. **Cacheable.** Keyed by `(versionId, projection)`; immutable versions mean the cache never serves stale limits.
6. **Missing → empty, never error.** No spec / no such parameter returns an empty set or `NOT_EVALUATED`, never a 4xx that could break a caller.

This is the concrete mechanism behind the §3 principle "one resolver, one shape": §5's `resolve()`/`evaluate()` are the *compute* primitives; `fetch()` is the *universal read* built on them that any purpose plugs into.

---

## 17. SAP mapping (how they do it → Zedral equivalent)

| SAP concept | What it does | Zedral (this spec) |
|---|---|---|
| **Master Inspection Characteristic (MIC)** | Reusable, catalogued quality characteristic (dimension, chemistry, mechanical) with data type + limits + method | `master.spec_parameter` (the editable "column" catalog) |
| **Specification limits** (upper/lower/central) | Min/max/target per characteristic, at master or plan level | `master.spec_value` (`min/max/target/tolerance`, driven by `limit_kind`) |
| **Material Specification (QMSP)** / **Inspection Plan** | Per-material (± customer) set of characteristics + limits | `master.spec_sheet` + `spec_sheet_version` |
| **"Inspect with Material Specification" indicator** | Inspect straight from the material spec, skipping a full plan | Resolve-by-`(grade, customer)` — our default model |
| **Quantitative characteristic results recording** | Enter measured values, system judges against limits | `txn.qc_measurement` + resolver `evaluate()` → verdict |
| **Routing** (operations at work centers, inspection chars assigned) | Sequence of production steps and where each check happens | Process sheet (§16) over `route_code` / `order_journey` |
| **Engineering/version change, released-plan lock** | Versioned, can't silently mutate a released plan | Version status `DRAFT→ACTIVE→SUPERSEDED` + immutability + snapshots (§7, §15) |

The takeaway from SAP: they deliberately keep the **reusable characteristic catalog**, the **per-material specification**, and the **routing** as three separate but linked layers, and they lock released plans. This spec follows the same separation — which is what lets everything stay editable without letting an edit corrupt history.
