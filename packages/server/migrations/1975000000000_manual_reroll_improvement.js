/**
 * Manual Re-Roll improvement: cancel open 2HI sessions; parity + thickness columns; overlay index.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE txn.manual_reroll_session
    SET status = 'CANCELLED',
        end_time = COALESCE(end_time, now()),
        updated_at = now()
    WHERE machine_code = '2HI'
      AND status IN ('PREPARING', 'IN_PROGRESS', 'ON_HOLD', 'STOPPAGE');

    ALTER TABLE txn.manual_reroll_session
      ADD COLUMN IF NOT EXISTS input_thk_mm NUMERIC(8,4),
      ADD COLUMN IF NOT EXISTS target_thk_mm NUMERIC(8,4),
      ADD COLUMN IF NOT EXISTS destination VARCHAR(16),
      ADD COLUMN IF NOT EXISTS destination_override BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS etr NUMERIC,
      ADD COLUMN IF NOT EXISTS dtr NUMERIC;

    CREATE INDEX IF NOT EXISTS idx_manual_reroll_session_batch_completed
      ON txn.manual_reroll_session (batch_number)
      WHERE status = 'COMPLETED';
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.idx_manual_reroll_session_batch_completed;

    ALTER TABLE txn.manual_reroll_session
      DROP COLUMN IF EXISTS dtr,
      DROP COLUMN IF EXISTS etr,
      DROP COLUMN IF EXISTS destination_override,
      DROP COLUMN IF EXISTS destination,
      DROP COLUMN IF EXISTS target_thk_mm,
      DROP COLUMN IF EXISTS input_thk_mm;
  `);
};
