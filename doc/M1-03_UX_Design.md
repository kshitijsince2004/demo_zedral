**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-03   ·   Document 4 of 10

**UX Design & Operator Workflow**

Screen-by-screen specifications, click budgets and entry times, control patterns, device layouts and error prevention

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

# 1. UX Goal & Design Principles

The single UX goal is that a busy operator can log a coil in seconds, standing, possibly gloved, without thinking about the software. The design prioritises UX simplicity over software complexity — when the two conflict, the screen wins and the backend absorbs the work. Every decision below serves the targets in M1-00: minimum clicks, minimum typing, maximum automation, error-proof entry.

| Principle | What it means on screen |
| --- | --- |
| Confirm, don't enter | Pre-fill from plan/coil/previous process; the operator taps to confirm |
| One thumb, big targets | ≥ 56 px touch targets, bottom action bar, no tiny links or long-press |
| Right control for the data | Dropdown / radio / toggle / numeric keypad / auto-complete — never a bare text box |
| Show the state | Online/offline dot, target vs produced, coil status colours always visible |
| Fail before save | Validate inline as the operator types; never lose work to a late error |
| Same everywhere | Identical header, sub-forms and gestures on all ten lines |

# 2. The Optimal Operator Workflow

The workflow is the seven-step path from M1-02, instrumented here with a click/tap budget. ‘Taps' counts deliberate touches; auto-filled fields cost zero. The budget below is for a routine, in-plan coil — the common case the UI is tuned for.

*Figure. Operator navigation backbone (shared with M1-02)*

| Step | Screen | Taps (routine coil) | Time |
| --- | --- | --- | --- |
| 1. Authenticate | Login | 2 (badge + PIN) | ~5 s |
| 2–3. Enter shift context | Line/shift auto + Dashboard | 1 (confirm) | ~3 s |
| 4. Pick next coil | Coil list → New entry | 1 (tap coil) | ~2 s |
| 5. Capture measured values | Process capture | 2–3 (keypad + finish) | ~15–25 s |
| 6. Review & submit | Review | 1 (submit) | ~3 s |
| Optional: add stoppage | Stoppage sub-form | +3 | ~8 s |
| Optional: add defect | Defect sub-form | +2 | ~5 s |

*Table. Click budget — a routine coil is logged in roughly 30–45 seconds and ≤ 6 deliberate taps.*

| Login amortised across the shift Login happens once per shift, not per coil. Per-coil interaction after login is typically 4–5 taps. On a shared terminal, badge tap + 4-digit PIN keeps identity attributable without slowing the line. |
| --- |

# 3. Screen-by-Screen Specifications

Each core screen is specified by purpose, components, click count, entry time, navigation and the error-prevention built into it.

## 3.1 Login

| Aspect | Specification |
| --- | --- |
| Purpose | Attribute every entry to a real operator with minimum friction |
| Components | SSO button; badge-scan field; large numeric PIN keypad; line shown by device |
| Clicks / time | 2 taps / ~5 s; SSO single-tap where available |
| Navigation | On success → Shift Dashboard for the device's line |
| Error prevention | Lockout after repeated PIN failures; clear ‘wrong PIN' message; no silent failure |

## 3.2 Shift Dashboard

| Aspect | Specification |
| --- | --- |
| Purpose | Give the operator situational awareness and a one-tap path to the next coil |
| Components | Target vs produced gauge; planned/open/done coil chips; running-stoppage banner; big ‘New coil' button |
| Clicks / time | 1 tap to open a coil / ~3 s |
| Navigation | Coil chip → Process Capture; banner → Stoppage; menu → Handover |
| Error prevention | Open coils surfaced first so none is forgotten; missed chart slots flagged amber (Pickling) |

## 3.3 New Coil Entry (pick-from-plan)

| Aspect | Specification |
| --- | --- |
| Purpose | Start a coil with everything known already filled in |
| Components | Searchable planned-coil list; selected-coil header card (grade, customer, dims auto-filled) |
| Clicks / time | 1 tap (or type-ahead search for off-plan) / ~2 s |
| Navigation | Select → Process Capture with header pre-filled |
| Error prevention | Only valid planned coils shown; off-plan creation requires a reason and is flagged |

## 3.4 Process Capture

| Aspect | Specification |
| --- | --- |
| Purpose | Capture the measured/observed values that only the operator can know |
| Components | Grouped cards; numeric keypad for measures; dropdowns/toggles for choices; sub-form tiles |
| Clicks / time | 2–3 taps + keypad / ~15–25 s (varies by line) |
| Navigation | Save → next coil; or add stoppage/defect; or Review |
| Error prevention | Inline range guards; previous-value defaults; derived fields read-only; unit shown on field |

## 3.5 Stoppage / Defect quick-entry

| Aspect | Specification |
| --- | --- |
| Purpose | Log a stoppage or defect in a few taps without leaving the coil |
| Components | Code tiles (icon grid, process-filtered); time wheel (stoppage); qty/location (defect) |
| Clicks / time | Stoppage 3 taps / ~8 s · Defect 2 taps / ~5 s |
| Navigation | Returns to the coil it was opened from |
| Error prevention | Duration auto-calculated from from/to; only process-applicable codes shown |

