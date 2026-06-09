exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE security.app_user
      ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(200),
      ADD COLUMN IF NOT EXISTS pin_failed_attempts SMALLINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE security.app_user
      DROP COLUMN IF EXISTS pin_locked_until,
      DROP COLUMN IF EXISTS pin_failed_attempts,
      DROP COLUMN IF EXISTS pin_hash;
  `);
};
