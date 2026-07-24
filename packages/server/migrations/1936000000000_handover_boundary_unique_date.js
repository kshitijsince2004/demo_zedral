/**
 * Harden boundary unique key to calendar date (not raw timestamptz),
 * so timezone/cast variants cannot create duplicate AUTO_COMPLETED rows.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.uq_machine_handover_boundary_outgoing;

    CREATE UNIQUE INDEX uq_machine_handover_boundary_outgoing
      ON txn.machine_handover (
        machine_code,
        outgoing_shift_code,
        ((outgoing_prod_date)::date)
      )
      WHERE created_by_boundary = true;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS txn.uq_machine_handover_boundary_outgoing;

    CREATE UNIQUE INDEX uq_machine_handover_boundary_outgoing
      ON txn.machine_handover (machine_code, outgoing_shift_code, outgoing_prod_date)
      WHERE created_by_boundary = true;
  `);
};
