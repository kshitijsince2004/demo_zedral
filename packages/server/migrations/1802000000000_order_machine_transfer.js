/** Audit trail for order machine assignment / transfer. */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS txn.order_machine_transfer (
      transfer_id       BIGSERIAL PRIMARY KEY,
      order_id          BIGINT REFERENCES txn.crm6_order(order_id) ON DELETE SET NULL,
      batch_number      VARCHAR(64) NOT NULL,
      source_machine_code VARCHAR(16) NOT NULL,
      destination_machine_code VARCHAR(16) NOT NULL,
      sub_process       VARCHAR(32) NOT NULL,
      assigned_by       INTEGER REFERENCES security.app_user(user_id) ON DELETE SET NULL,
      reason            TEXT,
      transferred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ix_order_machine_transfer_batch
      ON txn.order_machine_transfer(batch_number);
    CREATE INDEX IF NOT EXISTS ix_order_machine_transfer_at
      ON txn.order_machine_transfer(transferred_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS txn.order_machine_transfer;');
};
