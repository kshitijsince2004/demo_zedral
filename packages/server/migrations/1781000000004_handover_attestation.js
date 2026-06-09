exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.shift_log
      ADD COLUMN IF NOT EXISTS handover_notes VARCHAR(500),
      ADD COLUMN IF NOT EXISTS handover_outgoing_user_id INTEGER REFERENCES security.app_user(user_id),
      ADD COLUMN IF NOT EXISTS handover_incoming_user_id INTEGER REFERENCES security.app_user(user_id),
      ADD COLUMN IF NOT EXISTS handover_at TIMESTAMPTZ;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.shift_log
      DROP COLUMN IF EXISTS handover_notes,
      DROP COLUMN IF EXISTS handover_outgoing_user_id,
      DROP COLUMN IF EXISTS handover_incoming_user_id,
      DROP COLUMN IF EXISTS handover_at;
  `);
};
