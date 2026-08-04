/** Drop stale duplicate export_job_type_check (export_job_export_type_check is canonical). */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.export_job DROP CONSTRAINT IF EXISTS export_job_type_check;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.export_job DROP CONSTRAINT IF EXISTS export_job_type_check;
    ALTER TABLE audit.export_job
      ADD CONSTRAINT export_job_type_check
      CHECK (export_type IN ('DPR', 'LINE_LOG', 'COIL_TRACE', 'RAW', 'REJECTED_ORDERS', 'SHIFT_SUMMARY'));
  `);
};
