/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.machine
      ADD COLUMN IF NOT EXISTS ocr_min_confidence NUMERIC(5, 2);

    ALTER TABLE txn.crm_rolling
      ADD COLUMN IF NOT EXISTS actual_weight_source TEXT,
      ADD COLUMN IF NOT EXISTS actual_weight_photo_hash TEXT,
      ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(5, 2),
      ADD COLUMN IF NOT EXISTS ocr_raw_text TEXT;

    ALTER TABLE txn.crm_skinpass
      ADD COLUMN IF NOT EXISTS actual_weight_source TEXT,
      ADD COLUMN IF NOT EXISTS actual_weight_photo_hash TEXT,
      ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(5, 2),
      ADD COLUMN IF NOT EXISTS ocr_raw_text TEXT;

    CREATE INDEX IF NOT EXISTS idx_crm_rolling_photo_hash
      ON txn.crm_rolling (actual_weight_photo_hash)
      WHERE actual_weight_photo_hash IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_crm_skinpass_photo_hash
      ON txn.crm_skinpass (actual_weight_photo_hash)
      WHERE actual_weight_photo_hash IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.idx_crm_skinpass_photo_hash;
    DROP INDEX IF EXISTS txn.idx_crm_rolling_photo_hash;

    ALTER TABLE txn.crm_skinpass
      DROP COLUMN IF EXISTS ocr_raw_text,
      DROP COLUMN IF EXISTS ocr_confidence,
      DROP COLUMN IF EXISTS actual_weight_photo_hash,
      DROP COLUMN IF EXISTS actual_weight_source;

    ALTER TABLE txn.crm_rolling
      DROP COLUMN IF EXISTS ocr_raw_text,
      DROP COLUMN IF EXISTS ocr_confidence,
      DROP COLUMN IF EXISTS actual_weight_photo_hash,
      DROP COLUMN IF EXISTS actual_weight_source;

    ALTER TABLE master.machine
      DROP COLUMN IF EXISTS ocr_min_confidence;
  `);
};
