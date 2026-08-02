-- =====================================================================
-- HERO STEELS LIMITED  -  Cold Rolling Steel Plant
-- Module M1 - Data Capture Layer
-- Physical Data Model (PostgreSQL 15+)
-- Companion to: 04 - Data Model & Database Design
-- Conventions: snake_case identifiers; units embedded in column names;
--              weight stored in MT plant-wide; UPPER_SNAKE used in docs.
-- =====================================================================

-- ---------- Schemas (logical separation; see Database Architecture) ----------
CREATE SCHEMA IF NOT EXISTS master;     -- shared reference / master data
CREATE SCHEMA IF NOT EXISTS coil;       -- coil identity & traceability spine
CREATE SCHEMA IF NOT EXISTS txn;        -- shift logs & process capture
CREATE SCHEMA IF NOT EXISTS planning;   -- PP&C / SAP-sourced plan data
CREATE SCHEMA IF NOT EXISTS security;   -- users, roles, line scoping
CREATE SCHEMA IF NOT EXISTS audit;      -- audit trail & change control

-- =====================================================================
-- 1. MASTER / REFERENCE TABLES   (build once, reused by every form)
-- =====================================================================

CREATE TABLE master.process (
    process_id      SMALLINT     PRIMARY KEY,
    code            VARCHAR(8)   NOT NULL UNIQUE,          -- HRS, PKL, CRM, ANN, SKP, RWD, CRS, CTL
    name            VARCHAR(40)  NOT NULL,
    seq_no          SMALLINT     NOT NULL,                 -- position in line sequence
    has_mill_type   BOOLEAN      NOT NULL DEFAULT FALSE    -- TRUE for Cold Rolling Mill (2HI/4HI/6HI)
);

CREATE TABLE master.shift (
    shift_code      VARCHAR(4)   PRIMARY KEY,              -- A / B / C / GEN
    name            VARCHAR(20)  NOT NULL,
    start_time      TIME         NOT NULL,
    end_time        TIME         NOT NULL
);

