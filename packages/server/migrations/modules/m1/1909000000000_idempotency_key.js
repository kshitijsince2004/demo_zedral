/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS txn;

    CREATE TABLE IF NOT EXISTS txn.idempotency_key (
      key uuid PRIMARY KEY,
      response_status integer NOT NULL,
      response_body jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_idempotency_key_created_at
      ON txn.idempotency_key(created_at);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.ix_idempotency_key_created_at;
    DROP TABLE IF EXISTS txn.idempotency_key;
  `);
};
