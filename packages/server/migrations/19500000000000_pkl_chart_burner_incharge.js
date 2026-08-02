/** PKL chart: steam outlet-of-burner + line incharge (revamp §8). */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_pkl_chart
      ADD COLUMN IF NOT EXISTS steam_outlet_burner_kgcm2 NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS line_incharge TEXT NULL;

    INSERT INTO master.pkl_spec_limit (param_key, tank_scope, min_val, max_val, unit) VALUES
      ('steam_outlet_burner', 'LINE', NULL, NULL, 'kg/cm2')
    ON CONFLICT (param_key, tank_scope) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_pkl_chart
      DROP COLUMN IF EXISTS steam_outlet_burner_kgcm2,
      DROP COLUMN IF EXISTS line_incharge;
    DELETE FROM master.pkl_spec_limit WHERE param_key = 'steam_outlet_burner' AND tank_scope = 'LINE';
  `);
};