CREATE TABLE master.customer (
    customer_id     SERIAL       PRIMARY KEY,
    customer_code   VARCHAR(20)  NOT NULL UNIQUE,          -- sourced from SAP/ERP
    customer_name   VARCHAR(120) NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE master.grade (
    grade_code      VARCHAR(20)  PRIMARY KEY,              -- e.g. CRCA, HROP, D513
    description     VARCHAR(120),
    grade_family    VARCHAR(20),                           -- HROP / CRCA ... (drives pickling speed band)
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE master.surface_finish (
    surface_finish  VARCHAR(8)   PRIMARY KEY,              -- M (Matt) / B (Bright)
    description      VARCHAR(40)
);

CREATE TABLE master.defect_code (
    defect_code     VARCHAR(16)  PRIMARY KEY,              -- unified plant-wide list
    symbol          VARCHAR(8),
    description     VARCHAR(120) NOT NULL,
    applies_to      VARCHAR(60),                           -- comma list of process codes
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE master.stoppage_code (
    stoppage_code   VARCHAR(16)  PRIMARY KEY,              -- unified plant-wide list
    description     VARCHAR(120) NOT NULL,
    category        VARCHAR(20)  NOT NULL                  -- OPN/ELECT/MECH/UTILITY/POWER/PLANNED
                    CHECK (category IN ('OPN','ELECT','MECH','UTILITY','POWER','PLANNED','OTHER')),
    is_planned      BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE master.operator (
    operator_id     SERIAL       PRIMARY KEY,
    emp_code        VARCHAR(20)  NOT NULL UNIQUE,
    full_name       VARCHAR(80)  NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE master.furnace (
    furnace_id      SMALLINT     PRIMARY KEY,
    code            VARCHAR(12)  NOT NULL UNIQUE,
    name            VARCHAR(40),
    furnace_type    VARCHAR(20)  DEFAULT 'HPH'             -- batch / HPH annealing
);

CREATE TABLE master.rp_oil_grade (
    rp_oil_grade    VARCHAR(20)  PRIMARY KEY,              -- rust-preventive oil grades (CRS)
    description     VARCHAR(80)
);

-- Customer/grade quality specification (drives quality-vs-spec validation)
CREATE TABLE master.grade_spec (
    spec_id         SERIAL       PRIMARY KEY,
    grade_code      VARCHAR(20)  NOT NULL REFERENCES master.grade(grade_code),
    customer_id     INTEGER      REFERENCES master.customer(customer_id),  -- NULL = default
    hardness_hrb_min  NUMERIC(6,2),
    hardness_hrb_max  NUMERIC(6,2),
    uts_nmm2_min      NUMERIC(7,2),
    uts_nmm2_max      NUMERIC(7,2),
    elongation_pct_min NUMERIC(5,2),
    ra_um_max         NUMERIC(6,3),
    UNIQUE (grade_code, customer_id)
);

-- =====================================================================
-- 2. COIL MASTER  -  traceability spine (COIL_NO end-to-end)
-- =====================================================================

CREATE TABLE coil.coil (
    coil_no         VARCHAR(30)  PRIMARY KEY,              -- single normalised identity
    parent_coil_no  VARCHAR(30)  REFERENCES coil.coil(coil_no),  -- HR slitting parent -> child slit coils
    customer_id     INTEGER      REFERENCES master.customer(customer_id),
    grade_code      VARCHAR(20)  REFERENCES master.grade(grade_code),
    surface_finish  VARCHAR(8)   REFERENCES master.surface_finish(surface_finish),
    heat_no         VARCHAR(30),                           -- HT (from pickling/source)
    nominal_width_mm  NUMERIC(7,2),
    coil_width_mm     NUMERIC(7,2),
    coil_thk_mm       NUMERIC(6,3),                        -- current/input thickness
    weight_mt         NUMERIC(9,3),
    current_process_id SMALLINT  REFERENCES master.process(process_id),
    next_dest         VARCHAR(8),                          -- routing flag (e.g. CTL via For-CTL)
    status            VARCHAR(20) NOT NULL DEFAULT 'PLANNED'
                      CHECK (status IN ('PLANNED','IN_PROCESS','HOLD','REWORK','DONE','SCRAPPED')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_coil_customer ON coil.coil(customer_id);
CREATE INDEX ix_coil_grade    ON coil.coil(grade_code);
CREATE INDEX ix_coil_status   ON coil.coil(status);

-- One row per (coil, process) - the chain of custody / current location
CREATE TABLE coil.coil_process_history (
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    process_id      SMALLINT     NOT NULL REFERENCES master.process(process_id),
    entered_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    in_thk_mm       NUMERIC(6,3),
    out_thk_mm      NUMERIC(6,3),
    out_weight_mt   NUMERIC(9,3),
    PRIMARY KEY (coil_no, process_id)
);

-- =====================================================================
-- 2B. SECURITY / RBAC  (created early: referenced by shift_log & planning)
-- =====================================================================

CREATE TABLE security.app_user (
    user_id         SERIAL       PRIMARY KEY,
    username        VARCHAR(40)  NOT NULL UNIQUE,
    full_name       VARCHAR(80)  NOT NULL,
    email           VARCHAR(120),
    emp_code        VARCHAR(20),
    auth_subject    VARCHAR(120),                          -- OIDC subject (SSO)
    status          VARCHAR(12)  NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','DISABLED','LOCKED')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE security.role (
    role_id         SMALLINT     PRIMARY KEY,
    role_name       VARCHAR(30)  NOT NULL UNIQUE,          -- OPERATOR/SUPERVISOR/PLANT_HEAD/ADMIN
    description     VARCHAR(120)
);

CREATE TABLE security.user_role (
    user_id         INTEGER      NOT NULL REFERENCES security.app_user(user_id) ON DELETE CASCADE,
    role_id         SMALLINT     NOT NULL REFERENCES security.role(role_id),
    PRIMARY KEY (user_id, role_id)
);

-- Row-level line scoping: which processes/lines a user may access
CREATE TABLE security.line_access (
    user_id         INTEGER      NOT NULL REFERENCES security.app_user(user_id) ON DELETE CASCADE,
    process_id      SMALLINT     NOT NULL REFERENCES master.process(process_id),
    access_level    VARCHAR(10)  NOT NULL DEFAULT 'WRITE'
                    CHECK (access_level IN ('READ','WRITE','APPROVE')),
    PRIMARY KEY (user_id, process_id)
);

-- =====================================================================
-- 3. SHIFT LOG (transaction header) + shared sub-tables
-- =====================================================================

CREATE TABLE txn.shift_log (
    shift_log_id    BIGSERIAL    PRIMARY KEY,
    prod_date       DATE         NOT NULL,
    shift_code      VARCHAR(4)   NOT NULL REFERENCES master.shift(shift_code),
    process_id      SMALLINT     NOT NULL REFERENCES master.process(process_id),
    mill_type       VARCHAR(8)   CHECK (mill_type IN ('2HI','4HI','6HI')),  -- CRM only
    target_mt       NUMERIC(9,3),
    total_prod_mt   NUMERIC(9,3),                          -- derived = sum of entries
    line_incharge_id INTEGER     REFERENCES master.operator(operator_id),
    shift_manager_id INTEGER     REFERENCES master.operator(operator_id),
    approver_id     INTEGER      REFERENCES security.app_user(user_id),
    state           VARCHAR(16)  NOT NULL DEFAULT 'DRAFT'
                    CHECK (state IN ('DRAFT','SUBMITTED','APPROVED','REOPENED')),
    submitted_at    TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,
    prev_shift_log_id BIGINT     REFERENCES txn.shift_log(shift_log_id), -- handover link
    UNIQUE (prod_date, shift_code, process_id, mill_type)
);
CREATE INDEX ix_shiftlog_date ON txn.shift_log(prod_date, process_id);

CREATE TABLE txn.stoppage_entry (
    stoppage_id     BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    stoppage_code   VARCHAR(16)  NOT NULL REFERENCES master.stoppage_code(stoppage_code),
    time_from       TIME         NOT NULL,
    time_to         TIME         NOT NULL,
    duration_min    INTEGER,                               -- derived
    remarks         VARCHAR(200)
);

CREATE TABLE txn.crew_entry (
    crew_id         BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    operator_id     INTEGER      NOT NULL REFERENCES master.operator(operator_id),
    role_code       VARCHAR(16)  NOT NULL                  -- OPERATOR/ASST/HELPER/CRANE/MTL
                    CHECK (role_code IN ('OPERATOR','ASST','HELPER','CRANE','MTL'))
);

-- =====================================================================
-- 4. PER-PROCESS CAPTURE TABLES  (modular: one table per process)
--    All carry coil_no (spine) and shift_log_id (header).
-- =====================================================================

-- 4.1 HR Slitting (M1-HRS-01)
CREATE TABLE txn.prod_hrs (
    entry_id        BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    sl_no           SMALLINT,
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    nominal_width_mm NUMERIC(7,2),
    actual_width_mm  NUMERIC(7,2),
    nominal_thk_mm   NUMERIC(6,3),
    weight_mt        NUMERIC(9,3),
    actual_slit_width_from_mm NUMERIC(7,2),
    actual_slit_width_to_mm   NUMERIC(7,2),
    scrap_mt         NUMERIC(9,3),
    scrap_pct        NUMERIC(5,2),                          -- derived = scrap/total
    time_from        TIME,
    time_to          TIME,
    remarks          VARCHAR(200),
    CHECK (actual_width_mm IS NULL OR nominal_width_mm IS NULL OR actual_width_mm <= nominal_width_mm)
);

-- Slit-combination builder (A-D) - repeatable child of an HRS entry
CREATE TABLE txn.prod_hrs_slit (
    slit_id         BIGSERIAL    PRIMARY KEY,
    entry_id        BIGINT       NOT NULL REFERENCES txn.prod_hrs(entry_id) ON DELETE CASCADE,
    slot            CHAR(1)      NOT NULL CHECK (slot IN ('A','B','C','D')),
    width_mm        NUMERIC(7,2),
    thk_mm          NUMERIC(6,3),
    taper           VARCHAR(20),
    child_coil_no   VARCHAR(30)  REFERENCES coil.coil(coil_no)
);

-- 4.2 Pickling - coil log (M1-PKL-01)
CREATE TABLE txn.prod_pkl (
    entry_id        BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    sl_no           SMALLINT,
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    width_mm        NUMERIC(7,2),
    thk_mm          NUMERIC(6,3),
    weight_mt       NUMERIC(9,3),
    line_speed_mpm  NUMERIC(6,2),
    heat_no         VARCHAR(30),
    source          VARCHAR(40),
    wip             VARCHAR(20),
    leader_end      VARCHAR(20),
    time_from       TIME,
    time_to         TIME,
    remarks         VARCHAR(200)
);

-- 4.2b Pickling - hourly process chart (M1-PKL-02) time-series
CREATE TABLE txn.prod_pkl_chart (
    chart_id        BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    chart_time      TIME         NOT NULL,
    tank_no         SMALLINT     CHECK (tank_no BETWEEN 1 AND 3),   -- T1..T3
    tank_level      NUMERIC(6,2),
    tank_temp_degc  NUMERIC(5,2),
    acid_strength_pct NUMERIC(5,2),
    iron_strength_pct NUMERIC(5,2),
    steam_inlet_kgcm2  NUMERIC(6,2),
    steam_outlet_kgcm2 NUMERIC(6,2),
    dosage_acid     NUMERIC(8,2),
    dosage_water    NUMERIC(8,2),
    dosage_inhibitor NUMERIC(8,2),
    rinse_cl        NUMERIC(6,2),
    rinse_ph        NUMERIC(4,2),
    rinse_flow      NUMERIC(8,2),
    rinse_temp_degc NUMERIC(5,2),
    rinse_acid_pct  NUMERIC(5,2),
    rinse_iron_pct  NUMERIC(5,2),
    burner_pressure_kgcm2 NUMERIC(6,2),
    hot_air_temp_degc NUMERIC(5,2)
);

-- 4.3 Cold Rolling Mill (2HI/4HI/6HI) (M1-CRM-01)
CREATE TABLE txn.prod_crm (
    entry_id        BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    sl_no           SMALLINT,
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    width_mm        NUMERIC(7,2),
    input_thk_mm    NUMERIC(6,3),
    output_thk_mm   NUMERIC(6,3),
    weight_mt       NUMERIC(9,3),
    ann_hardness    NUMERIC(6,2),
    rw_tension_kg   NUMERIC(8,2),
    hardness_vpn    NUMERIC(6,2),
    hardness_hrb    NUMERIC(6,2),
    elongation_pct  NUMERIC(5,2),
    loss_pct        NUMERIC(5,2),
    stretch_pct     NUMERIC(5,2),
    roll_in         VARCHAR(20),
    roll_out        VARCHAR(20),
    tkg_weight_mt   NUMERIC(9,3),
    oil_level_initial NUMERIC(8,2),
    oil_level_final   NUMERIC(8,2),
    oil_consumption   NUMERIC(8,2),
    scrap_mt        NUMERIC(9,3),
    time_from       TIME,
    time_to         TIME,
    remarks         VARCHAR(200),
    CHECK (output_thk_mm IS NULL OR input_thk_mm IS NULL OR output_thk_mm < input_thk_mm)
);

-- 4.4 Annealing (M1-ANN-01): charge/base header + coil grouping
CREATE TABLE txn.ann_charge (
    charge_no       VARCHAR(30)  PRIMARY KEY,
    base_no         VARCHAR(30),
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id),
    furnace_id      SMALLINT     REFERENCES master.furnace(furnace_id),
    grade_code      VARCHAR(20)  REFERENCES master.grade(grade_code),
    no_of_coils     SMALLINT,
    charge_wt_mt    NUMERIC(9,3),                          -- derived = sum coil weights
    status          VARCHAR(20)  CHECK (status IN ('IN_PROCESS','FOR_ANN','RW','DONE')),
    dew_point_n2    NUMERIC(6,2),
    dew_point_h2    NUMERIC(6,2),
    temperature_degc NUMERIC(6,2),
    exp_unloading_time TIMESTAMPTZ,
    unloading_wt_mt NUMERIC(9,3),
    loading_mt      NUMERIC(9,3),
    unloading_mt    NUMERIC(9,3),
    cumm_loading_mt NUMERIC(11,3),
    cumm_unloading_mt NUMERIC(11,3)
);

CREATE TABLE txn.ann_charge_coil (
    charge_no       VARCHAR(30)  NOT NULL REFERENCES txn.ann_charge(charge_no) ON DELETE CASCADE,
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    seq_no          SMALLINT,
    PRIMARY KEY (charge_no, coil_no)
);

-- 4.5 Skin Pass (M1-SKP-01)
CREATE TABLE txn.prod_skp (
    entry_id        BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    sl_no           SMALLINT,
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    width_mm        NUMERIC(7,2),
    thk_mm          NUMERIC(6,3),
    final_thk_mm    NUMERIC(6,3),
    total_passes    SMALLINT,
    weight_mt       NUMERIC(9,3),
    rw_tension_kg   NUMERIC(8,2),
    surface_finish  VARCHAR(8)   REFERENCES master.surface_finish(surface_finish),
    re_rolling      BOOLEAN      DEFAULT FALSE,
    hold_mt         NUMERIC(9,3),
    rejection_mt    NUMERIC(9,3),
    wt_rolling_mt   NUMERIC(9,3),
    wt_reroll_mt    NUMERIC(9,3),
    wt_skinpass_mt  NUMERIC(9,3),
    wt_scrap_mt     NUMERIC(9,3),
    rolls_in        VARCHAR(20),
    rolls_out       VARCHAR(20),
    coolant_temp_degc NUMERIC(5,2),
    coolant_press_kgcm2 NUMERIC(6,2),
    remarks         VARCHAR(200)
);

CREATE TABLE txn.prod_skp_pass (
    pass_id         BIGSERIAL    PRIMARY KEY,
    entry_id        BIGINT       NOT NULL REFERENCES txn.prod_skp(entry_id) ON DELETE CASCADE,
    pass_no         SMALLINT     NOT NULL CHECK (pass_no BETWEEN 1 AND 6),
    thickness_mm    NUMERIC(6,3),
    UNIQUE (entry_id, pass_no)
);

-- 4.6 Rewinding (M1-RWD-01)
CREATE TABLE txn.prod_rwd (
    entry_id        BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    sl_no           SMALLINT,
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    width_mm        NUMERIC(7,2),
    thk_mm          NUMERIC(6,3),
    output_thk_mm   NUMERIC(6,3),
    weight_mt       NUMERIC(9,3),
    rw_tension_1_kg NUMERIC(8,2),
    rw_tension_2_kg NUMERIC(8,2),
    rw_tension_3_kg NUMERIC(8,2),
    surface_finish  VARCHAR(8)   REFERENCES master.surface_finish(surface_finish),
    time_from       TIME,
    time_to         TIME,
    remarks         VARCHAR(200)
);

-- 4.7 CRS / CR Slitter (M1-CRS-01)
CREATE TABLE txn.prod_crs (
    entry_id        BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    sl_no           SMALLINT,
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    slit_no         VARCHAR(20),
    coil_width_mm   NUMERIC(7,2),
    nominal_thk_mm  NUMERIC(6,3),
    actual_width_mm NUMERIC(7,2),
    actual_thk_front_mm NUMERIC(6,3),
    actual_thk_rear_mm  NUMERIC(6,3),
    hardness_vpn    NUMERIC(6,2),
    hardness_hrb    NUMERIC(6,2),
    ib_tiecv        VARCHAR(20),
    uts_nmm2        NUMERIC(7,2),
    elongation_pct  NUMERIC(5,2),
    ysr_burr        VARCHAR(20),
    camber_waviness VARCHAR(20),
    ra_um           NUMERIC(6,3),
    rz_um           NUMERIC(6,3),
    output_wt_mt    NUMERIC(9,3),
    rejection_od_mt NUMERIC(9,3),
    rejection_id_mt NUMERIC(9,3),
    coating_wt_br   NUMERIC(8,3),
    coating_wt_matt NUMERIC(8,3),
    rp_oil_grade    VARCHAR(20)  REFERENCES master.rp_oil_grade(rp_oil_grade),
    hold_mt         NUMERIC(9,3),
    for_ctl_mt      NUMERIC(9,3),                          -- routing flag -> CTL
    remarks         VARCHAR(200)
);

CREATE TABLE txn.prod_crs_slit (
    slit_id         BIGSERIAL    PRIMARY KEY,
    entry_id        BIGINT       NOT NULL REFERENCES txn.prod_crs(entry_id) ON DELETE CASCADE,
    slot            CHAR(1)      CHECK (slot IN ('A','B','C','D')),
    width_mm        NUMERIC(7,2),
    child_coil_no   VARCHAR(30)  REFERENCES coil.coil(coil_no)
);

-- 4.8 CTL / Cut-to-Length (M1-CTL-01)
CREATE TABLE txn.prod_ctl (
    entry_id        BIGSERIAL    PRIMARY KEY,
    shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
    sl_no           SMALLINT,
    coil_no         VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
    width_mm        NUMERIC(7,2),
    thk_mm          NUMERIC(6,3),
    weight_mt       NUMERIC(9,3),                          -- stored MT (kg input converted)
    nominal_set_length_mm NUMERIC(9,2),
    actual_length_mm      NUMERIC(9,2),
    no_pieces       INTEGER,
    no_bundles      INTEGER,
    total_prod_mt   NUMERIC(9,3),
    hold_mt         NUMERIC(9,3),
    rejection_mt    NUMERIC(9,3),
    low_speed       VARCHAR(20),
    estimated_suppressed VARCHAR(20),
    time_from       TIME,
    time_to         TIME,
    remarks         VARCHAR(200)
);

-- Generic defect entry (links to any process entry via process + entry_id)
CREATE TABLE txn.defect_entry (
    defect_id       BIGSERIAL    PRIMARY KEY,
    process_id      SMALLINT     NOT NULL REFERENCES master.process(process_id),
    entry_id        BIGINT       NOT NULL,                 -- soft ref to the process table PK
    coil_no         VARCHAR(30)  REFERENCES coil.coil(coil_no),
    defect_code     VARCHAR(16)  NOT NULL REFERENCES master.defect_code(defect_code),
    location        VARCHAR(40),
    qty_mt          NUMERIC(9,3)
);
CREATE INDEX ix_defect_entry ON txn.defect_entry(process_id, entry_id);

-- =====================================================================
-- 5. PLANNING (PP&C / SAP-sourced)  -  feeds auto-population
-- =====================================================================

CREATE TABLE planning.import_batch (
    import_batch_id BIGSERIAL    PRIMARY KEY,
    source          VARCHAR(20)  NOT NULL CHECK (source IN ('CSV','SAP','MANUAL')),
    file_name       VARCHAR(200),
    row_count       INTEGER,
    error_count     INTEGER      DEFAULT 0,
    status          VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','VALIDATED','LOADED','FAILED','PARTIAL')),
    imported_by     INTEGER      REFERENCES security.app_user(user_id),
    imported_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE planning.plan_order (
    plan_order_id   BIGSERIAL    PRIMARY KEY,
    sap_order_no    VARCHAR(30)  UNIQUE,
    customer_id     INTEGER      REFERENCES master.customer(customer_id),
    grade_code      VARCHAR(20)  REFERENCES master.grade(grade_code),
    surface_finish  VARCHAR(8)   REFERENCES master.surface_finish(surface_finish),
    target_width_mm NUMERIC(7,2),
    target_thk_mm   NUMERIC(6,3),
    planned_qty_mt  NUMERIC(11,3),
    due_date        DATE,
    import_batch_id BIGINT       REFERENCES planning.import_batch(import_batch_id)
);

CREATE TABLE planning.coil_plan (
    coil_plan_id    BIGSERIAL    PRIMARY KEY,
    plan_order_id   BIGINT       REFERENCES planning.plan_order(plan_order_id),
    coil_no         VARCHAR(30)  REFERENCES coil.coil(coil_no),
    planned_process_id SMALLINT  REFERENCES master.process(process_id),
    seq_no          SMALLINT,
    planned_date    DATE
);

-- =====================================================================
-- 7. AUDIT & CHANGE CONTROL   (security/RBAC tables created in 2B above)
-- =====================================================================

CREATE TABLE audit.audit_log (
    audit_id        BIGSERIAL    PRIMARY KEY,
    table_name      VARCHAR(80)  NOT NULL,
    record_pk       VARCHAR(120) NOT NULL,
    action          VARCHAR(8)   NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
    column_name     VARCHAR(80),
    old_value       TEXT,
    new_value       TEXT,
    user_id         INTEGER      REFERENCES security.app_user(user_id),
    change_request_id BIGINT,
    ts              TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_tbl ON audit.audit_log(table_name, record_pk);
CREATE INDEX ix_audit_ts  ON audit.audit_log(ts);

CREATE TABLE audit.change_request (
    cr_id           BIGSERIAL    PRIMARY KEY,
    table_name      VARCHAR(80)  NOT NULL,
    record_pk       VARCHAR(120) NOT NULL,
    requested_by    INTEGER      NOT NULL REFERENCES security.app_user(user_id),
    approved_by     INTEGER      REFERENCES security.app_user(user_id),
    reason          VARCHAR(300) NOT NULL,
    state           VARCHAR(16)  NOT NULL DEFAULT 'REQUESTED'
                    CHECK (state IN ('REQUESTED','APPROVED','REJECTED','APPLIED')),
    requested_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    decided_at      TIMESTAMPTZ
);

-- Temporary export feature (interim until SAP round-trip is live)
CREATE TABLE audit.export_job (
    export_id       BIGSERIAL    PRIMARY KEY,
    scope           VARCHAR(40)  NOT NULL,                 -- process / date-range / coil
    params_json     JSONB,
    format          VARCHAR(8)   NOT NULL CHECK (format IN ('CSV','XLSX')),
    requested_by    INTEGER      REFERENCES security.app_user(user_id),
    row_count       INTEGER,
    file_path       VARCHAR(300),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- =====================================================================
-- 8. EXAMPLE GENERIC AUDIT TRIGGER (attach to each txn table)
-- =====================================================================
CREATE OR REPLACE FUNCTION audit.fn_audit() RETURNS trigger AS $$
DECLARE pk TEXT;
BEGIN
    pk := COALESCE(NEW.entry_id::text, OLD.entry_id::text, '');
    IF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit.audit_log(table_name, record_pk, action, new_value, old_value, ts)
        VALUES (TG_TABLE_NAME, pk, 'UPDATE', row_to_json(NEW)::text, row_to_json(OLD)::text, now());
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO audit.audit_log(table_name, record_pk, action, new_value, ts)
        VALUES (TG_TABLE_NAME, COALESCE(NEW.entry_id::text,''), 'INSERT', row_to_json(NEW)::text, now());
        RETURN NEW;
    ELSE
        INSERT INTO audit.audit_log(table_name, record_pk, action, old_value, ts)
        VALUES (TG_TABLE_NAME, COALESCE(OLD.entry_id::text,''), 'DELETE', row_to_json(OLD)::text, now());
        RETURN OLD;
    END IF;
END; $$ LANGUAGE plpgsql;

-- Example attachment (repeat per process table):
-- CREATE TRIGGER trg_audit_prod_crm AFTER INSERT OR UPDATE OR DELETE
--   ON txn.prod_crm FOR EACH ROW EXECUTE FUNCTION audit.fn_audit();

-- =====================================================================
-- 9. SEED: process master (line sequence)
-- =====================================================================
INSERT INTO master.process(process_id, code, name, seq_no, has_mill_type) VALUES
 (1,'HRS','HR Slitting',1,FALSE),
 (2,'PKL','Pickling',2,FALSE),
 (3,'CRM','Cold Rolling Mill',3,TRUE),
 (4,'ANN','Annealing',4,FALSE),
 (5,'SKP','Skin Pass Mill',5,FALSE),
 (6,'RWD','Rewinding',6,FALSE),
 (7,'CRS','CRS (CR Slitter)',7,FALSE),
 (8,'CTL','Cut to Length',8,FALSE);

INSERT INTO security.role(role_id, role_name, description) VALUES
 (1,'OPERATOR','Enters/edits own shift data on assigned line'),
 (2,'SUPERVISOR','Reviews & approves entries across multiple lines'),
 (3,'PLANT_HEAD','Read-only analytics across all lines'),
 (4,'ADMIN','User, role, master-data, integration & workflow config');
-- END OF SCHEMA
