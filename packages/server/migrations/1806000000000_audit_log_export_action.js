/**
 * Export jobs write audit.audit_log rows with action = 'EXPORT' (ExportJobRunner).
 * Baseline schema only allowed INSERT/UPDATE/DELETE, causing export completion to fail.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
    ALTER TABLE audit.audit_log
      ADD CONSTRAINT audit_log_action_check
      CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'EXPORT'));
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
    ALTER TABLE audit.audit_log
      ADD CONSTRAINT audit_log_action_check
      CHECK (action IN ('INSERT', 'UPDATE', 'DELETE'));
  `);
};
