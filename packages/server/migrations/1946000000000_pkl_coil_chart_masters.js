/** PKL coil fields + chart masters + stoppage/defect seeds (plan §2 / §7 / §8). */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_pkl
      ADD COLUMN IF NOT EXISTS repeats INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS wp TEXT NULL CHECK (wp IS NULL OR wp IN ('W', 'P')),
      ADD COLUMN IF NOT EXISTS end_filling BOOLEAN NULL,
      ADD COLUMN IF NOT EXISTS ht TEXT NULL,
      ADD COLUMN IF NOT EXISTS mother_coil_no TEXT NULL,
      ADD COLUMN IF NOT EXISTS slit_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS customer TEXT NULL,
      ADD COLUMN IF NOT EXISTS grade_code TEXT NULL,
      ADD COLUMN IF NOT EXISTS route_raw TEXT NULL,
      ADD COLUMN IF NOT EXISTS status TEXT NULL,
      ADD COLUMN IF NOT EXISTS crew_ref TEXT NULL,
      ADD COLUMN IF NOT EXISTS total_time_min NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS ppc_weight_mt NUMERIC NULL;

    CREATE TABLE IF NOT EXISTS master.pkl_spec_limit (
      param_key TEXT NOT NULL,
      tank_scope TEXT NOT NULL DEFAULT 'LINE'
        CHECK (tank_scope IN ('T1','T2','T3','RINSE','LINE')),
      min_val NUMERIC NULL,
      max_val NUMERIC NULL,
      unit TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (param_key, tank_scope)
    );

    CREATE TABLE IF NOT EXISTS master.pkl_chart_config (
      config_id BIGSERIAL PRIMARY KEY,
      interval_hours NUMERIC NOT NULL DEFAULT 2,
      reading_labels JSONB NOT NULL DEFAULT '["1st","3rd","5th","7th"]'::jsonb,
      reminder_mode TEXT NOT NULL DEFAULT 'soft',
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    INSERT INTO master.pkl_chart_config (interval_hours, reading_labels, reminder_mode, is_active)
    SELECT 2, '["1st","3rd","5th","7th"]'::jsonb, 'soft', true
    WHERE NOT EXISTS (SELECT 1 FROM master.pkl_chart_config WHERE is_active);

    INSERT INTO master.pkl_spec_limit (param_key, tank_scope, min_val, max_val, unit) VALUES
      ('rinse_flow', 'RINSE', 20, 45, 'L/min'),
      ('tank_temp', 'T1', 65, 80, 'C'),
      ('tank_temp', 'T2', 65, 80, 'C'),
      ('tank_temp', 'T3', 50, 70, 'C'),
      ('rinse_temp', 'RINSE', 65, 85, 'C'),
      ('hot_air_temp', 'LINE', 110, 140, 'C'),
      ('steam_inlet', 'LINE', 4, 6, 'kg/cm2'),
      ('steam_outlet', 'LINE', 2, 3, 'kg/cm2'),
      ('acid_strength', 'T1', NULL, 4, '%'),
      ('acid_strength', 'T2', 4, 7, '%'),
      ('acid_strength', 'T3', 7, 12, '%'),
      ('acid_strength', 'RINSE', NULL, 0.10, '%'),
      ('iron_strength', 'T1', NULL, 17, '%'),
      ('iron_strength', 'T2', NULL, 11, '%'),
      ('iron_strength', 'T3', NULL, 6, '%'),
      ('iron_strength', 'RINSE', NULL, 0.15, '%'),
      ('burner_pressure', 'LINE', 5, 6, 'kg/cm2'),
      ('rinse_ph', 'RINSE', 6, NULL, 'pH'),
      ('rinse_cl', 'RINSE', NULL, 100, 'PPM'),
      ('tank_level', 'T1', NULL, 115, 'mm'),
      ('tank_level', 'T2', NULL, 115, 'mm'),
      ('tank_level', 'T3', NULL, 115, 'mm')
    ON CONFLICT (param_key, tank_scope) DO NOTHING;

    INSERT INTO master.stoppage_code (stoppage_code, description, category, is_planned, is_active)
    VALUES
      ('PKL-01', 'Mechanical', 'MECH', false, true),
      ('PKL-02', 'Electrical', 'ELECT', false, true),
      ('PKL-03', 'Crane', 'OPN', false, true),
      ('PKL-04', 'Work Roll Change', 'OPN', false, true),
      ('PKL-05', 'H.V/L.V', 'ELECT', false, true),
      ('PKL-06', 'B.U. Roll Change', 'OPN', false, true),
      ('PKL-07', 'Raw Material', 'OPN', true, true),
      ('PKL-08', 'Services', 'OPN', false, true),
      ('PKL-09', 'Preventive Maint.', 'MECH', true, true),
      ('PKL-10', 'Short of Man', 'OPN', true, true),
      ('PKL-11', 'Power Failure', 'ELECT', false, true),
      ('PKL-12', 'Operational', 'OPN', false, true),
      ('PKL-13', 'No Planning', 'OPN', true, true),
      ('PKL-14', 'Hydraulic', 'MECH', false, true),
      ('PKL-15', 'Mtl. short due to Crane B/D', 'OPN', false, true)
    ON CONFLICT (stoppage_code) DO NOTHING;

    INSERT INTO master.defect_code (defect_code, symbol, description, applies_to, is_active)
    VALUES
      ('PKL-02', 'EC', 'Edge Cut', 'PKL', true),
      ('PKL-03', 'SL', 'Slivers', 'PKL', true),
      ('PKL-05', 'SM', 'Seamline', 'PKL', true),
      ('PKL-06', 'SC', 'Scratches', 'PKL', true),
      ('PKL-07', 'RS', 'Rusty', 'PKL', true),
      ('PKL-09', 'H', 'Holes', 'PKL', true),
      ('PKL-11', 'BP', 'Black Patches', 'PKL', true),
      ('PKL-16', 'W', 'Waviness', 'PKL', true),
      ('PKL-17', 'LM', 'Lamination', 'PKL', true),
      ('PKL-18', 'PT', 'Pitting', 'PKL', true),
      ('PKL-20', 'RIS', 'Rolled-in-Scale', 'PKL', true),
      ('PKL-21', 'WV', 'Width Variation', 'PKL', true),
      ('PKL-23', 'BK', 'Buckling', 'PKL', true),
      ('PKL-32', 'FM', 'Folding Marks', 'PKL', true),
      ('PKL-39', 'HP', 'Hump', 'PKL', true),
      ('PKL-42', 'CM', 'Cutter Mark', 'PKL', true),
      ('PKL-43', 'UP', 'Under Pickled', 'PKL', true),
      ('PKL-44', 'YS', 'Yellow Stain', 'PKL', true)
    ON CONFLICT (defect_code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM master.defect_code WHERE defect_code LIKE 'PKL-%';
    DELETE FROM master.stoppage_code WHERE stoppage_code LIKE 'PKL-%' AND stoppage_code NOT IN ('PKL-OPN','PKL-ACID');
    DROP TABLE IF EXISTS master.pkl_chart_config;
    DROP TABLE IF EXISTS master.pkl_spec_limit;
    ALTER TABLE txn.prod_pkl
      DROP COLUMN IF EXISTS repeats,
      DROP COLUMN IF EXISTS wp,
      DROP COLUMN IF EXISTS end_filling,
      DROP COLUMN IF EXISTS ht,
      DROP COLUMN IF EXISTS mother_coil_no,
      DROP COLUMN IF EXISTS slit_id,
      DROP COLUMN IF EXISTS customer,
      DROP COLUMN IF EXISTS grade_code,
      DROP COLUMN IF EXISTS route_raw,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS crew_ref,
      DROP COLUMN IF EXISTS total_time_min,
      DROP COLUMN IF EXISTS ppc_weight_mt;
  `);
};
