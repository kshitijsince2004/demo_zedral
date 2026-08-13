/**
 * Reserve-before-process idempotency: pending vs done, nullable response until complete.
 * Lives in m1 next to table create (1909) so empty CI up and down-all stay ordered.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $mig$
    BEGIN
      IF to_regclass('txn.idempotency_key') IS NULL THEN
        RETURN;
      END IF;

      ALTER TABLE txn.idempotency_key
        ALTER COLUMN response_status DROP NOT NULL;

      ALTER TABLE txn.idempotency_key
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done';

      ALTER TABLE txn.idempotency_key
        DROP CONSTRAINT IF EXISTS idempotency_key_status_check;

      ALTER TABLE txn.idempotency_key
        ADD CONSTRAINT idempotency_key_status_check CHECK (status IN ('pending', 'done'));
    END
    $mig$;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DO $mig$
    BEGIN
      IF to_regclass('txn.idempotency_key') IS NULL THEN
        RETURN;
      END IF;

      DELETE FROM txn.idempotency_key WHERE response_status IS NULL;

      ALTER TABLE txn.idempotency_key
        DROP CONSTRAINT IF EXISTS idempotency_key_status_check;

      ALTER TABLE txn.idempotency_key
        DROP COLUMN IF EXISTS status;

      ALTER TABLE txn.idempotency_key
        ALTER COLUMN response_status SET NOT NULL;
    END
    $mig$;
  `);
};
