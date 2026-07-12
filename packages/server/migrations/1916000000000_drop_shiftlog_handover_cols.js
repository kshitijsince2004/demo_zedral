/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // Drop legacy Model A handover columns from txn.shift_log
  // Ensure that no views or application logic still depend on these before executing in prod.
  pgm.dropColumns({ schema: 'txn', name: 'shift_log' }, [
    'handover_notes',
    'handover_outgoing_user_id',
    'handover_incoming_user_id',
    'handover_at',
    'prev_shift_log_id'
  ]);
};

exports.down = (pgm) => {
  // Re-add the columns to allow rolling back Model B adoption
  pgm.addColumns({ schema: 'txn', name: 'shift_log' }, {
    handover_notes: { type: 'text' },
    handover_outgoing_user_id: { type: 'integer' },
    handover_incoming_user_id: { type: 'integer' },
    handover_at: { type: 'timestamptz' },
    prev_shift_log_id: { type: 'bigint' }
  });
};
