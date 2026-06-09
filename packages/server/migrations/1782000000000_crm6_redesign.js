exports.up = (pgm) => {
  pgm.sql(`
    -- CRM 6HI as first-class production line
    INSERT INTO master.process (process_id, code, name, seq_no, has_mill_type)
    VALUES (31, 'CRM6', 'CRM 6HI', 31, FALSE)
    ON CONFLICT (process_id) DO NOTHING;

    -- Machine registry (extensible to 4HI / 2HI)
    CREATE TABLE IF NOT EXISTS master.machine (
        machine_code  VARCHAR(8)  PRIMARY KEY,
        process_id    SMALLINT    REFERENCES master.process(process_id),
        name          VARCHAR(40) NOT NULL
    );

    INSERT INTO master.machine (machine_code, process_id, name) VALUES
    ('6HI', 31, 'CRM 6HI'),
    ('4HI', NULL, 'CRM 4HI'),
    ('2HI', NULL, 'CRM 2HI')
    ON CONFLICT (machine_code) DO NOTHING;

    -- Sub-processes within CRM 6HI
    CREATE TABLE IF NOT EXISTS master.crm_sub_process (
        sub_process_code  VARCHAR(16) PRIMARY KEY,
        name              VARCHAR(40) NOT NULL,
        machine_code      VARCHAR(8)  NOT NULL REFERENCES master.machine(machine_code)
    );

    INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
    ('ROLLING', 'Rolling', '6HI'),
    ('SKIN_PASS', 'Skin Pass', '6HI')
    ON CONFLICT (sub_process_code) DO NOTHING;

    -- Stoppage categories (order-level)
    CREATE TABLE IF NOT EXISTS master.stoppage_category (
        category_code             VARCHAR(20) PRIMARY KEY,
        label                     VARCHAR(60) NOT NULL,
        requires_breakdown_code   BOOLEAN NOT NULL DEFAULT FALSE
    );

    INSERT INTO master.stoppage_category (category_code, label, requires_breakdown_code) VALUES
    ('BREAKDOWN', 'Breakdown', TRUE),
    ('WR_CHANGE', 'Work Roll Change', FALSE),
    ('MATERIAL', 'Material Issue', FALSE),
    ('POWER', 'Power Failure', FALSE),
    ('SETUP', 'Setup', FALSE),
    ('QUALITY_HOLD', 'Quality Hold', FALSE)
    ON CONFLICT (category_code) DO NOTHING;

    -- PPC batch planning (source of truth for CRM6 queue)
    CREATE TABLE IF NOT EXISTS planning.ppc_batch (
        batch_id          BIGSERIAL    PRIMARY KEY,
        batch_number      VARCHAR(30)  NOT NULL UNIQUE,
        plan_date         DATE         NOT NULL,
        shift_code        VARCHAR(4)   NOT NULL REFERENCES master.shift(shift_code),
        machine_code      VARCHAR(8)   NOT NULL REFERENCES master.machine(machine_code),
        sub_process       VARCHAR(16)  NOT NULL REFERENCES master.crm_sub_process(sub_process_code),
        coil_no           VARCHAR(30)  NOT NULL,
        slit_id           VARCHAR(20),
        customer_name     VARCHAR(120) NOT NULL,
        grade_code        VARCHAR(20)  NOT NULL REFERENCES master.grade(grade_code),
        width_mm          NUMERIC(7,2) NOT NULL,
        ppc_thk_mm        NUMERIC(6,3) NOT NULL,
        ppc_weight_mt     NUMERIC(9,3) NOT NULL,
        destination       VARCHAR(16)  CHECK (destination IN ('REWINDING','ANNEALING')),
        roll_finish       VARCHAR(12)  CHECK (roll_finish IN ('MATT','BRIGHT','LOW_MATT')),
        ppc_reroll_flag   BOOLEAN      DEFAULT FALSE,
        queue_seq         INTEGER,
        sap_order_no      VARCHAR(30),
        import_batch_id   BIGINT       REFERENCES planning.import_batch(import_batch_id),
        raw_row_json      JSONB,
        imported_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_ppc_batch_queue
      ON planning.ppc_batch (plan_date, shift_code, machine_code, sub_process, queue_seq);

    -- Unified CRM6 production order
    CREATE TABLE IF NOT EXISTS txn.crm6_order (
        order_id            BIGSERIAL    PRIMARY KEY,
        shift_log_id        BIGINT       REFERENCES txn.shift_log(shift_log_id),
        batch_id            BIGINT       NOT NULL UNIQUE REFERENCES planning.ppc_batch(batch_id),
        batch_number        VARCHAR(30)  NOT NULL,
        coil_no             VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
        slit_id             VARCHAR(20),
        customer_name       VARCHAR(120) NOT NULL,
        grade_code          VARCHAR(20)  NOT NULL,
        width_mm            NUMERIC(7,2) NOT NULL,
        ppc_thk_mm          NUMERIC(6,3) NOT NULL,
        ppc_weight_mt       NUMERIC(9,3) NOT NULL,
        sub_process         VARCHAR(16)  NOT NULL,
        status              VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','IN_PROGRESS','STOPPAGE','COMPLETED')),
        prod_start_at       TIMESTAMPTZ,
        prod_end_at         TIMESTAMPTZ,
        prod_duration_min   INTEGER,
        logged_in_user_id   INTEGER      REFERENCES security.app_user(user_id),
        production_day      DATE,
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_crm6_order_queue
      ON txn.crm6_order (shift_log_id, sub_process, status);

    -- Rolling extension
    CREATE TABLE IF NOT EXISTS txn.crm6_rolling (
        order_id              BIGINT PRIMARY KEY REFERENCES txn.crm6_order(order_id) ON DELETE CASCADE,
        actual_weight_mt      NUMERIC(9,3),
        destination           VARCHAR(16) CHECK (destination IN ('REWINDING','ANNEALING')),
        destination_override  BOOLEAN DEFAULT FALSE,
        associate_rw          VARCHAR(20),
        etr                   NUMERIC(6,2),
        dtr                   NUMERIC(6,2),
        roll_finish           VARCHAR(12),
        rerolling             BOOLEAN DEFAULT FALSE,
        roll_in_no            VARCHAR(20),
        roll_in_code          VARCHAR(20),
        roll_out_no           VARCHAR(20),
        roll_out_code         VARCHAR(20),
        total_passes          SMALLINT,
        final_thk_mm          NUMERIC(6,3)
    );

    CREATE TABLE IF NOT EXISTS txn.crm6_rolling_pass (
        pass_id         BIGSERIAL PRIMARY KEY,
        order_id        BIGINT NOT NULL REFERENCES txn.crm6_rolling(order_id) ON DELETE CASCADE,
        pass_no         SMALLINT NOT NULL,
        thickness_mm    NUMERIC(6,3) NOT NULL,
        UNIQUE (order_id, pass_no)
    );

    -- Skin Pass extension
    CREATE TABLE IF NOT EXISTS txn.crm6_skinpass (
        order_id            BIGINT PRIMARY KEY REFERENCES txn.crm6_order(order_id) ON DELETE CASCADE,
        actual_weight_mt    NUMERIC(9,3),
        output_thk_mm       NUMERIC(6,3),
        ann_hard            NUMERIC(6,2),
        rw_tension_1        NUMERIC(8,2),
        rw_tension_2        NUMERIC(8,2),
        operating_mode      VARCHAR(8) CHECK (operating_mode IN ('LOAD','STRETCH')),
        load_min_t          NUMERIC(8,2),
        load_max_t          NUMERIC(8,2),
        stretch_pct         NUMERIC(5,2)
    );

    -- Order-level stoppage
    CREATE TABLE IF NOT EXISTS txn.order_stoppage (
        stoppage_id       BIGSERIAL PRIMARY KEY,
        order_id          BIGINT NOT NULL REFERENCES txn.crm6_order(order_id) ON DELETE CASCADE,
        category_code     VARCHAR(20) NOT NULL REFERENCES master.stoppage_category(category_code),
        breakdown_code    VARCHAR(16) REFERENCES master.stoppage_code(stoppage_code),
        start_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        end_at            TIMESTAMPTZ,
        duration_min      INTEGER,
        remarks           VARCHAR(200)
    );

    CREATE INDEX IF NOT EXISTS ix_order_stoppage_open
      ON txn.order_stoppage (order_id) WHERE end_at IS NULL;

    -- Order remarks (multiple, timestamped)
    CREATE TABLE IF NOT EXISTS txn.order_remark (
        remark_id     BIGSERIAL PRIMARY KEY,
        order_id      BIGINT NOT NULL REFERENCES txn.crm6_order(order_id) ON DELETE CASCADE,
        text          VARCHAR(500) NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        operator_id   INTEGER REFERENCES security.app_user(user_id)
    );

    -- Roll change audit
    CREATE TABLE IF NOT EXISTS txn.crm_roll_change (
        change_id       BIGSERIAL PRIMARY KEY,
        order_id        BIGINT NOT NULL REFERENCES txn.crm6_order(order_id) ON DELETE CASCADE,
        roll_position   VARCHAR(4) NOT NULL CHECK (roll_position IN ('IN','OUT')),
        prev_roll_no    VARCHAR(20),
        prev_roll_code  VARCHAR(20),
        new_roll_no     VARCHAR(20) NOT NULL,
        new_roll_code   VARCHAR(20),
        changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        operator_id     INTEGER REFERENCES security.app_user(user_id)
    );

    -- End-of-shift summary
    CREATE TABLE IF NOT EXISTS txn.crm6_shift_summary (
        summary_id          BIGSERIAL PRIMARY KEY,
        shift_log_id        BIGINT NOT NULL UNIQUE REFERENCES txn.shift_log(shift_log_id),
        total_prod_mt       NUMERIC(11,3),
        total_rolling_mt    NUMERIC(11,3),
        total_reroll_mt     NUMERIC(11,3),
        total_skinpass_mt   NUMERIC(11,3),
        scrap_kg            NUMERIC(9,2),
        coolant_temp_degc   NUMERIC(5,2),
        coolant_press_kgcm2 NUMERIC(6,2),
        submitted_at        TIMESTAMPTZ,
        submitted_by        INTEGER REFERENCES security.app_user(user_id)
    );

    -- Expand crew roles
    ALTER TABLE txn.crew_entry DROP CONSTRAINT IF EXISTS crew_entry_role_code_check;
    ALTER TABLE txn.crew_entry ADD CONSTRAINT crew_entry_role_code_check
      CHECK (role_code IN (
        'OPERATOR','CRANE','SHIFT_INCHARGE','SHIFT_MANAGER','HELPER','ASST','MTL'
      ));

    -- Grant CRM6 line access to users who have CRM access
    INSERT INTO security.line_access (user_id, process_id, access_level)
    SELECT la.user_id, 31, la.access_level
    FROM security.line_access la
    INNER JOIN master.process p ON la.process_id = p.process_id
    WHERE p.code = 'CRM'
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS txn.crm6_shift_summary;
    DROP TABLE IF EXISTS txn.crm_roll_change;
    DROP TABLE IF EXISTS txn.order_remark;
    DROP TABLE IF EXISTS txn.order_stoppage;
    DROP TABLE IF EXISTS txn.crm6_skinpass;
    DROP TABLE IF EXISTS txn.crm6_rolling_pass;
    DROP TABLE IF EXISTS txn.crm6_rolling;
    DROP TABLE IF EXISTS txn.crm6_order;
    DROP TABLE IF EXISTS planning.ppc_batch;
    DROP TABLE IF EXISTS master.stoppage_category;
    DROP TABLE IF EXISTS master.crm_sub_process;
    DROP TABLE IF EXISTS master.machine;
    DELETE FROM security.line_access WHERE process_id = 31;
    DELETE FROM master.process WHERE code = 'CRM6';

    ALTER TABLE txn.crew_entry DROP CONSTRAINT IF EXISTS crew_entry_role_code_check;
    ALTER TABLE txn.crew_entry ADD CONSTRAINT crew_entry_role_code_check
      CHECK (role_code IN ('OPERATOR','ASST','HELPER','CRANE','MTL'));
  `);
};
