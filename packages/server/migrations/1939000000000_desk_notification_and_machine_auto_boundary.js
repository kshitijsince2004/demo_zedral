/**
 * Tier1 SPEC2: MH desk notifications + per-machine auto-boundary override.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.machine
      ADD COLUMN IF NOT EXISTS auto_boundary_handover BOOLEAN;

    COMMENT ON COLUMN master.machine.auto_boundary_handover IS
      'NULL = inherit global AUTO_BOUNDARY_HANDOVER; true/false overrides for staged rollout';

    CREATE TABLE IF NOT EXISTS txn.desk_notification (
      notification_id   BIGSERIAL PRIMARY KEY,
      user_id           INTEGER NOT NULL REFERENCES security.app_user(user_id),
      kind              VARCHAR(64) NOT NULL,
      title             TEXT NOT NULL,
      body              TEXT NOT NULL,
      machine_code      VARCHAR(32),
      handover_id       BIGINT,
      shift_log_id      BIGINT,
      payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
      resolved_at       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_desk_notification_user_open
      ON txn.desk_notification (user_id, created_at DESC)
      WHERE resolved_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_desk_notification_shift_log
      ON txn.desk_notification (shift_log_id)
      WHERE shift_log_id IS NOT NULL AND resolved_at IS NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS txn.desk_notification;
    ALTER TABLE master.machine DROP COLUMN IF EXISTS auto_boundary_handover;
  `);
};