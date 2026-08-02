/** HRS multi-reading capture: thickness/taper/mother-width reading tables + latest columns. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_hrs_slit
      ADD COLUMN IF NOT EXISTS thk_latest_mm NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS taper_latest TEXT NULL;

    CREATE TABLE IF NOT EXISTS txn.prod_hrs_slit_reading (
      reading_id BIGSERIAL PRIMARY KEY,
      entry_id BIGINT NOT NULL REFERENCES txn.prod_hrs(entry_id) ON DELETE CASCADE,
      slot TEXT NOT NULL,
      reading_time TIMESTAMPTZ NOT NULL,
      thk_mm NUMERIC NULL,
      taper TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES security.tenant(tenant_id)
    );

    CREATE INDEX IF NOT EXISTS idx_prod_hrs_slit_reading_entry_slot_time
      ON txn.prod_hrs_slit_reading (entry_id, slot, reading_time);

    CREATE TABLE IF NOT EXISTS txn.prod_hrs_width_reading (
      reading_id BIGSERIAL PRIMARY KEY,
      entry_id BIGINT NOT NULL REFERENCES txn.prod_hrs(entry_id) ON DELETE CASCADE,
      reading_time TIMESTAMPTZ NOT NULL,
      actual_width_mm NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES security.tenant(tenant_id)
    );

    CREATE INDEX IF NOT EXISTS idx_prod_hrs_width_reading_entry_time
      ON txn.prod_hrs_width_reading (entry_id, reading_time);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS txn.prod_hrs_width_reading;
    DROP TABLE IF EXISTS txn.prod_hrs_slit_reading;
    ALTER TABLE txn.prod_hrs_slit
      DROP COLUMN IF EXISTS taper_latest,
      DROP COLUMN IF EXISTS thk_latest_mm;
  `);
};
