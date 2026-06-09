/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumns(
    { schema: 'txn', name: 'shift_log' },
    {
      ruleset_version: {
        type: 'integer',
        notNull: false,
        comment: 'The active ruleset version at the time of submission',
      },
    }
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumns({ schema: 'txn', name: 'shift_log' }, ['ruleset_version']);
};
