/** Additive: ANN stoppage delay_bucket for shift-review classes. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.ann_stoppage_category
      ADD COLUMN IF NOT EXISTS delay_bucket TEXT;

    UPDATE master.ann_stoppage_category SET delay_bucket = v.bucket
    FROM (VALUES
      ('BASE_FAN', 'MECH'),
      ('BASE_SEAL', 'MECH'),
      ('BASE_CLAMP', 'MECH'),
      ('CA_BLOWER', 'MECH'),
      ('THERMOCOUPLE', 'ELECT'),
      ('BASE_WATER', 'UTILITY'),
      ('GAS_SUPPLY', 'UTILITY'),
      ('POWER', 'POWER FAILURE'),
      ('CRANE', 'OPN'),
      ('OTHER', 'OPN')
    ) AS v(code, bucket)
    WHERE master.ann_stoppage_category.category_code = v.code;

    UPDATE master.ann_stoppage_category
    SET delay_bucket = 'OPN'
    WHERE delay_bucket IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.ann_stoppage_category DROP COLUMN IF EXISTS delay_bucket;
  `);
};
