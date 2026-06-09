**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-07   ·   Document 8 of 10

**Validation Framework**

Range, mandatory, dependency, duplicate-prevention and integrity rules across production, coil, quality, machine and shift data

**Document set — M1 Technical Blueprint**

| Doc | Title |
| --- | --- |
| M1-00 | Blueprint Overview & Index |
| M1-01 | System Architecture |
| M1-02 | Process-Wise Data Capture Design |
| M1-03 | UX Design & Operator Workflow |
| M1-04 | Data Model & Database Design |
| M1-05 | Role-Based Access Control & Security |
| M1-06 | Planning Integration & Export |
| M1-07 | Validation Framework |
| M1-08 | Audit Trail & Compliance |
| M1-09 | Reporting & Monitoring |

Prepared for Z Company  ·  Role: Manufacturing Digital Transformation Consultant / Industrial Software Architect

Version 1.0  ·  30 May 2026  ·  Confidential

**Contents**

# 1. Validation Strategy

Validation is what makes the captured data trustworthy enough for every downstream module to rely on. M1 validates in layers: the UI guides entry so most errors never occur; a shared rule library checks values the instant they are entered; the server re-checks authoritatively before save; and the database enforces hard constraints as a final backstop. The same rule library runs in the browser and on the server, so client feedback and server enforcement can never disagree.

| Layer | Runs | Catches |
| --- | --- | --- |
| UI guidance | As the operator interacts | Most errors by design — dropdowns, toggles, keypad, pre-fill |
| Client rules | On field change / blur | Range, mandatory, dependency — instant feedback, works offline |
| Server rules | On save / submit | Authoritative re-check; cross-record (duplicates, spec, sums) |
| DB constraints | On write | PK/FK/UNIQUE/CHECK — the last line of defence |

| Severity | Behaviour |
| --- | --- |
| Block | Save/submit prevented until fixed (mandatory, hard dependency, duplicate, FK) |
| Warn-override | Allowed with a logged reason by Supervisor/Admin (soft range breach) |
| Info | Advisory only (e.g. value differs from last shift's average) |

# 2. Mandatory Fields

The minimum every coil row must carry — enforced on every line — plus the header essentials.

| Scope | Mandatory fields |
| --- | --- |
| Every coil entry | Coil No, Grade, Width, Thickness, Weight |
| Shift header | Date, Shift, Process/Line, Target, Line Incharge |
| Stoppage | Stoppage code, Time from, Time to |
| Defect | Defect code |
| Annealing charge | Charge No, Furnace, at least one coil, Status |
| Submission | All of the above present and range-valid for the whole shift log |

# 3. Range Validations

Numeric values are bounded by SOP-derived or grade-derived limits. Soft bounds warn-and-override; SOP safety limits block.

| Field | Rule / limit | Source | Severity |
| --- | --- | --- | --- |
| Pickling line speed | HROP 25–40 MPM; CRCA ≤ 60 MPM | SOP | Block |
| Mill ETR/DTR tension | ≤ ~7500–7600 kg/mm² max | SOP | Block |
| Annealing O₂ before heating | < 0.5% | SOP (safety) | Block |
| CTL squareness | ≤ 1% of width | SOP | Warn-override |
| Acid / Iron strength (tanks) | Within titration band per tank | SOP | Warn-override |
| Hardness / UTS / Elongation | Within grade/customer spec band | Spec master | Warn-override |
| Roughness Ra / RZ | Within Ra/RPC target | SOP/spec | Warn-override |
| Widths / thicknesses / weights | > 0 and within plausible plant range | Master/plausibility | Block / Warn |

# 4. Dependency Validations

Rules that relate fields to each other or to the coil's history — the checks paper sheets could never enforce.

| Dependency rule | Applies to |
| --- | --- |
| Output thickness < input thickness at every rolling step | Cold Rolling, Skin Pass, Rewinding |
| Actual width ≤ nominal width | HR Slitting, CRS |
| Σ slit widths ≤ parent coil width | HR Slitting, CRS |
| Final thickness = last recorded pass; total passes = count of filled passes | Skin Pass |
| Charge weight = Σ constituent coil weights | Annealing |
| Time To > Time From; stoppage within shift bounds | All (stoppage & entry times) |
| Quality values validated against the coil's grade/customer spec | Cold Rolling, CRS |
| For-CTL MT ≤ available output weight; routes coil to CTL | CRS → CTL |
| Grade/finish consistent with the coil master carried forward | All |

# 5. Duplicate Prevention

- **Shift log** is unique on (date, shift, process, mill-type) — a line cannot open two logs for the same shift.
- **Coil within a shift/process** cannot be entered twice; the existing entry is opened for edit instead.
- **Slit / pass rows** are unique within their parent entry (slot A–D; pass 1–6).
- **Annealing charge no** is unique; a coil cannot be in two open charges at once.
- **CSV import** is idempotent on COIL_NO — re-loading updates rather than duplicates.

# 6. Data Integrity Rules

- All coded fields (customer, grade, defect, stoppage, surface finish, oil grade, furnace) are foreign-key enforced — no free-text codes.
- Derived fields (scrap %, total time, total/cumulative production, charge weight) are computed and read-only — never keyed.
- Units are fixed per field and stored canonically (MT plant-wide; CTL kg converted on entry).
- Coil genealogy is preserved: slit children link to parents; re-rolling keeps the same coil identity.
- Locked (approved) records are immutable except through the audited correction workflow (M1-08).
- Referential deletes are constrained: a coil with entries cannot be deleted; drafts cascade to their details.

# 7. Category Summary

How the rule types map onto the five data categories the framework must cover.

| Data category | Key validations |
| --- | --- |
| Production data | Mandatory totals/targets; derived totals read-only; time consistency; duplicate shift block |
| Coil data | Mandatory dims/weight; actual ≤ nominal; FK grade/customer; genealogy integrity |
| Quality data | Hardness/UTS/elongation/roughness vs spec; defect codes from master; tolerance bands |
| Machine data | Pressure/temperature/tension/oil/coolant within SOP/plant ranges; plausibility |
| Shift data | Mandatory header; one log per (date, shift, process, mill); handover completeness |

# 8. Override Governance & Messaging

- Only **Supervisor/Admin** can override a warn-level rule, and only with a recorded reason; overrides are audit-logged.
- **Block-level** rules (mandatory, hard dependency, duplicate, FK, SOP safety) cannot be overridden by anyone.
- Messages are plain-language and actionable — they state the expected range/condition and offer a jump-to-field, never a raw code.
- Validation thresholds (soft bands, spec links) are Admin-configurable so rules evolve without code changes.

| Single source of rules Every rule in this document is implemented once in the shared validation library and surfaced both as live UI feedback (M1-03) and as server enforcement. There is no second, divergent copy of the rules anywhere in the system. |
| --- |
