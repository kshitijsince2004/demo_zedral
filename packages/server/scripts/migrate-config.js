const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/m1',
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('CREATE SCHEMA IF NOT EXISTS config;');

    await client.query(`
      CREATE TABLE IF NOT EXISTS config.validation_rule (
        field_id VARCHAR PRIMARY KEY,
        rule_type VARCHAR NOT NULL,
        severity VARCHAR NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        params JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by VARCHAR
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS config.ruleset_version (
        id SERIAL PRIMARY KEY,
        version INT NOT NULL DEFAULT 1,
        published_at TIMESTAMPTZ DEFAULT NOW(),
        published_by VARCHAR
      );
    `);

    const result = await client.query('SELECT COUNT(*) FROM config.ruleset_version;');
    if (parseInt(result.rows[0].count) === 0) {
      await client.query(`INSERT INTO config.ruleset_version (version, published_by) VALUES (1, 'system');`);
    }

    await client.query(`
      DROP TRIGGER IF EXISTS trg_audit_validation_rule ON config.validation_rule;
      CREATE TRIGGER trg_audit_validation_rule
      AFTER INSERT OR UPDATE OR DELETE ON config.validation_rule
      FOR EACH ROW EXECUTE FUNCTION audit.fn_audit();

      DROP TRIGGER IF EXISTS trg_audit_ruleset_version ON config.ruleset_version;
      CREATE TRIGGER trg_audit_ruleset_version
      AFTER INSERT OR UPDATE OR DELETE ON config.ruleset_version
      FOR EACH ROW EXECUTE FUNCTION audit.fn_audit();
    `);

    await client.query('COMMIT');
    console.log('Migration successful');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed', err);
  } finally {
    client.release();
    pool.end();
  }
}

run();
