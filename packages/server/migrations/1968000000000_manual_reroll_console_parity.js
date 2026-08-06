/**
 * Manual Re-Roll console parity: ON_HOLD/STOPPAGE statuses + isolated stoppage table.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
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

    ALTER TABLE txn.manual_reroll_session
      ADD CONSTRAINT manual_reroll_session_status_check
      CHECK (status IN ('IN_PROGRESS','ON_HOLD','STOPPAGE','COMPLETED','CANCELLED'));

    DROP INDEX IF EXISTS txn.uq_manual_reroll_session_active_machine;
    CREATE UNIQUE INDEX uq_manual_reroll_session_active_machine
      ON txn.manual_reroll_session (machine_code)
      WHERE status IN ('IN_PROGRESS','ON_HOLD','STOPPAGE');

    DROP INDEX IF EXISTS txn.ix_manual_reroll_session_in_progress;
    CREATE INDEX ix_manual_reroll_session_open
      ON txn.manual_reroll_session (status)
      WHERE status IN ('IN_PROGRESS','ON_HOLD','STOPPAGE');

    COMMENT ON COLUMN txn.manual_reroll_session.duration_min IS
      'Net production minutes: wall (end-start) minus Σ stoppage minutes.';

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
    );

    CREATE INDEX IF NOT EXISTS ix_manual_reroll_stoppage_session
      ON txn.manual_reroll_stoppage (session_id, start_time DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_reroll_stoppage_open_session
      ON txn.manual_reroll_stoppage (session_id)
      WHERE end_time IS NULL;

    ALTER TABLE txn.manual_reroll_stoppage ENABLE ROW LEVEL SECURITY;
    ALTER TABLE txn.manual_reroll_stoppage FORCE ROW LEVEL SECURITY;

    DO $pol$ BEGIN
      CREATE POLICY tenant_isolation ON txn.manual_reroll_stoppage
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $pol$;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS txn.manual_reroll_stoppage;

    DROP INDEX IF EXISTS txn.uq_manual_reroll_session_active_machine;
    DROP INDEX IF EXISTS txn.ix_manual_reroll_session_open;

    UPDATE txn.manual_reroll_session
    SET status = 'IN_PROGRESS'
    WHERE status IN ('ON_HOLD','STOPPAGE');

    ALTER TABLE txn.manual_reroll_session
      DROP CONSTRAINT IF EXISTS manual_reroll_session_status_check;

    ALTER TABLE txn.manual_reroll_session
      ADD CONSTRAINT manual_reroll_session_status_check
      CHECK (status IN ('IN_PROGRESS','COMPLETED','CANCELLED'));

    CREATE UNIQUE INDEX uq_manual_reroll_session_active_machine
      ON txn.manual_reroll_session (machine_code)
      WHERE status = 'IN_PROGRESS';

    CREATE INDEX ix_manual_reroll_session_in_progress
      ON txn.manual_reroll_session (status)
      WHERE status = 'IN_PROGRESS';
  `);
};
