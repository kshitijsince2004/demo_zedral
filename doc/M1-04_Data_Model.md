**HERO STEELS LIMITED**

Cold Rolling Steel Plant  ·  Digital Transformation Initiative

**MODULE M1 — DATA CAPTURE LAYER**

M1-04   ·   Document 5 of 10

**Data Model & Database Design**

Master, transaction, reference, user, audit and planning tables; ER diagrams; keys, relationships and the runnable SQL DDL

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

# 1. Modelling Principles

The data model turns the mapping phase's 115 canonical fields into a normalised, modular schema. Three rules drive every table: one canonical field is one column (with its unit embedded in the name); one real-world entity has exactly one master; and the coil is the atomic, shared spine that every process appends to. The result de-duplicates the 317 paper captures and gives downstream modules stable keys to join on.

| Decision | Rationale |
| --- | --- |
| UPPER_SNAKE_CASE with unit suffix (e.g. COIL_WIDTH_MM) | Self-documenting; eliminates unit ambiguity across lines |
| One master per entity (customer, grade, defect, stoppage, operator, furnace) | Shared dropdowns; consistent codes; single point of maintenance |
| Coil = single normalised COIL_NO; parent/child for slitting | End-to-end traceability; slit genealogy preserved |
| Shared SHIFT_LOG header + per-process detail tables | Common fields once; process specifics isolated and independently evolvable |
| Repeatable sub-tables for stoppage / defect / crew | Scales to any line; no fixed Crew1/2/3 columns |
| Weight stored in MT plant-wide | CTL kg converted on entry; one unit for all roll-ups |
| Logical schemas (master/coil/txn/planning/security/audit) | Mirrors the modularity & access model; clean BI replica boundary |

# 2. Schema Organisation

| Schema | Holds | Change rate |
| --- | --- | --- |
| master | Reference/master data shared by all forms | Slowly changing |
| coil | Coil identity & process history (traceability spine) | Per coil |
| txn | Shift logs, per-process entries, stoppage/defect/crew | High (append) |
| planning | SAP/CSV-sourced plan orders, coil plan, import batches | Per plan cycle |
| security | Users, roles, user-role, line access | Slowly changing |
| audit | Audit log, change requests, export jobs | Write-once |

# 3. Entity-Relationship Diagrams

The model is shown in two ER views for legibility: the core capture & traceability entities, and the supporting planning, security and audit entities. Crow's-foot notation; PK underlined, FK italic.

## 3.1 Core capture & traceability

*Figure. Core ER — coil spine, shift log, process entries, sub-tables and masters*

## 3.2 Planning, security & audit

*Figure. Supporting ER — planning, RBAC and audit/change control*

# 4. Table Catalog

Forty tables across six schemas. The per-process detail tables (prod_*) all share the same shape — header link + coil link + the process-specific columns from M1-02.

| Group | Tables | Primary key |
| --- | --- | --- |
| Master | process, shift, customer, grade, surface_finish, defect_code, stoppage_code, operator, furnace, rp_oil_grade, grade_spec | code / id |
| Coil | coil, coil_process_history | coil_no |
| Txn – header & shared | shift_log, stoppage_entry, crew_entry, defect_entry | *_id |
| Txn – per process | prod_hrs (+ _slit), prod_pkl, prod_pkl_chart, prod_crm, ann_charge (+ _coil), prod_skp (+ _pass), prod_rwd, prod_crs (+ _slit), prod_ctl | entry_id / charge_no |
| Planning | import_batch, plan_order, coil_plan | *_id |
| Security | app_user, role, user_role, line_access | id / composite |
| Audit | audit_log, change_request, export_job | *_id |

# 5. Key Table Structures

Selected structures in full; the rest follow the same conventions in the companion DDL.

## 5.1 coil.coil — the traceability spine

| Column | Type | Key / notes |
| --- | --- | --- |
| coil_no | VARCHAR(30) | PK — single normalised identity |
| parent_coil_no | VARCHAR(30) | FK → coil (self) — slitting parent |
| customer_id | INTEGER | FK → master.customer |
| grade_code | VARCHAR(20) | FK → master.grade |
| surface_finish | VARCHAR(8) | FK → master.surface_finish |
| heat_no | VARCHAR(30) | HT / heat number |
| nominal_width_mm / coil_width_mm | NUMERIC | nominal vs actual width |
| coil_thk_mm / weight_mt | NUMERIC | current thickness; weight in MT |
| current_process_id / next_dest | SMALLINT / VARCHAR | current location; routing (e.g. CTL) |
| status | VARCHAR(20) | PLANNED/IN_PROCESS/HOLD/REWORK/DONE/SCRAPPED |

