import pg from 'pg';

const DEFAULT_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

async function fix() {
  const client = new pg.Client({ connectionString: DEFAULT_URL });
  await client.connect();
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit.dpr_month_lock (
        dpr_month VARCHAR(7) PRIMARY KEY,
        locked_by INTEGER REFERENCES security.app_user(user_id),
        locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        remarks TEXT
      );
    `);
    console.log('Successfully created audit.dpr_month_lock');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

fix();
