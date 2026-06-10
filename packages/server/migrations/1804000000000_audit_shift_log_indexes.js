/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit.audit_log(ts);
    CREATE INDEX IF NOT EXISTS ix_shiftlog_prod_date ON txn.shift_log(prod_date);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS audit.ix_audit_ts;
    DROP INDEX IF EXISTS txn.ix_shiftlog_prod_date;
  `);
};
