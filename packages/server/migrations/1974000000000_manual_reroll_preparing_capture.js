/**
 * Manual Re-Roll rolling parity: PREPARING status + weight/pass capture on session.
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
      CHECK (status IN ('PREPARING','IN_PROGRESS','ON_HOLD','STOPPAGE','COMPLETED','CANCELLED'));

    ALTER TABLE txn.manual_reroll_session
      ADD COLUMN IF NOT EXISTS actual_weight_mt NUMERIC(12,3),
      ADD COLUMN IF NOT EXISTS actual_weight_source TEXT,
      ADD COLUMN IF NOT EXISTS actual_weight_photo_hash TEXT,
      ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS ocr_raw_text TEXT;

    DROP INDEX IF EXISTS txn.uq_manual_reroll_session_active_machine;
    CREATE UNIQUE INDEX uq_manual_reroll_session_active_machine
      ON txn.manual_reroll_session (machine_code)
      WHERE status IN ('PREPARING','IN_PROGRESS','STOPPAGE');

    DROP INDEX IF EXISTS txn.ix_manual_reroll_session_open;
    CREATE INDEX ix_manual_reroll_session_open
      ON txn.manual_reroll_session (status)
      WHERE status IN ('PREPARING','IN_PROGRESS','ON_HOLD','STOPPAGE');

    CREATE TABLE IF NOT EXISTS txn.manual_reroll_pass (
      pass_id         BIGSERIAL PRIMARY KEY,
      tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                      REFERENCES security.tenant(tenant_id),
      session_id      BIGINT NOT NULL REFERENCES txn.manual_reroll_session(session_id) ON DELETE CASCADE,
      pass_no         INTEGER NOT NULL,
      thickness_mm    NUMERIC(8,4) NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (session_id, pass_no)
    );

    CREATE INDEX IF NOT EXISTS ix_manual_reroll_pass_session
      ON txn.manual_reroll_pass (session_id, pass_no);

    ALTER TABLE txn.manual_reroll_pass ENABLE ROW LEVEL SECURITY;
    ALTER TABLE txn.manual_reroll_pass FORCE ROW LEVEL SECURITY;

    DO $pol$ BEGIN
      CREATE POLICY tenant_isolation ON txn.manual_reroll_pass
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
    DROP TABLE IF EXISTS txn.manual_reroll_pass;

    ALTER TABLE txn.manual_reroll_session
      DROP COLUMN IF EXISTS ocr_raw_text,
      DROP COLUMN IF EXISTS ocr_confidence,
      DROP COLUMN IF EXISTS actual_weight_photo_hash,
      DROP COLUMN IF EXISTS actual_weight_source,
      DROP COLUMN IF EXISTS actual_weight_mt;

    UPDATE txn.manual_reroll_session
    SET status = 'CANCELLED'
    WHERE status = 'PREPARING';

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
      WHERE status IN ('IN_PROGRESS','STOPPAGE');

    DROP INDEX IF EXISTS txn.ix_manual_reroll_session_open;
    CREATE INDEX ix_manual_reroll_session_open
      ON txn.manual_reroll_session (status)
      WHERE status IN ('IN_PROGRESS','ON_HOLD','STOPPAGE');
  `);
};
