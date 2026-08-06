/**
 * Isolated Manual Re-Roll overlay sessions for 6HI/4HI/2HI.
 * Removable via migrate down + flag off — no production-table FKs.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS txn.manual_reroll_session (
      session_id        BIGSERIAL PRIMARY KEY,
      tenant_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                        REFERENCES security.tenant(tenant_id),
      order_id          BIGINT,
      batch_number      VARCHAR(64),
      machine_code      VARCHAR(32) NOT NULL,
      machine_type      VARCHAR(16) NOT NULL,
      operator_id       INTEGER NOT NULL REFERENCES security.app_user(user_id),
      shift_code        VARCHAR(16),
      reroll_quantity   NUMERIC(12,3),
      status            VARCHAR(24) NOT NULL DEFAULT 'IN_PROGRESS'
                        CHECK (status IN ('IN_PROGRESS','COMPLETED','CANCELLED')),
      remarks           TEXT,
      start_time        TIMESTAMPTZ NOT NULL DEFAULT now(),
      end_time          TIMESTAMPTZ,
      duration_min      INTEGER,
      created_by        INTEGER NOT NULL REFERENCES security.app_user(user_id),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_manual_reroll_session_machine_start
      ON txn.manual_reroll_session (machine_code, start_time DESC);

    CREATE INDEX IF NOT EXISTS ix_manual_reroll_session_in_progress
      ON txn.manual_reroll_session (status)
      WHERE status = 'IN_PROGRESS';

    CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_reroll_session_active_machine
      ON txn.manual_reroll_session (machine_code)
      WHERE status = 'IN_PROGRESS';

    COMMENT ON TABLE txn.manual_reroll_session IS
      'Overlay Manual Re-Roll sessions for CRM mills. Isolated from production tables.';
    COMMENT ON COLUMN txn.manual_reroll_session.order_id IS
      'Soft reference to txn.crm_order.order_id — no FK (read-only overlay).';
    COMMENT ON COLUMN txn.manual_reroll_session.duration_min IS
      'Sole duration source: round((end_time - start_time) / 1 minute).';

    ALTER TABLE txn.manual_reroll_session ENABLE ROW LEVEL SECURITY;
    ALTER TABLE txn.manual_reroll_session FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON txn.manual_reroll_session
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

    UPDATE security.tenant_config
    SET
      flags = COALESCE(flags, '{}'::jsonb) || '{"mode.manual_reroll": false}'::jsonb,
      updated_at = now();
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS txn.manual_reroll_session;

    UPDATE security.tenant_config
    SET
      flags = flags - 'mode.manual_reroll',
      updated_at = now();
  `);
};
