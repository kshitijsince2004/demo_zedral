/** Phase 7 — audit stamps, object storage URI, DPR month lock. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.export_job
      ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS source_record_count BIGINT,
      ADD COLUMN IF NOT EXISTS storage_uri VARCHAR(512);

    CREATE TABLE IF NOT EXISTS audit.dpr_month_lock (
      month VARCHAR(7) PRIMARY KEY,
      finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finalized_by INT REFERENCES security.app_user(user_id),
      export_job_id BIGINT REFERENCES audit.export_job(export_id)
    );

    CREATE INDEX IF NOT EXISTS idx_export_job_status_created
      ON audit.export_job (job_status, created_at DESC)
      WHERE job_status = 'queued';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit.dpr_month_lock;
    ALTER TABLE audit.export_job
      DROP COLUMN IF EXISTS storage_uri,
      DROP COLUMN IF EXISTS source_record_count,
      DROP COLUMN IF EXISTS generated_at;
  `);
};
