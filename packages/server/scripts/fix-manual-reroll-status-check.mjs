import pg from 'pg';

const { Client } = pg;

const url =
  process.env.DATABASE_URL ||
  `postgres://${encodeURIComponent(process.env.DB_USER || 'm1_user')}:${encodeURIComponent(process.env.DB_PASSWORD || 'm1_password')}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'm1_db'}`;

const c = new Client({ connectionString: url });
await c.connect();
console.log('connected');

await c.query(`
  DO $chk$
  DECLARE r RECORD;
  BEGIN
    FOR r IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'txn'
        AND t.relname = 'manual_reroll_session'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%status%'
    LOOP
      EXECUTE format('ALTER TABLE txn.manual_reroll_session DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
  END $chk$;
`);

try {
  await c.query(`
    ALTER TABLE txn.manual_reroll_session
      ADD CONSTRAINT manual_reroll_session_status_check
      CHECK (status IN ('IN_PROGRESS','ON_HOLD','STOPPAGE','COMPLETED','CANCELLED'))
  `);
} catch (e) {
  if (!String(e.message).includes('already exists')) throw e;
  console.log('constraint already exists');
}

await c.query(`
  CREATE TABLE IF NOT EXISTS txn.manual_reroll_stoppage (
    stoppage_id     BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                    REFERENCES security.tenant(tenant_id),
    session_id      BIGINT NOT NULL REFERENCES txn.manual_reroll_session(session_id) ON DELETE CASCADE,
    machine_code    VARCHAR(32) NOT NULL,
    category_code   VARCHAR(64) NOT NULL,
    stoppage_code   VARCHAR(64),
    remarks         TEXT,
    operator_id     INTEGER REFERENCES security.app_user(user_id),
    start_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_time        TIMESTAMPTZ,
    duration_min    INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const r = await c.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'txn.manual_reroll_session'::regclass AND contype = 'c'
`);
console.log(JSON.stringify(r.rows, null, 2));
await c.end();
