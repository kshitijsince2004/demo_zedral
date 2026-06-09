/**
 * Machine-centric shift sessions, handovers, override audit, per-shift order attribution.
 * Shift windows remain in master.shift (admin-editable).
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Ensure default shift windows (idempotent)
    INSERT INTO master.shift (shift_code, name, start_time, end_time)
    VALUES
      ('A', 'Shift A', '06:00', '14:00'),
      ('B', 'Shift B', '14:00', '22:00'),
      ('C', 'Shift C', '22:00', '06:00')
    ON CONFLICT (shift_code) DO UPDATE SET
      name = EXCLUDED.name,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time;

    CREATE TABLE txn.machine_shift_session (
      session_id          BIGSERIAL PRIMARY KEY,
      machine_code        VARCHAR(16) NOT NULL REFERENCES master.machine(machine_code),
      shift_code          VARCHAR(4)  NOT NULL REFERENCES master.shift(shift_code),
      prod_date           DATE        NOT NULL,
      operator_user_id    INTEGER     NOT NULL REFERENCES security.app_user(user_id),
      shift_log_id        BIGINT      REFERENCES txn.shift_log(shift_log_id),
      status              VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','PENDING_ACCEPTANCE','CLOSED')),
      started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at           TIMESTAMPTZ,
      override_id         BIGINT,
      UNIQUE (machine_code, prod_date, shift_code, operator_user_id, started_at)
    );
    CREATE INDEX ix_machine_shift_session_active
      ON txn.machine_shift_session (machine_code, status) WHERE status = 'ACTIVE';

    CREATE TABLE txn.shift_override_audit (
      override_id         BIGSERIAL PRIMARY KEY,
      user_id             INTEGER     NOT NULL REFERENCES security.app_user(user_id),
      machine_code        VARCHAR(16) REFERENCES master.machine(machine_code),
      selected_shift_code VARCHAR(4)  NOT NULL REFERENCES master.shift(shift_code),
      prod_date           DATE        NOT NULL,
      reason_code         VARCHAR(32) NOT NULL
                          CHECK (reason_code IN (
                            'OVERTIME','PREV_SHIFT_CONTINUATION','SUPERVISOR_INSTRUCTION',
                            'SHIFT_CORRECTION','OTHER'
                          )),
      reason_detail       TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE txn.machine_shift_session
      ADD CONSTRAINT fk_machine_shift_session_override
      FOREIGN KEY (override_id) REFERENCES txn.shift_override_audit(override_id);

    CREATE TABLE txn.machine_handover (
      handover_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_code            VARCHAR(16) NOT NULL REFERENCES master.machine(machine_code),
      process_code            VARCHAR(8)  NOT NULL,
      order_id                BIGINT      REFERENCES txn.crm6_order(order_id),
      batch_number            VARCHAR(40),
      outgoing_shift_code     VARCHAR(4)  NOT NULL REFERENCES master.shift(shift_code),
      incoming_shift_code     VARCHAR(4)  NOT NULL REFERENCES master.shift(shift_code),
      outgoing_prod_date      DATE        NOT NULL,
      incoming_prod_date      DATE        NOT NULL,
      outgoing_operator_id    INTEGER     NOT NULL REFERENCES security.app_user(user_id),
      incoming_operator_id    INTEGER     REFERENCES security.app_user(user_id),
      machine_status          VARCHAR(20) NOT NULL
                              CHECK (machine_status IN (
                                'RUNNING','IDLE','BREAKDOWN','MAINTENANCE','STOPPAGE'
                              )),
      breakdown_code          VARCHAR(32),
      breakdown_description   TEXT,
      downtime_minutes        INTEGER,
      maintenance_status      VARCHAR(32),
      remarks                 TEXT        NOT NULL,
      queue_snapshot          JSONB       NOT NULL DEFAULT '{}',
      production_snapshot     JSONB       NOT NULL DEFAULT '{}',
      open_stoppages          JSONB       NOT NULL DEFAULT '[]',
      status                  VARCHAR(24) NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN (
                                'PENDING','ACCEPTED','CLARIFICATION_REQUESTED','CANCELLED'
                              )),
      clarification_notes     TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      accepted_at             TIMESTAMPTZ,
      created_by_boundary     BOOLEAN     NOT NULL DEFAULT false
    );
    CREATE INDEX ix_machine_handover_pending
      ON txn.machine_handover (machine_code, status) WHERE status = 'PENDING';

    CREATE TABLE txn.order_shift_attribution (
      attribution_id      BIGSERIAL PRIMARY KEY,
      order_id            BIGINT      NOT NULL REFERENCES txn.crm6_order(order_id) ON DELETE CASCADE,
      shift_log_id        BIGINT      NOT NULL REFERENCES txn.shift_log(shift_log_id),
      machine_code        VARCHAR(16) NOT NULL REFERENCES master.machine(machine_code),
      shift_code          VARCHAR(4)  NOT NULL REFERENCES master.shift(shift_code),
      prod_date           DATE        NOT NULL,
      runtime_minutes     INTEGER     NOT NULL DEFAULT 0,
      production_mt       NUMERIC(12,3) NOT NULL DEFAULT 0,
      stoppage_minutes    INTEGER     NOT NULL DEFAULT 0,
      breakdown_minutes   INTEGER     NOT NULL DEFAULT 0,
      UNIQUE (order_id, shift_log_id, machine_code)
    );

    CREATE TABLE txn.shift_event_audit (
      event_id            BIGSERIAL PRIMARY KEY,
      event_type          VARCHAR(48) NOT NULL,
      entity_type         VARCHAR(32),
      entity_id           TEXT,
      machine_code        VARCHAR(16),
      payload             JSONB       NOT NULL DEFAULT '{}',
      user_id             INTEGER     REFERENCES security.app_user(user_id),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ix_shift_event_audit_type ON txn.shift_event_audit (event_type, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS txn.shift_event_audit;
    DROP TABLE IF EXISTS txn.order_shift_attribution;
    DROP TABLE IF EXISTS txn.machine_handover;
    ALTER TABLE txn.machine_shift_session DROP CONSTRAINT IF EXISTS fk_machine_shift_session_override;
    DROP TABLE IF EXISTS txn.machine_shift_session;
    DROP TABLE IF EXISTS txn.shift_override_audit;
  `);
};