## 5.2 txn.shift_log — the transaction header

| Column | Type | Key / notes |
| --- | --- | --- |
| shift_log_id | BIGSERIAL | PK |
| prod_date / shift_code / process_id | DATE / FK / FK | unique together with mill_type |
| mill_type | VARCHAR(8) | 2HI/4HI/6HI — CRM only |
| target_mt / total_prod_mt | NUMERIC | target (plan); total derived |
| line_incharge_id / shift_manager_id | FK → operator | shift staffing |
| approver_id | FK → app_user | supervisor who locks |
| state | VARCHAR(16) | DRAFT/SUBMITTED/APPROVED/REOPENED |
| prev_shift_log_id | FK → shift_log (self) | handover link |

## 5.3 Per-process entry pattern (e.g. txn.prod_crm)

Every prod_* table starts with the same three columns — entry_id (PK), shift_log_id (FK → header), coil_no (FK → spine) — then carries that process's specific columns from M1-02. prod_crm adds output_thk_mm, hardness, elongation, tension, rolls, oil and a CHECK that output thickness is less than input. Annealing differs: ann_charge is keyed by charge_no and ann_charge_coil resolves a charge to its coils.

| Modular by construction Adding a field to one line means altering one prod_* table. Adding a line means one new prod_* table plus a process master row — the shared header, sub-forms, masters and coil spine are untouched. |
| --- |

# 6. The Shared-Field Backbone (35 common master fields)

These recur across two or more processes and are defined once. They become the shared header, the coil/dimension columns, and the sub-table fields — the reason M1 has no duplicated definitions.

| Canonical field | Label | Category | # proc | Appears in |
| --- | --- | --- | --- | --- |
| PROD_DATE | Date | Shift Info | 8 | All processes |
| LINE_INCHARGE_ID | Line Incharge | Admin | 8 | All processes |
| OPERATOR_CODE | Operator | Operator | 8 | All processes |
| SHIFT_CODE | Shift | Shift Info | 8 | All processes |
| STOPPAGE_CODE | Stoppage Code | Downtime | 8 | All processes |
| APPROVER_ID | Area Manager | Admin | 7 | All except Annealing |
| COIL_NO | Coil Source / No. | Coil | 7 | All except Annealing* |
| CRANE_OPERATOR | Crane Operator | Operator | 7 | Most lines |
| CUSTOMER_ID | Customer | Coil | 7 | All except Annealing |
| GRADE_CODE | Grade | Coil | 7 | All except Pickling/Rewinding split |
| REMARKS | Remarks | Quality | 7 | Most lines |
| SL_NO | Sl. No. | Production | 7 | Most lines |
| TARGET_MT | Target (MT) | Production | 7 | Most lines |
| TIME_TOTAL_MIN | Time Taken – Total | Production | 7 | Most lines (derived) |
| TOTAL_PROD_MT | Total Production (MT) | Production | 7 | Most lines (derived) |
| WEIGHT_MT | Weight | Production | 7 | Most lines |
| CREW | Crew 1/2/3 | Operator | 6 | → repeatable crew sub-table |
| COIL_WIDTH_MM | Width | Coil | 6 | PKL, CRM, SKP, RWD, CRS, CTL |
| DEFECT_CODE | Defect Code/Symbol | Quality | 4 | HRS, PKL, CRM, CTL |
| STOPPAGE_DURATION | Stoppage From/To/Total | Downtime | 4 | HRS, PKL, CRM, ANN |
| COIL_THK_MM | Thickness | Coil | 4 | PKL, CRM, SKP, RWD |
| DOC_FORM_NO | Form No. | Admin | 3 | HRS, CRS, CTL |
| HOLD_MT | Hold | Downtime | 3 | SKP, CRS, CTL |
| OUTPUT_THK_MM | Output Thickness | Quality | 3 | CRM, SKP, RWD |
| REJECTION_MT | Rejection | Downtime | 3 | SKP, CRS, CTL |
| RW_TENSION_KG | R/W Tension | Process | 3 | CRM, SKP, RWD |
| ACTUAL_WIDTH_MM | Actual Width | Quality | 2 | HRS, CRS |
| ASST_OPERATOR | Asst. Operator | Operator | 2 | PKL, CTL |
| ELONGATION_PCT | Elongation | Quality | 2 | CRM, CRS |
| HARDNESS_HRB | Hardness VPN/HRB | Quality | 2 | CRM, CRS |
| HELPER | Helper | Operator | 2 | PKL, ANN |
| NOMINAL_THK_MM | Nominal Thickness | Coil | 2 | HRS, CRS |
| SCRAP_MT | Scrap (MT) | Downtime | 2 | HRS, CRM |
| SLIT_COMBINATION | Slit Combination A/B/C/D | Process | 2 | HRS, CRS |
| SURFACE_FINISH | Roll Finish (M/B) | Quality | 2 | SKP, RWD |

