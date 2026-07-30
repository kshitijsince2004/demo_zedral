/** Allow QC_FAILS export type on audit.export_job. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.export_job DROP CONSTRAINT IF EXISTS export_job_export_type_check;
    ALTER TABLE audit.export_job
      ADD CONSTRAINT export_job_export_type_check
      CHECK (export_type IN ('DPR', 'LINE_LOG', 'COIL_TRACE', 'RAW', 'REJECTED_ORDERS', 'SHIFT_SUMMARY', 'QC_FAILS'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM audit.export_job WHERE export_type = 'QC_FAILS';
    ALTER TABLE audit.export_job DROP CONSTRAINT IF EXISTS export_job_export_type_check;
    ALTER TABLE audit.export_job
      ADD CONSTRAINT export_job_export_type_check
      CHECK (export_type IN ('DPR', 'LINE_LOG', 'COIL_TRACE', 'RAW', 'REJECTED_ORDERS', 'SHIFT_SUMMARY'));
  `);
};
