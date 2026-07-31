/** HRS slit fan-out fields + stoppage/defect seeds (plan §2 / §6). */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_hrs
      ADD COLUMN IF NOT EXISTS mother_coil_weight_mt NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS source TEXT NULL,
      ADD COLUMN IF NOT EXISTS grade_code TEXT NULL,
      ADD COLUMN IF NOT EXISTS net_runtime_min NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS status TEXT NULL,
      ADD COLUMN IF NOT EXISTS crew_ref TEXT NULL,
      ADD COLUMN IF NOT EXISTS setting_count INTEGER NULL,
      ADD COLUMN IF NOT EXISTS spec_version_id BIGINT NULL;

    ALTER TABLE txn.prod_hrs_slit
      ADD COLUMN IF NOT EXISTS target_width_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS actual_width_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS planned_weight_mt NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS actual_weight_mt NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS planned_thk_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS thk_id_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS thk_centre_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS thk_od_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS customer TEXT NULL,
      ADD COLUMN IF NOT EXISTS sap_batch_number TEXT NULL,
      ADD COLUMN IF NOT EXISTS surface_finish TEXT NULL,
      ADD COLUMN IF NOT EXISTS finish_thickness_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS route_raw TEXT NULL,
      ADD COLUMN IF NOT EXISTS resolved_next_step TEXT NULL,
      ADD COLUMN IF NOT EXISTS downstream_crs_combination TEXT NULL,
      ADD COLUMN IF NOT EXISTS hold_flag BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS for_ctl_flag BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS qc_measurement_ref TEXT NULL;

    -- Backfill target from legacy width_mm
    UPDATE txn.prod_hrs_slit
      SET target_width_mm = width_mm
      WHERE target_width_mm IS NULL AND width_mm IS NOT NULL;

    INSERT INTO master.stoppage_code (stoppage_code, description, category, is_planned, is_active)
    VALUES
      ('HRS-01', 'Mechanical', 'MECH', false, true),
      ('HRS-02', 'Electrical', 'ELECT', false, true),
      ('HRS-03', 'Crane', 'OPN', false, true),
      ('HRS-04', 'Raw Material', 'OPN', true, true),
      ('HRS-05', 'Opt. Service', 'OPN', false, true),
      ('HRS-06', 'Preventive Maintenance', 'MECH', true, true),
      ('HRS-07', 'Man Power Shortage', 'OPN', true, true),
      ('HRS-08', 'Power failure', 'ELECT', false, true),
      ('HRS-09', 'Operational', 'OPN', false, true),
      ('HRS-10', 'No Planning', 'OPN', true, true),
      ('HRS-11', 'Mtl. Short due to crane under b/d', 'OPN', false, true),
      ('HRS-12', 'Setting Adjustment', 'OPN', false, true),
      ('HRS-13', 'Give Details', 'OPN', false, true)
    ON CONFLICT (stoppage_code) DO NOTHING;

    INSERT INTO master.defect_code (defect_code, symbol, description, applies_to, is_active)
    VALUES
      ('HRS-01', 'OG', 'Over thickness', 'HRS', true),
      ('HRS-02', 'UG', 'Under thickness', 'HRS', true),
      ('HRS-03', 'SNC', 'Scrap not cut', 'HRS', true),
      ('HRS-04', 'EB', 'Edge bend', 'HRS', true),
      ('HRS-05', 'S', 'Silver', 'HRS', true),
      ('HRS-06', 'H', 'Holes', 'HRS', true),
      ('HRS-07', 'C', 'Fire Cracks', 'HRS', true),
      ('HRS-08', 'F', 'Cutter mark', 'HRS', true),
      ('HRS-09', 'EC', 'Edge cut', 'HRS', true),
      ('HRS-10', 'W', 'Weaving', 'HRS', true),
      ('HRS-11', 'T', 'Taper', 'HRS', true),
      ('HRS-12', 'R', 'Rolled in Scale', 'HRS', true),
      ('HRS-13', 'S', 'Seamlines', 'HRS', true),
      ('HRS-14', 'E', 'Pitting', 'HRS', true),
      ('HRS-15', 'BIR', 'Burr', 'HRS', true),
      ('HRS-16', 'SC', 'Scratches', 'HRS', true)
    ON CONFLICT (defect_code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM master.defect_code WHERE defect_code ~ '^HRS-0[1-9]$|^HRS-1[0-6]$';
    DELETE FROM master.stoppage_code WHERE stoppage_code ~ '^HRS-0[1-9]$|^HRS-1[0-3]$';
    ALTER TABLE txn.prod_hrs
      DROP COLUMN IF EXISTS mother_coil_weight_mt,
      DROP COLUMN IF EXISTS source,
      DROP COLUMN IF EXISTS grade_code,
      DROP COLUMN IF EXISTS net_runtime_min,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS crew_ref,
      DROP COLUMN IF EXISTS setting_count,
      DROP COLUMN IF EXISTS spec_version_id;
    ALTER TABLE txn.prod_hrs_slit
      DROP COLUMN IF EXISTS target_width_mm,
      DROP COLUMN IF EXISTS actual_width_mm,
      DROP COLUMN IF EXISTS planned_weight_mt,
      DROP COLUMN IF EXISTS actual_weight_mt,
      DROP COLUMN IF EXISTS planned_thk_mm,
      DROP COLUMN IF EXISTS thk_id_mm,
      DROP COLUMN IF EXISTS thk_centre_mm,
      DROP COLUMN IF EXISTS thk_od_mm,
      DROP COLUMN IF EXISTS customer,
      DROP COLUMN IF EXISTS sap_batch_number,
      DROP COLUMN IF EXISTS surface_finish,
      DROP COLUMN IF EXISTS finish_thickness_mm,
      DROP COLUMN IF EXISTS route_raw,
      DROP COLUMN IF EXISTS resolved_next_step,
      DROP COLUMN IF EXISTS downstream_crs_combination,
      DROP COLUMN IF EXISTS hold_flag,
      DROP COLUMN IF EXISTS for_ctl_flag,
      DROP COLUMN IF EXISTS qc_measurement_ref;
  `);
};
