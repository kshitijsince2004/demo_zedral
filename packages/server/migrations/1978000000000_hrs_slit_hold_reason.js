/**
 * Per-slit Hold Order metadata on txn.prod_hrs_slit.
 * Mother txn.hrs_order stays the mill session; hold reason lives on the slot.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_hrs_slit
      ADD COLUMN IF NOT EXISTS hold_reason VARCHAR(100),
      ADD COLUMN IF NOT EXISTS hold_remarks VARCHAR(500),
      ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS held_by INTEGER REFERENCES security.app_user(user_id);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.prod_hrs_slit
      DROP COLUMN IF EXISTS held_by,
      DROP COLUMN IF EXISTS held_at,
      DROP COLUMN IF EXISTS hold_remarks,
      DROP COLUMN IF EXISTS hold_reason;
  `);
};
