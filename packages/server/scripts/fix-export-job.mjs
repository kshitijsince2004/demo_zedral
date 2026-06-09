import pg from 'pg';

const DEFAULT_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

async function fix() {
  const client = new pg.Client({ connectionString: DEFAULT_URL });
  await client.connect();
  
  try {
    await client.query(`
      ALTER TABLE audit.export_job
        ADD COLUMN IF NOT EXISTS export_type VARCHAR(50) DEFAULT 'RAW',
        ADD COLUMN IF NOT EXISTS job_status VARCHAR(50) DEFAULT 'queued',
        ADD COLUMN IF NOT EXISTS progress NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS error_message TEXT,
        ADD COLUMN IF NOT EXISTS storage_uri VARCHAR(512),
        ADD COLUMN IF NOT EXISTS artifact_bytes BIGINT,
        ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64),
        ADD COLUMN IF NOT EXISTS data_version VARCHAR(50),
        ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS source_record_count BIGINT;
    `);
    console.log('Successfully added missing columns to audit.export_job');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

fix();
