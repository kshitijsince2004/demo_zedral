/**
 * Add AUTO_COMPLETED to machine_handover status (Tier-1 auto boundary).
 * Partial unique index: at most one boundary-created handover per machine+outgoing shift.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_status_check;

    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_status_check
      CHECK (status::text = ANY (ARRAY[
        'DRAFT'::text,
        'PENDING'::text,
        'ACCEPTED'::text,
        'REJECTED'::text,
        'CLARIFICATION_REQUESTED'::text,
        'CANCELLED'::text,
        'AUTO_COMPLETED'::text
      ]));

    CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_handover_boundary_outgoing
      ON txn.machine_handover (machine_code, outgoing_shift_code, outgoing_prod_date)
      WHERE created_by_boundary = true;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.uq_machine_handover_boundary_outgoing;

    ALTER TABLE txn.machine_handover DROP CONSTRAINT IF EXISTS machine_handover_status_check;

    ALTER TABLE txn.machine_handover
      ADD CONSTRAINT machine_handover_status_check
      CHECK (status::text = ANY (ARRAY[
        'DRAFT'::text,
        'PENDING'::text,
        'ACCEPTED'::text,
        'REJECTED'::text,
        'CLARIFICATION_REQUESTED'::text,
        'CANCELLED'::text
      ]));
  `);
};
