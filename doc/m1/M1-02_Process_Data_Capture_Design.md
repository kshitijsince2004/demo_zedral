**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-02   ·   Document 3 of 10

**Process-Wise Data Capture Design**

Screens, workflow, auto/manual fields, validation, approval, shift handover and exception handling for all ten processes

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

# 1. The Common Capture Pattern (used by every process)

Every M1 form is built from the same parts: a shared header block, the process-specific capture section, and three reusable sub-forms (stoppage, defect, crew). Because 35 fields are common across lines, they are defined once and reused — an operator who learns one screen already understands the others. This section defines the shared pattern in full; the per-process sections that follow only describe what is unique to each line.

## 1.1 Shared screen layout

Each capture screen uses a consistent three-zone layout so the operator's eye always knows where to look. The zones are sized for a landscape industrial touchscreen and reflow to a single column on a tablet held in portrait.

| Zone | Contents | Behaviour |
| --- | --- | --- |
| Context bar (top) | Date, shift, line/mill, operator, target vs produced, online/offline dot | Read-only; auto-filled from login & plan; always visible |
| Coil list (left) | Planned & in-progress coils for the shift; status chips | Tap a coil to load it; green = done, amber = open, grey = planned |
| Capture panel (centre/right) | Header confirm + process-specific fields + sub-form buttons | Where entry happens; large controls; one logical group per card |
| Action bar (bottom) | Save, Add stoppage, Add defect, Submit, Handover | Fixed; thumb-reachable; primary action highlighted |

## 1.2 Shared header block (auto-filled)

The header is identical on every form and is populated without typing: Date and Shift come from the system clock and the logged-in shift; Line/Mill from the device's line binding; Operator/Line-Incharge from login; Target MT and the planned coil list from Planning. The operator confirms rather than enters.

## 1.3 Reusable sub-forms

| Sub-form | Fields | Interaction |
| --- | --- | --- |
| Stoppage | Stoppage code (master), time from/to, reason | Tap code tile → pick from/to on a time wheel → duration auto-calculated |
| Defect | Defect code (master), location/quantity | Tap defect tile → optional location/qty; codes filtered to the current process |
| Crew | Role (operator/asst/helper/crane/mtl) + operator code | Repeatable rows; defaults to the last shift's crew for the line |

| Why sub-forms are shared Stoppage, defect and crew capture behave identically on all ten lines. Building them once guarantees consistent codes, consistent duration maths, and a single place to improve — and it is what lets the OEE and quality modules aggregate cleanly across the plant. |
| --- |

## 1.4 Standard workflow (7 steps)

The operator's path through any line is the same seven steps. The screen map below is the navigation backbone of the PWA; the detailed click counts are in M1-03.

*Figure. Standard operator navigation — login to shift handover*

- **Login** — SSO or badge+PIN on the shared terminal.
- **Line & shift auto-selected** — from the device binding and clock; operator confirms.
- **Shift dashboard** — target, produced-so-far, open coils, any running stoppage.
- **New coil entry** — pick the next planned coil; header and known dimensions auto-fill.
- **Process capture** — confirm + enter the measured values; add defect/stoppage if any.
- **Review & submit** — validation gate runs; the entry is saved and the coil advances.
- **Shift handover** — at shift end, open coils and running stoppages carry to the next shift.

## 1.5 Approval logic (shared)

Capture is a two-state lifecycle with a controlled correction path. An operator works in DRAFT during the shift and SUBMITS at shift end; a Supervisor reviews and APPROVES, which LOCKS the shift log. After locking, any change must go through a change request that the Supervisor approves with a reason — and every such change is audit-logged (M1-08).

*Figure. Entry lifecycle and post-lock correction workflow*

## 1.6 Shift handover logic (shared)

Steel coils routinely span shift boundaries, so handover is a first-class feature rather than an afterthought. When the outgoing operator ends the shift, M1 validates open entries, carries forward any open coils and running stoppages to the new shift log, presents a handover summary (produced vs target, holds, notes), and asks the incoming operator to confirm and sign. No coil is ever orphaned at a shift change.

*Figure. Shift handover sequence*

## 1.7 Exception handling (shared)

| Exception | How M1 handles it |
| --- | --- |
| Network loss | Entry continues offline; queued locally and synced on reconnect; offline dot shown |
| Coil not in plan | Operator can create an ad-hoc coil with a reason; flagged for Supervisor review |
| Out-of-range value | Inline block with the expected range; Supervisor can override with a logged reason |
| Duplicate coil/shift entry | Blocked by unique key; operator is shown the existing entry to edit instead |
| Rework / re-rolling | Re-rolling flag (Skin Pass) or rework status keeps coil genealogy intact |
| Wrong coil picked | Un-submitted entries are editable; submitted ones use the correction workflow |
| Power/PLC trip mid-coil | Partial entry saved as DRAFT; resumes from the queue; stoppage auto-suggested |

