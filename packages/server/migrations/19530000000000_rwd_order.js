/**
 * Rewinding line order lifecycle — own table, not CRM sub_process.
 * Stoppage discriminator: nullable rwd_order_id (order_id stays CRM-only FK).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS txn.rwd_order (
      order_id            BIGSERIAL    PRIMARY KEY,
      batch_id            BIGINT       NOT NULL UNIQUE REFERENCES planning.ppc_batch(batch_id),
      batch_number        VARCHAR(30)  NOT NULL,
      coil_no             VARCHAR(30)  NOT NULL REFERENCES coil.coil(coil_no),
      slit_id             VARCHAR(20),
      customer_name       VARCHAR(120) NOT NULL,
      grade_code          VARCHAR(20)  NOT NULL,
      width_mm            NUMERIC(7,2) NOT NULL,
      input_thk_mm        NUMERIC(6,3),
      ppc_thk_mm          NUMERIC(6,3) NOT NULL,
      ppc_weight_mt       NUMERIC(9,3) NOT NULL,
      machine_code        VARCHAR(8)   NOT NULL REFERENCES master.machine(machine_code),
      status              VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','PREPARING','IN_PROGRESS','STOPPAGE','COMPLETED','REJECTED')),
      combined_group_id   UUID,
      prod_start_at       TIMESTAMPTZ,
      prod_end_at         TIMESTAMPTZ,
      prod_duration_min   INTEGER,
      shift_log_id        BIGINT       REFERENCES txn.shift_log(shift_log_id),
      shift_code          VARCHAR(4),
      prod_date           DATE,
      production_day      DATE,
      logged_in_user_id   INTEGER      REFERENCES security.app_user(user_id),
      hold_reason         VARCHAR(100),
      hold_remarks        VARCHAR(500),
      held_at             TIMESTAMPTZ,
      held_by             INTEGER      REFERENCES security.app_user(user_id),
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_rwd_order_machine_status
      ON txn.rwd_order (machine_code, status);
    CREATE INDEX IF NOT EXISTS ix_rwd_order_shift_status
      ON txn.rwd_order (shift_log_id, status);
    CREATE INDEX IF NOT EXISTS ix_rwd_order_combined_group
      ON txn.rwd_order (combined_group_id) WHERE combined_group_id IS NOT NULL;

    ALTER TABLE txn.stoppage
      ADD COLUMN IF NOT EXISTS rwd_order_id BIGINT REFERENCES txn.rwd_order(order_id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS order_kind VARCHAR(8) NOT NULL DEFAULT 'CRM'
        CHECK (order_kind IN ('CRM','RWD'));

    CREATE INDEX IF NOT EXISTS ix_stoppage_rwd_open
      ON txn.stoppage (rwd_order_id) WHERE rwd_order_id IS NOT NULL AND end_at IS NULL;

    -- Backfill: existing stoppages with order_id are CRM
    UPDATE txn.stoppage SET order_kind = 'CRM' WHERE order_id IS NOT NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.ix_stoppage_rwd_open;
    ALTER TABLE txn.stoppage DROP COLUMN IF EXISTS rwd_order_id;
    ALTER TABLE txn.stoppage DROP COLUMN IF EXISTS order_kind;
    DROP TABLE IF EXISTS txn.rwd_order;
  `);
};
