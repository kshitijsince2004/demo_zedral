/**
 * Enforce at most one ACTIVE machine_shift_session per machine.
 * Closes duplicate ACTIVE rows (keeps newest started_at per machine) before adding the index.
 */
exports.up = (pgm) => {
  pgm.sql(`
    WITH ranked AS (
      SELECT session_id,
             ROW_NUMBER() OVER (
               PARTITION BY machine_code
               ORDER BY started_at DESC, session_id DESC
             ) AS rn
      FROM txn.machine_shift_session
      WHERE status = 'ACTIVE'
    )
    UPDATE txn.machine_shift_session s
    SET status = 'CLOSED',
        closed_at = COALESCE(s.closed_at, now())
    FROM ranked r
    WHERE s.session_id = r.session_id
      AND r.rn > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS ux_machine_shift_session_one_active
      ON txn.machine_shift_session (machine_code)
      WHERE status = 'ACTIVE';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.ux_machine_shift_session_one_active;
  `);
};