# 2. HR Slitting — Form M1-HRS-01

**Device:** line touchscreen.  **Previous:** incoming HR coil (from plan).  **Next:** Pickling.  **Traceability:** source COIL_NO → child slit coils (parent/child).

**Screen layout.** Context bar + planned HR coils on the left. The capture panel opens with the confirmed source coil header, then a **Slit Combination builder** — the defining feature of this line. The operator adds slit rows A–D, each with width / thickness / taper; M1 creates a child coil per slit and links it to the parent. Scrap and defect tiles sit in the action bar.

| Auto-populated (no typing) | Operator entry (measured / observed) | Validation & derived |
| --- | --- | --- |
| Date, Shift, Line Incharge, Area Manager | Actual Width | Actual Width ≤ Nominal Width |
| Target MT (plan) | Slit Combination A–D: width / thk / taper | Σ slit widths ≤ coil width |
| Source Coil No (pick from plan) | Child-coil weights | Scrap % = Scrap ÷ Total (auto) |
| Grade, Customer (coil master) | Actual slit width from/to | Total time, Total production (auto) |
| Nominal Width, Nominal Thk (coil master) | Scrap MT | Mandatory: Coil, Grade, Width, Thk, Weight |
| Sl. No., timestamps | Defect code; Time from/to | Each slit → child COIL_NO |

| Defining validation The slit-combination builder enforces that the sum of slit widths never exceeds the parent coil width, and that each slit's actual width is within tolerance of nominal — caught the moment a row is added, not at submit. |
| --- |

# 3. Pickling — Forms M1-PKL-01 (coil log) + M1-PKL-02 (hourly chart)

**Device:** line touchscreen.  **Previous:** HR Slitting.  **Next:** Cold Rolling.  **Traceability:** COIL_NO carried forward. Pickling is unique in having **two** capture surfaces: a per-coil log and a time-series **hourly process chart** (acid/iron strength, tank conditions, dosage, rinse). The chart is the pilot candidate because it exercises both capture styles.

**Screen layout.** A segmented control switches between Coil Log and Process Chart. The Coil Log behaves like the standard pattern. The Process Chart shows the current hour's slots for the three tanks (T1–T3) and the rinse line; an hourly reminder prompts the operator and highlights any missed slot.

### 3.1 Coil log (M1-PKL-01)

| Auto-populated (no typing) | Operator entry (measured / observed) | Validation & derived |
| --- | --- | --- |
| Header block | Line speed (within band) | Line speed in grade band: |
| Coil No, Customer, Grade (carried) | HT / Heat No, Source | HROP 25–40 MPM |
| Width, Thk, Weight (carried) | W/P, Leader End | CRCA ≤ 60 MPM (SOP) |
| Line speed default by grade | Defect code | Acid/Iron strength in range |
| Sl. No., Total Production (auto) | Time from/to | Mandatory: Coil, Grade, Width, Thk, Weight |

### 3.2 Hourly process chart (M1-PKL-02)

| Group | Fields captured each hour |
| --- | --- |
| Tanks T1–T3 | Level, Temperature (°C), Acid strength %, Iron strength % |
| Steam | Pressure inlet (before PRV), outlet (after PRV) |
| Dosage | Acid, Water, Inhibitor |
| Hot rinse water | CL, PH, Flow, Temperature, Acid %, Iron % |
| Machine | Burner pressure, Hot air temperature |

| Time-series discipline Chart slots are mandatory at each hour. A missed slot is highlighted amber on the dashboard so the supervisor sees the gap immediately. Values are entered on the numeric keypad with last-hour values shown as faint defaults to speed entry. |
| --- |

# 4. Cold Rolling Mill — Form M1-CRM-01 (2HI / 4HI / 6HI selector)

