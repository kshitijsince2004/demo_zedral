import pg from 'pg';

const DEFAULT_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

async function fix() {
  const client = new pg.Client({ connectionString: DEFAULT_URL });
  await client.connect();
  
  try {
    await client.query(`DROP TABLE IF EXISTS audit.dpr_month_lock;`);
    await client.query(`
      CREATE TABLE audit.dpr_month_lock (
        month VARCHAR(7) PRIMARY KEY,
        finalized_by INTEGER REFERENCES security.app_user(user_id),
        export_job_id BIGINT,
        finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('Successfully recreated audit.dpr_month_lock with correct columns');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

fix();
