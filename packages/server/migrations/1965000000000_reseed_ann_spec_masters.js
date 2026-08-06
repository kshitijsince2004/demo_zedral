/** Re-seed ANN Bases + WI limits (plan §5.1 / §5.6, WI p.7–10). Idempotent. */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO master.ann_base (base_no, capacity_max_coils, capacity_max_wt_mt, soak_time_adj_hr, is_active)
    SELECT v.base_no, 12, 40, v.adj, true
    FROM (VALUES
      ('AB01', 1), ('AB02', 0), ('AB03', 0), ('AB04', 0),
      ('AB05', 0), ('AB06', 1), ('AB07', 0), ('AB08', 0),
      ('AB09', 0), ('AB10', 0), ('AB11', 0), ('AB12', 0),
      ('AB13', 0), ('AB14', 0), ('AB15', 0), ('AB16', 0)
    ) AS v(base_no, adj)
    ON CONFLICT (base_no) DO UPDATE SET
      capacity_max_coils = EXCLUDED.capacity_max_coils,
      capacity_max_wt_mt = EXCLUDED.capacity_max_wt_mt,
      soak_time_adj_hr = EXCLUDED.soak_time_adj_hr,
      is_active = true;

    INSERT INTO master.ann_spec_limit (param_key, scope, min_val, max_val, unit, is_active) VALUES
      ('soak_temp', 'RR', 650, 710, 'C', true),
      ('soak_time', 'RR', 8, 12, 'hr', true),
      ('soak_temp', 'D', 610, 670, 'C', true),
      ('soak_time', 'D', 4, 8, 'hr', true),
      ('furnace_cool_min_hr', 'ALL', 2, NULL, 'hr', true),
      ('rapid_cool_start_max', 'ALL', NULL, 450, 'C', true),
      ('water_cool_start_max', 'ALL', NULL, 375, 'C', true),
      ('purge_o2_max', 'ALL', NULL, 0.5, '%', true),
      ('tightness_drop_max', 'ALL', NULL, 50, 'mmWC', true),
      ('clubbing_soak_spread', 'ALL', 10, 30, 'C', true)
    ON CONFLICT (param_key, scope) DO UPDATE SET
      min_val = EXCLUDED.min_val,
      max_val = EXCLUDED.max_val,
      unit = EXCLUDED.unit,
      is_active = true;
  `);
};

exports.down = () => {};
