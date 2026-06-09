import pg from 'pg';

const DEFAULT_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

async function fix() {
  const client = new pg.Client({ connectionString: DEFAULT_URL });
  await client.connect();
  
  try {
    await client.query(`ALTER TABLE audit.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;`);
    await client.query(`
      ALTER TABLE audit.audit_log 
      ADD CONSTRAINT audit_log_action_check 
      CHECK (action IN ('INSERT','UPDATE','DELETE','EXPORT'));
    `);
    console.log('Successfully updated audit_log_action_check constraint');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

fix();