# 7. Naming Convention (variant → standard)

The paper sheets recorded the same concept under different labels. The model normalises each to one standard name with an embedded unit.

| Current variants | Standard name | Type | Unit | Notes |
| --- | --- | --- | --- | --- |
| Coil No / Coil Source No / Coil M.T | COIL_NO | Text | — | Primary traceability key |
| Charge No, Base No (Annealing) | ANN_CHARGE_NO / ANN_BASE_NO | Text | — | Maps to constituent COIL_NO |
| Customer | CUSTOMER_NAME | Dropdown | — | Master list |
| Grade / Grd | GRADE_CODE | Dropdown | — | Split surface finish separately |
| Surface / Roll Finish (M/B) | SURFACE_FINISH | Dropdown | — | Matt / Bright |
| Width / Coil Width | COIL_WIDTH_MM | Numeric | mm | Nominal vs Actual as 2 fields |
| Thickness / Thick | COIL_THK_MM | Numeric | mm | Input thickness |
| Output/Final Thickness | OUTPUT_THK_MM | Numeric | mm | Achieved after rolling |
| Weight / Wt / Charge Wt | WEIGHT_MT | Numeric | MT | Standardise to MT |
| Hardness VPN/HRB | HARDNESS_VPN / _HRB | Numeric | VPN/HRB | Two fields |
| UTS | UTS_NMM2 | Numeric | N/mm² | Tension test |
| Line Speed | LINE_SPEED_MPM | Numeric | m/min | Grade-banded |
| R/W Tension | RW_TENSION_KG | Numeric | kg | Stage-wise sub-table |
| Acid/Iron Strength | ACID_STRENGTH_PCT / IRON_STRENGTH_PCT | Numeric | % | Per tank T1–T3 |
| Temp (°C) | TEMP_DEGC | Numeric | °C | Context-prefixed (ANN_, RINSE_) |
| Scrap / Rejection / Hold | SCRAP_MT / REJECTION_MT / HOLD_MT | Numeric | MT | Separate disposition fields |
| Stoppage Code | STOPPAGE_CODE | Dropdown | — | Plant-wide coded master |
| Defect Code/Symbol | DEFECT_CODE | Dropdown | — | Plant-wide coded master |
| Operator/Crew/Helper | OPERATOR_CODE (role-tagged) | Dropdown | — | Repeatable crew sub-table |
| Time From/To/Total | TIME_FROM / TIME_TO / TIME_TOTAL_MIN | Time/Numeric | min | Total derived |

# 8. Keys, Relationships & Integrity

- **Traceability:** coil_process_history(coil_no, process_id) records each step; parent_coil_no links slit children to their source.
- **Header→detail:** every prod_* and sub-table references shift_log_id; deleting a draft cascades to its details.
- **Annealing grouping:** ann_charge_coil(charge_no, coil_no) is the many-to-many that resolves a furnace charge to its coils.
- **Masters:** all coded fields (customer, grade, defect, stoppage, surface finish, oil grade, furnace) are FK-enforced — no free-text codes.
- **Uniqueness:** shift_log is unique on (date, shift, process, mill_type); slit/pass rows unique within their parent entry.
- **Routing:** prod_crs.for_ctl_mt > 0 sets coil.next_dest = CTL, surfacing the coil in the CTL plan list.

# 9. Performance, Partitioning & BI Separation

- Transaction tables (shift_log, prod_*, audit_log) are partitioned by prod_date / month; old partitions archive cheaply.
- Indexes on coil_no, (prod_date, process_id), grade_code, status and audit (table, record_pk) support capture and traceability queries.
- A streaming read replica serves all reporting (M1-09) so analytics never blocks capture.
- JSONB columns (e.g. export params, audit old/new value) keep flexible data without widening core tables.

# 10. Companion DDL

The complete, runnable schema is delivered as **M1_schema.sql** (PostgreSQL 15+). It creates the six schemas and all forty tables in dependency order, with primary/foreign keys, CHECK constraints (including output-thk < input-thk and pickling/annealing guards), indexes, a generic audit trigger function, and seed rows for the process and role masters. It parses cleanly and every foreign key resolves to an earlier table, so it can be applied top-to-bottom on a fresh database.