## 3.6 Review & Submit

| Aspect | Specification |
| --- | --- |
| Purpose | Final validation gate before the entry becomes part of the shift record |
| Components | Summary card; validation results; Submit (primary) / keep-editing |
| Clicks / time | 1 tap / ~3 s |
| Navigation | Submit → Dashboard (coil marked done); end-of-shift → Handover |
| Error prevention | Submit disabled until mandatory + range rules pass; blocking issues listed with jump-to-field |

## 3.7 Shift Handover

| Aspect | Specification |
| --- | --- |
| Purpose | Pass open work to the next shift with zero data loss |
| Components | Summary (produced vs target, open coils, holds, notes); incoming-operator confirm/sign |
| Clicks / time | 2–3 taps / ~20 s |
| Navigation | Confirm → new shift log opens pre-loaded with carried-over coils |
| Error prevention | Open coils must be acknowledged; running stoppages carried; both operators recorded |

# 4. Control Patterns

The data type dictates the control. This table is the rule the forms follow — it is why typing is rare on M1.

| Data | Control | Example fields |
| --- | --- | --- |
| One of a known list | Dropdown / searchable picker | Customer, Grade, Defect, Stoppage, Operator, Furnace |
| 2–4 choices | Radio / segmented | Surface finish (M/B), Mill (2/4/6HI), Coil log vs Chart |
| Yes / No | Toggle switch | Re-Rolling, Hold, For-CTL on/off |
| A measured number | Large numeric keypad | Thickness, weight, tension, temperature, hardness |
| A time | Time wheel | Stoppage from/to, entry time from/to |
| Coil / order lookup | Auto-complete search | Coil No, Plan order |
| Derived value | Read-only display | Scrap %, total time, total production, charge weight |
| Genuine free text | Text field (last resort) | Remarks only |

# 5. Device Layouts

M1 is one responsive PWA that adapts to four contexts. The shop-floor layouts are touch-first; the management layout is information-dense for a desk browser.

## 5.1 Industrial touchscreen (primary capture)

- Landscape, fixed at the line; three-zone layout (context / coil list / capture).
- Extra-large targets (≥ 56 px), high-contrast palette readable under plant lighting and through safety glasses.
- ‘Glove mode' increases hit areas and spacing; no hover, no right-click, no long-press.
- Always-on context bar and bottom action bar; primary action colour-highlighted.

## 5.2 Tablet (mobile capture / inspection)

- Portrait single-column reflow of the same screens; coil list collapses to a top drawer.
- Used for walking inspection (CRS/CTL quality, Annealing furnace area) and as a backup terminal.
- Camera available for optional defect photos (stored in the object store, linked to the entry).

## 5.3 Mobile (supervisor on the move)

- Read-first: line status, open coils, alerts, pending approvals; quick approve/reject.
- Compact KPI cards; tap-through to a coil or shift log; not intended for bulk capture.

## 5.4 Management dashboard (desk browser)

- Information-dense, multi-line view; OEE, downtime, yield, rejection and traceability widgets (M1-09).
- Filters by line, shift, date, grade, customer; drill-down from KPI to the underlying coils.
- No capture controls — read and analyse only, per role scope.

# 6. Error-Prevention Mechanisms (consolidated)

| Mechanism | Effect |
| --- | --- |
| Pre-fill & confirm | Removes most typing — the largest source of entry error |
| Inline range guards | A value outside the expected band is caught at the field, with the range shown |
| Dependency checks | Output thk < input thk; Σ slit ≤ coil width; final thk = last pass — enforced live |
| Read-only derived fields | Scrap %, totals and charge weight are computed, never keyed |
| Duplicate prevention | Unique coil/shift keys block double entry; the existing record is offered for edit |
| Unit-labelled fields | Each measure shows its unit (mm, MT, °C, kg·cm⁻²) to prevent unit mistakes |
| Submit gating | Submit stays disabled until mandatory + critical rules pass; issues are listed with jump-to |
| Offline safety | Work is queued locally; nothing is lost to a network blip |

| Where the rules live These behaviours are the UX face of the Validation Framework (M1-07). The same rule library runs in the browser (instant feedback) and on the server (authoritative), so the two can never disagree. |
| --- |

# 7. Accessibility & Shop-Floor Ergonomics

- Minimum 16 px body / 20 px+ field text; numerals oversized on the keypad.
- Colour is never the only signal — status uses colour plus icon plus label (colour-blind safe).
- High-contrast theme tuned for variable plant lighting; optional larger ‘glove mode'.
- Audible/visible confirmation on save; clear, plain-language error messages (no codes).
- Multilingual labels supported from the master data so local-language operation is possible.

# 8. Interactive Prototype

A clickable HTML prototype of the key shop-floor screens accompanies this document: **M1_Operator_Prototype.html**. It demonstrates the login, shift dashboard, pick-from-plan autofill, a process capture screen with numeric keypad and dropdowns, the stoppage/defect quick-entry, and shift handover — with a live tap counter so the click budget in Section 2 can be verified hands-on. Open it in any browser; no install required.