**Device:** mill touchscreen.  **Previous:** Pickling.  **Next:** Annealing.  **Traceability:** COIL_NO carried forward. The three mills share one form structure with a **mill-type selector** (auto-set from the device's line binding). The selector decides which process-specific fields appear, so operators see only the fields relevant to their mill.

**Screen layout.** Standard pattern with the mill type shown in the context bar. The capture panel groups: incoming (width / input thk / weight, auto), the reduction result (output thk, hardness, elongation), and mill machine data (rolls, oil, tension).

| Auto-populated (no typing) | Operator entry (measured / observed) | Validation & derived |
| --- | --- | --- |
| Header + Mill type | Output Thk | Output Thk < Input Thk |
| Coil No, Grade / Surface finish (carried) | Hardness VPN / HRB; Elongation | Tension ≤ SOP max (~7500–7600 kg/mm²) |
| Width, Input Thk, Weight (carried) | R/W tension; Roll in/out | Hardness within grade spec |
| Ann hardness reference (spec) | Defect code; Time from/to | Mandatory: Coil, Grade, Width, Thk, Weight |

## 4.1 Mill-specific sections (2HI vs 4HI vs 6HI)

| Mill | Additional process-specific fields | Notes |
| --- | --- | --- |
| 2HI | Loss % / Stretch %, Oil level (initial/final) & consumption, Roll in/out, Total RW / No. of coils, TKG Wt – Total S/P | Heaviest data set; machine & yield fields per the 2HI sheet |
| 4HI | Output thk, hardness, tension, rolls; lighter machine block | Multi-pass to final gauge; fewer oil/yield fields |
| 6HI | As 4HI; thin-gauge focus, tighter thickness tolerance | Same form; tolerances driven by grade/customer spec |

| One form, three mills Modelling 2HI/4HI/6HI as one form with a MILL_TYPE discriminator (rather than three forms) means a single validation set, a single training surface, and reporting that rolls up or splits by mill at will. |
| --- |

# 5. Annealing — Form M1-ANN-01

**Device:** furnace-area touchscreen/tablet.  **Previous:** Cold Rolling.  **Next:** Skin Pass.  **Traceability:** ANN_CHARGE_NO / ANN_BASE_NO ↔ constituent COIL_NO. Annealing is the one process that does not work coil-by-coil — it groups coils into a furnace **charge**. M1 models this with a **charge/base builder** that selects coils into a charge and a grouping table that resolves a charge back to its coils.

**Screen layout.** Two panels: a Charge builder (base no, charge no, furnace, grade, coil multi-select with running coil count and Σ weight) and a Cycle panel (dew points, temperature, status, expected unloading time, load/unload weights with cumulative totals).

| Auto-populated (no typing) | Operator entry (measured / observed) | Validation & derived |
| --- | --- | --- |
| Date, Shift, Shift Incharge | Base No, Charge No | O₂ < 0.5% before heating (SOP gate) |
| Furnace list (master) | No. of coils; coil selection | Charge Wt = Σ coil weights (auto) |
| Coils eligible for charge (from CRM) | Dew Point N2 / H2; Temperature | Temp within annealing cycle |
| Cumulative load/unload (auto) | Status; Exp. unloading time; Unloading wt | Charge/Base ↔ coil list maintained |

| Safety-linked validation Heating cannot be marked started until O₂ is recorded below 0.5% (per SOP). Delay categories (OPN / ELECT / MECH / UTILITY / POWER) classify any hold for the downtime analytics. |
| --- |

# 6. Skin Pass Mill — Form M1-SKP-01

**Device:** mill touchscreen.  **Previous:** Annealing.  **Next:** Rewinding.  **Traceability:** COIL_NO carried forward. The defining feature is **pass-wise thickness capture** — up to six passes — with the final thickness and pass count derived automatically.

**Screen layout.** Standard pattern plus a Pass stepper: the operator taps ‘Add pass' and enters the achieved thickness for each pass (1–6). A weight-split card captures rolling / re-rolling / skin-pass / scrap dispositions; a Re-Rolling toggle drives rework genealogy.

| Auto-populated (no typing) | Operator entry (measured / observed) | Validation & derived |
| --- | --- | --- |
| Header block | Pass-wise thickness (1–6) | Final Thk = last recorded pass (auto) |
| Coil No, Customer, Grade (carried) | R/W tension; Roll finish M/B | Total Passes = count of filled passes (auto) |
| Width, Thk, Weight (carried) | Re-Rolling Y/N; Hold; Rejection | Re-Rolling boolean keeps genealogy |
|  | Weight split; Rolls in/out; Coolant temp/press | Mandatory: Coil, Grade, Width, Thk, Weight |

# 7. Rewinding — Form M1-RWD-01

**Device:** line touchscreen.  **Previous:** Skin Pass.  **Next:** CRS.  **Traceability:** COIL_NO carried forward. The lightest form — tension rewinding with a surface-finish check. Its main job is to record the three rewinding-tension stages and confirm surface finish before the coil reaches the finishing slitter.

| Auto-populated (no typing) | Operator entry (measured / observed) | Validation & derived |
| --- | --- | --- |
| Header block | Rewinding tension 1 / 2 / 3 | Tension stages numeric & in range |
| Coil No, Customer (carried) | Output Thk | Output Thk consistent with input |
| Width, Thk, Weight (carried) | Surface finish M/B | Mandatory: Coil, Width, Thk, Weight |
|  | Time from/to | Surface finish ∈ {Matt, Bright} |

# 8. CRS (CR Slitter) — Form M1-CRS-01

**Device:** line touchscreen/tablet.  **Previous:** Rewinding.  **Next:** dispatch or CTL (via For-CTL flag).  **Traceability:** COIL_NO + SLIT_NO. CRS is the **quality gate** of the plant — it carries the fullest set of mechanical and surface checks and the **For-CTL routing flag** that sends material onward to Cut-to-Length.

**Screen layout.** A setting header (R.P. oil grade, no. of settings, average setting time) plus the standard coil context. The capture panel has three grouped cards: dimensional (slit no, actual width, slit combination, actual thk front/rear), mechanical (hardness VPN/HRB, UTS, elongation, IB/TIECV, Y.Sr/burr), and surface/finishing (camber/waviness, RA, RZ, coating wt Br/Matt, output wt, rejection OD/ID, hold, For-CTL MT).

| Auto-populated (no typing) | Operator entry (measured / observed) | Validation & derived |
| --- | --- | --- |
| Header + R.P. oil grade, settings | Slit No; Actual width; Slit combination | Σ slit widths ≤ coil width |
| Coil No, Customer, Grade/Finish (carried) | Actual Thk front/rear; Hardness VPN/HRB | Mechanical props within customer spec |
| Coil Width, Nominal Thk (carried) | UTS; Elongation; IB/TIECV; Y.Sr/Burr | Ra / RPC per SOP |
| Customer/grade spec (for checks) | Camber/Waviness; RA; RZ; Coating Br/Matt | For-CTL MT > 0 → routes coil to CTL |
|  | Output wt; Rejection OD/ID; Hold; For-CTL MT | Actual thk front/rear within tolerance |

| Routing is data, not paperwork Setting For-CTL MT on a CRS row sets the coil's next-destination to CTL automatically. The CTL line then sees that coil in its plan list — no separate routing note, no re-keying. |
| --- |

# 9. CTL (Cut to Length) — Form M1-CTL-01

**Device:** line touchscreen.  **Previous:** CRS (For-CTL).  **Next:** dispatch.  **Traceability:** COIL_NO carried forward. CTL cuts coil into sheets/blanks, so it counts in **pieces/bundles** and is the one line that logs weight in **kg** on paper — M1 converts to MT on entry for plant-wide consistency.

**Screen layout.** Standard pattern with a Cut-setting card (nominal set vs actual length) and a Count card (pieces, bundles) replacing the usual weight-centric output. A periodic squareness/length check prompt appears every 50 pieces per SOP.

| Auto-populated (no typing) | Operator entry (measured / observed) | Validation & derived |
| --- | --- | --- |
| Header block; Prepared by | Weight (kg) → converted to MT | Squareness ≤ 1% of width (SOP) |
| Coil No, Customer, Grade (carried) | Nominal set vs Actual length | Length / diagonal check every 50 pieces |
| Width, Thk (carried) | No. of pieces / bundles | kg → MT conversion on entry |
| For-CTL coils appear in plan list | Hold; Rejection; Low speed; Defect | Total production auto-summed |
|  | Estimated / Suppressed; Time from/to | Mandatory: Coil, Grade, Width, Thk, Weight |

# 10. Process Coverage Summary

All ten capture surfaces, their forms, defining sections and routing keys at a glance.

| Process | Form | Defining section | Traceability key |
| --- | --- | --- | --- |
| HR Slitting | M1-HRS-01 | Slit-combination builder; scrap auto-% | COIL_NO → children |
| Pickling | M1-PKL-01/02 | Coil log + hourly process chart | COIL_NO |
| Cold Rolling 2HI | M1-CRM-01 | Loss/stretch, oil, rolls, TKG split | COIL_NO |
| Cold Rolling 4HI | M1-CRM-01 | Output thk/hardness/tension | COIL_NO |
| Cold Rolling 6HI | M1-CRM-01 | Thin-gauge thickness control | COIL_NO |
| Annealing | M1-ANN-01 | Charge/base builder; dew point; O₂ gate | ANN_CHARGE_NO ↔ COIL_NO |
| Skin Pass | M1-SKP-01 | Pass-wise thickness (1–6); re-rolling | COIL_NO |
| Rewinding | M1-RWD-01 | Rewinding tension stages; finish | COIL_NO |
| CRS (CR Slitter) | M1-CRS-01 | Full mechanical + surface QC; For-CTL | COIL_NO + SLIT_NO |
| CTL | M1-CTL-01 | Cut length; piece/bundle count; kg→MT | COIL_NO (For-CTL) |
