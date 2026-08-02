/**
 * HRS line order lifecycle — own table keyed by mother coil_no (N slits per order).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS txn.hrs_order (
      order_id                BIGSERIAL    PRIMARY KEY,
      coil_no                 VARCHAR(30)  NOT NULL UNIQUE REFERENCES coil.coil(coil_no),
      customer_name           VARCHAR(120) NOT NULL,
      grade_code              VARCHAR(20)  NOT NULL,
      nominal_width_mm        NUMERIC(7,2) NOT NULL,
      nominal_thk_mm          NUMERIC(6,3) NOT NULL,
      mother_coil_weight_mt   NUMERIC(9,3) NOT NULL,
      machine_code            VARCHAR(8)   NOT NULL DEFAULT 'HRS'
                              REFERENCES master.machine(machine_code)
                              CHECK (machine_code = 'HRS'),
      status                  VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING','PREPARING','IN_PROGRESS','STOPPAGE','COMPLETED','REJECTED')),
      prod_start_at           TIMESTAMPTZ,
      prod_end_at             TIMESTAMPTZ,
      prod_duration_min       INTEGER,
      shift_log_id            BIGINT       REFERENCES txn.shift_log(shift_log_id),
      shift_code              VARCHAR(4),
      prod_date               DATE,
      production_day          DATE,
      logged_in_user_id       INTEGER      REFERENCES security.app_user(user_id),
      hold_reason             VARCHAR(100),
      hold_remarks            VARCHAR(500),
      held_at                 TIMESTAMPTZ,
      held_by                 INTEGER      REFERENCES security.app_user(user_id),
      created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_hrs_order_status
      ON txn.hrs_order (status);
    CREATE INDEX IF NOT EXISTS ix_hrs_order_shift_status
      ON txn.hrs_order (shift_log_id, status);

    ALTER TABLE txn.stoppage
      ADD COLUMN IF NOT EXISTS hrs_order_id BIGINT REFERENCES txn.hrs_order(order_id) ON DELETE CASCADE;

    ALTER TABLE txn.stoppage DROP CONSTRAINT IF EXISTS stoppage_order_kind_check;
    ALTER TABLE txn.stoppage
      ADD CONSTRAINT stoppage_order_kind_check
      CHECK (order_kind IN ('CRM','RWD','HRS'));

    CREATE INDEX IF NOT EXISTS ix_stoppage_hrs_open
      ON txn.stoppage (hrs_order_id) WHERE hrs_order_id IS NOT NULL AND end_at IS NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.ix_stoppage_hrs_open;
    ALTER TABLE txn.stoppage DROP COLUMN IF EXISTS hrs_order_id;
    ALTER TABLE txn.stoppage DROP CONSTRAINT IF EXISTS stoppage_order_kind_check;
    ALTER TABLE txn.stoppage
      ADD CONSTRAINT stoppage_order_kind_check
      CHECK (order_kind IN ('CRM','RWD'));
    DROP TABLE IF EXISTS txn.hrs_order;
  `);
};
