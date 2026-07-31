/** CRS per-line fan-out columns on prod_crs_slit + pass input weight. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_crs
      ADD COLUMN IF NOT EXISTS input_wt_mt NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS setting_count INTEGER NULL,
      ADD COLUMN IF NOT EXISTS scrap_mt NUMERIC NULL;

    ALTER TABLE txn.prod_crs_slit
      ADD COLUMN IF NOT EXISTS slit_no TEXT NULL,
      ADD COLUMN IF NOT EXISTS finish_width_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS no_of_slit INTEGER NULL,
      ADD COLUMN IF NOT EXISTS actual_width_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS actual_thk_front_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS actual_thk_rear_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS output_wt_mt NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS scrap_mt NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS rejection_od_mt NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS rejection_id_mt NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS hold_flag BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS for_ctl_flag BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS route_code TEXT NULL,
      ADD COLUMN IF NOT EXISTS sap_batch_number TEXT NULL,
      ADD COLUMN IF NOT EXISTS camber_waviness TEXT NULL,
      ADD COLUMN IF NOT EXISTS ra_um NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS rz_um NUMERIC NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_crs
      DROP COLUMN IF EXISTS input_wt_mt,
      DROP COLUMN IF EXISTS setting_count,
      DROP COLUMN IF EXISTS scrap_mt;

    ALTER TABLE txn.prod_crs_slit
      DROP COLUMN IF EXISTS slit_no,
      DROP COLUMN IF EXISTS finish_width_mm,
      DROP COLUMN IF EXISTS no_of_slit,
      DROP COLUMN IF EXISTS actual_width_mm,
      DROP COLUMN IF EXISTS actual_thk_front_mm,
      DROP COLUMN IF EXISTS actual_thk_rear_mm,
      DROP COLUMN IF EXISTS output_wt_mt,
      DROP COLUMN IF EXISTS scrap_mt,
      DROP COLUMN IF EXISTS rejection_od_mt,
      DROP COLUMN IF EXISTS rejection_id_mt,
      DROP COLUMN IF EXISTS hold_flag,
      DROP COLUMN IF EXISTS for_ctl_flag,
      DROP COLUMN IF EXISTS route_code,
      DROP COLUMN IF EXISTS sap_batch_number,
      DROP COLUMN IF EXISTS camber_waviness,
      DROP COLUMN IF EXISTS ra_um,
      DROP COLUMN IF EXISTS rz_um;
  `);
};
