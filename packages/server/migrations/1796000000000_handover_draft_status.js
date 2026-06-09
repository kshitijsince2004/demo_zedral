/**
 * Add DRAFT status and handover_priority to txn.machine_handover.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.machine_handover
      DROP CONSTRAINT IF EXISTS machine_handover_status_check;

    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_status_check
      CHECK (status::text = ANY (ARRAY[
        'DRAFT'::text,
        'PENDING'::text,
        'ACCEPTED'::text,
        'CLARIFICATION_REQUESTED'::text,
        'CANCELLED'::text
      ]));

    ALTER TABLE txn.machine_handover
      ALTER COLUMN status SET DEFAULT 'DRAFT';

    ALTER TABLE txn.machine_handover
      ADD COLUMN IF NOT EXISTS handover_priority varchar(20) NOT NULL DEFAULT 'NORMAL';

    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_priority_check;

    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_priority_check
      CHECK (handover_priority::text = ANY (ARRAY[
        'LOW'::text,
        'NORMAL'::text,
        'HIGH'::text,
        'CRITICAL'::text
      ]));

    CREATE INDEX IF NOT EXISTS idx_mh_draft_machine
      ON txn.machine_handover (machine_code, status)
      WHERE status = 'DRAFT';
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.idx_mh_draft_machine;
    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_priority_check;
    ALTER TABLE txn.machine_handover DROP COLUMN IF EXISTS handover_priority;
    ALTER TABLE txn.machine_handover
      ALTER COLUMN status SET DEFAULT 'PENDING';
    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_status_check;
    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_status_check
      CHECK (status::text = ANY (ARRAY[
        'PENDING'::text,
        'ACCEPTED'::text,
        'CLARIFICATION_REQUESTED'::text,
        'CANCELLED'::text
      ]));
  `);
};
