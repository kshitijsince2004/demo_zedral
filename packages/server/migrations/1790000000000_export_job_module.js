/** M1 Export Module — extend audit.export_job for async jobs and artifact metadata. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.export_job
      ADD COLUMN IF NOT EXISTS export_type VARCHAR(16) NOT NULL DEFAULT 'RAW',
      ADD COLUMN IF NOT EXISTS job_status VARCHAR(16) NOT NULL DEFAULT 'done',
      ADD COLUMN IF NOT EXISTS progress SMALLINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS error_message TEXT,
      ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64),
      ADD COLUMN IF NOT EXISTS data_version VARCHAR(64),
      ADD COLUMN IF NOT EXISTS artifact_bytes BIGINT,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

    ALTER TABLE audit.export_job
      DROP CONSTRAINT IF EXISTS export_job_format_check;

    ALTER TABLE audit.export_job
      ADD CONSTRAINT export_job_format_check
      CHECK (format IN ('CSV', 'XLSX', 'PDF'));

    ALTER TABLE audit.export_job
      ADD CONSTRAINT export_job_status_check
      CHECK (job_status IN ('queued', 'running', 'done', 'error'));

    ALTER TABLE audit.export_job
      ADD CONSTRAINT export_job_type_check
      CHECK (export_type IN ('DPR', 'LINE_LOG', 'COIL_TRACE', 'RAW'));

    UPDATE audit.export_job
    SET job_status = CASE WHEN file_path IS NOT NULL THEN 'done' ELSE 'error' END,
        export_type = 'RAW',
        completed_at = CASE WHEN file_path IS NOT NULL THEN created_at ELSE NULL END,
        progress = CASE WHEN file_path IS NOT NULL THEN 100 ELSE 0 END
    WHERE job_status = 'done' AND completed_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.export_job DROP CONSTRAINT IF EXISTS export_job_type_check;
    ALTER TABLE audit.export_job DROP CONSTRAINT IF EXISTS export_job_status_check;
    ALTER TABLE audit.export_job DROP CONSTRAINT IF EXISTS export_job_format_check;

    ALTER TABLE audit.export_job
      ADD CONSTRAINT export_job_format_check
      CHECK (format IN ('CSV', 'XLSX'));

    ALTER TABLE audit.export_job
      DROP COLUMN IF EXISTS completed_at,
      DROP COLUMN IF EXISTS artifact_bytes,
      DROP COLUMN IF EXISTS data_version,
      DROP COLUMN IF EXISTS sha256,
      DROP COLUMN IF EXISTS error_message,
      DROP COLUMN IF EXISTS progress,
      DROP COLUMN IF EXISTS job_status,
      DROP COLUMN IF EXISTS export_type;
  `);
};
