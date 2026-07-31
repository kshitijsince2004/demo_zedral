/** ANN stages/readings/stoppages + CRUD masters (plan §4–§5). */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.ann_charge
      ADD COLUMN IF NOT EXISTS annealing_batch_no TEXT NULL,
      ADD COLUMN IF NOT EXISTS cooling_hood_id INTEGER NULL,
      ADD COLUMN IF NOT EXISTS ann_cycle_code TEXT NULL,
      ADD COLUMN IF NOT EXISTS height_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS tightness_drop_mmwc NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS total_h2_flow_cycle NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS soak_temp_degc NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS soak_time_hr NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS total_active_min NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS total_idle_min NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS charged_condition TEXT NULL,
      ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER NULL,
      ADD COLUMN IF NOT EXISTS current_stage_code TEXT NULL;

    ALTER TABLE txn.ann_charge_coil
      ADD COLUMN IF NOT EXISTS disposition TEXT NOT NULL DEFAULT 'ADVANCE'
        CHECK (disposition IN ('ADVANCE', 'HOLD', 'REJECT')),
      ADD COLUMN IF NOT EXISTS unload_remark TEXT NULL;

    CREATE TABLE IF NOT EXISTS master.ann_cooling_hood (
      cooling_hood_id SERIAL PRIMARY KEY,
      hood_code TEXT NOT NULL UNIQUE,
      name TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS master.ann_base (
      base_no TEXT PRIMARY KEY,
      capacity_max_coils INTEGER NULL,
      capacity_max_wt_mt NUMERIC NULL,
      capacity_max_height_mm NUMERIC NULL,
      soak_time_adj_hr NUMERIC NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS master.ann_stage (
      stage_code TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      label TEXT NOT NULL,
      is_skippable BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS master.ann_spec_limit (
      param_key TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'ALL',
      min_val NUMERIC NULL,
      max_val NUMERIC NULL,
      unit TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (param_key, scope)
    );

    CREATE TABLE IF NOT EXISTS master.ann_stoppage_category (
      category_code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS master.ann_reading_config (
      config_id BIGSERIAL PRIMARY KEY,
      interval_min NUMERIC NOT NULL DEFAULT 120,
      reminder_enabled BOOLEAN NOT NULL DEFAULT true,
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS txn.ann_charge_stage (
      stage_id BIGSERIAL PRIMARY KEY,
      charge_no TEXT NOT NULL REFERENCES txn.ann_charge(charge_no),
      stage_code TEXT NOT NULL REFERENCES master.ann_stage(stage_code),
      seq INTEGER NOT NULL,
      start_at TIMESTAMPTZ NULL,
      end_at TIMESTAMPTZ NULL,
      duration_min NUMERIC NULL,
      transition_temp_degc NUMERIC NULL,
      skipped BOOLEAN NOT NULL DEFAULT false,
      skip_authorized_by INTEGER NULL,
      skip_reason TEXT NULL,
      started_by_user_id INTEGER NULL,
      UNIQUE (charge_no, stage_code)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_ann_charge_one_active_stage
      ON txn.ann_charge_stage (charge_no)
      WHERE start_at IS NOT NULL AND end_at IS NULL AND skipped = false;

    CREATE TABLE IF NOT EXISTS txn.ann_charge_reading (
      reading_id BIGSERIAL PRIMARY KEY,
      charge_no TEXT NOT NULL REFERENCES txn.ann_charge(charge_no),
      base_no TEXT NULL,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      stage_code TEXT NULL,
      shift_code TEXT NULL,
      operator_user_id INTEGER NULL,
      charge_temp NUMERIC NULL,
      gas_temp NUMERIC NULL,
      fc_temp NUMERIC NULL,
      n2h2_flow NUMERIC NULL,
      base_press NUMERIC NULL,
      base_fan_rpm NUMERIC NULL,
      fuel_flow NUMERIC NULL,
      rcf_rpm NUMERIC NULL
    );

    CREATE TABLE IF NOT EXISTS txn.ann_charge_stoppage (
      stoppage_id BIGSERIAL PRIMARY KEY,
      charge_no TEXT NOT NULL REFERENCES txn.ann_charge(charge_no),
      base_no TEXT NULL,
      category_code TEXT NOT NULL REFERENCES master.ann_stoppage_category(category_code),
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NULL,
      duration_min NUMERIC NULL,
      reason TEXT NULL,
      remark TEXT NULL
    );

    INSERT INTO master.ann_stage (stage_code, seq, label, is_skippable) VALUES
      ('LOADING', 1, 'Loading', false),
      ('PURGING', 2, 'Purging', false),
      ('HEATING', 3, 'Heating', false),
      ('SOAKING', 4, 'Soaking', false),
      ('FURNACE_COOL', 5, 'Furnace Cool', false),
      ('NATURAL_COOL', 6, 'Natural Cool', false),
      ('RAPID_COOL', 7, 'Rapid Cool', true),
      ('WATER_COOL', 8, 'Water Cool', true),
      ('POST_PURGING', 9, 'Post Purging', false),
      ('UNLOADING', 10, 'Unloading', false)
    ON CONFLICT (stage_code) DO NOTHING;

    INSERT INTO master.ann_base (base_no, capacity_max_coils, capacity_max_wt_mt, soak_time_adj_hr)
    SELECT v.base_no, 12, 40, v.adj
    FROM (VALUES
      ('AB01', 1), ('AB02', 0), ('AB03', 0), ('AB04', 0),
      ('AB05', 0), ('AB06', 1), ('AB07', 0), ('AB08', 0),
      ('AB09', 0), ('AB10', 0), ('AB11', 0), ('AB12', 0),
      ('AB13', 0), ('AB14', 0), ('AB15', 0), ('AB16', 0)
    ) AS v(base_no, adj)
    WHERE NOT EXISTS (SELECT 1 FROM master.ann_base b WHERE b.base_no = v.base_no);

    INSERT INTO master.ann_spec_limit (param_key, scope, min_val, max_val, unit) VALUES
      ('soak_temp', 'RR', 650, 710, 'C'),
      ('soak_time', 'RR', 8, 12, 'hr'),
      ('soak_temp', 'D', 610, 670, 'C'),
      ('soak_time', 'D', 4, 8, 'hr'),
      ('furnace_cool_min_hr', 'ALL', 2, NULL, 'hr'),
      ('rapid_cool_start_max', 'ALL', NULL, 450, 'C'),
      ('water_cool_start_max', 'ALL', NULL, 375, 'C'),
      ('purge_o2_max', 'ALL', NULL, 0.5, '%'),
      ('tightness_drop_max', 'ALL', NULL, 50, 'mmWC'),
      ('clubbing_soak_spread', 'ALL', 10, 30, 'C')
    ON CONFLICT (param_key, scope) DO NOTHING;

    INSERT INTO master.ann_stoppage_category (category_code, description) VALUES
      ('BASE_FAN', 'Base Fan'),
      ('BASE_SEAL', 'Base Seal'),
      ('BASE_CLAMP', 'Base Clamp'),
      ('BASE_WATER', 'Base Water'),
      ('THERMOCOUPLE', 'Thermocouple'),
      ('CA_BLOWER', 'CA Blower'),
      ('POWER', 'Power'),
      ('GAS_SUPPLY', 'Gas Supply'),
      ('CRANE', 'Crane'),
      ('OTHER', 'Other / Give Details')
    ON CONFLICT (category_code) DO NOTHING;

    INSERT INTO master.ann_reading_config (interval_min, reminder_enabled, is_active)
    SELECT 120, true, true
    WHERE NOT EXISTS (SELECT 1 FROM master.ann_reading_config WHERE is_active);

    INSERT INTO master.ann_cooling_hood (hood_code, name)
    SELECT v.code, v.name FROM (VALUES
      ('CH01', 'Cooling Hood 1'), ('CH02', 'Cooling Hood 2'),
      ('CH03', 'Cooling Hood 3'), ('CH04', 'Cooling Hood 4')
    ) AS v(code, name)
    WHERE NOT EXISTS (SELECT 1 FROM master.ann_cooling_hood h WHERE h.hood_code = v.code);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS txn.ann_charge_stoppage;
    DROP TABLE IF EXISTS txn.ann_charge_reading;
    DROP TABLE IF EXISTS txn.ann_charge_stage;
    DROP TABLE IF EXISTS master.ann_reading_config;
    DROP TABLE IF EXISTS master.ann_stoppage_category;
    DROP TABLE IF EXISTS master.ann_spec_limit;
    DROP TABLE IF EXISTS master.ann_stage;
    DROP TABLE IF EXISTS master.ann_base;
    DROP TABLE IF EXISTS master.ann_cooling_hood;
    ALTER TABLE txn.ann_charge_coil
      DROP COLUMN IF EXISTS disposition,
      DROP COLUMN IF EXISTS unload_remark;
    ALTER TABLE txn.ann_charge
      DROP COLUMN IF EXISTS annealing_batch_no,
      DROP COLUMN IF EXISTS cooling_hood_id,
      DROP COLUMN IF EXISTS ann_cycle_code,
      DROP COLUMN IF EXISTS height_mm,
      DROP COLUMN IF EXISTS tightness_drop_mmwc,
      DROP COLUMN IF EXISTS total_h2_flow_cycle,
      DROP COLUMN IF EXISTS soak_temp_degc,
      DROP COLUMN IF EXISTS soak_time_hr,
      DROP COLUMN IF EXISTS total_active_min,
      DROP COLUMN IF EXISTS total_idle_min,
      DROP COLUMN IF EXISTS charged_condition,
      DROP COLUMN IF EXISTS created_by_user_id,
      DROP COLUMN IF EXISTS current_stage_code;
  `);
};
