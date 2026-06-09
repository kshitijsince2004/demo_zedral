import pg from 'pg';

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  `postgres://${process.env.DB_USER || 'm1_user'}:${process.env.DB_PASSWORD || 'm1_password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'm1_db'}`;

const pool = new Pool({ connectionString });

const sql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'm1_app') THEN
    CREATE ROLE m1_app WITH LOGIN PASSWORD 'm1_app_password'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE m1_db TO m1_app;
GRANT USAGE ON SCHEMA master, coil, security, txn, planning, audit TO m1_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA master, coil, security, txn, planning, audit TO m1_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA master, coil, security, txn, planning, audit TO m1_app;
`;

try {
  await pool.query(sql);
  console.log('m1_app role is ready');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await pool.end();
}
