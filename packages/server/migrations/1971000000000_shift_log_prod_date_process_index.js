/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ix_shiftlog_date_process_shift
      ON txn.shift_log (prod_date, process_id, shift_code);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.ix_shiftlog_date_process_shift;
  `);
};
