/**
 * Hold sessions must not block the mill unique open-session index.
 * ON_HOLD stays in the Hold queue; machine can run other work until release/start.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.uq_manual_reroll_session_active_machine;
    CREATE UNIQUE INDEX uq_manual_reroll_session_active_machine
      ON txn.manual_reroll_session (machine_code)
      WHERE status IN ('IN_PROGRESS','STOPPAGE');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.uq_manual_reroll_session_active_machine;
    CREATE UNIQUE INDEX uq_manual_reroll_session_active_machine
      ON txn.manual_reroll_session (machine_code)
      WHERE status IN ('IN_PROGRESS','ON_HOLD','STOPPAGE');
  `);
};
