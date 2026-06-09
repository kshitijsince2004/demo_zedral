/**
 * Machine state event log and order_stoppage.operator_id.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS txn.machine_state_event (
      event_id      BIGSERIAL       PRIMARY KEY,
      machine_code  VARCHAR(20)     NOT NULL,
      event_type    VARCHAR(30)     NOT NULL,
      occurred_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
      ended_at      TIMESTAMPTZ,
      duration_min  NUMERIC(10, 2),
      order_id      BIGINT          REFERENCES txn.crm6_order(order_id) ON DELETE SET NULL,
      batch_number  VARCHAR(50),
      operator_id   INTEGER,
      shift_code    VARCHAR(5),
      reason        TEXT,
      category_code VARCHAR(20),
      meta          JSONB,
      tenant_id     VARCHAR(50)     NOT NULL DEFAULT current_setting('app.tenant_id', true)
    );

    CREATE INDEX IF NOT EXISTS idx_mse_machine_time
      ON txn.machine_state_event (machine_code, occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_mse_event_type
      ON txn.machine_state_event (event_type, occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_mse_open_events
      ON txn.machine_state_event (machine_code, event_type)
      WHERE ended_at IS NULL;

    ALTER TABLE txn.order_stoppage
      ADD COLUMN IF NOT EXISTS operator_id INTEGER;

    COMMENT ON TABLE txn.machine_state_event IS
      'Persisted machine state transitions for real-time monitoring and utilization analytics.';

    COMMENT ON COLUMN txn.machine_state_event.event_type IS
      'One of: RUNNING_STARTED, RUNNING_ENDED, STOPPAGE_STARTED, STOPPAGE_ENDED, IDLE_STARTED, IDLE_ENDED, MAINTENANCE_STARTED, MAINTENANCE_ENDED';

    COMMENT ON COLUMN txn.machine_state_event.ended_at IS
      'Set when the paired *_ENDED event is recorded. NULL = event is still active.';

    COMMENT ON COLUMN txn.machine_state_event.duration_min IS
      'Computed when ended_at is set: (ended_at - occurred_at) in minutes.';
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.order_stoppage DROP COLUMN IF EXISTS operator_id;
    DROP TABLE IF EXISTS txn.machine_state_event;
  `);
};
