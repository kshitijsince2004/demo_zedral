/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.dropTable({ schema: 'txn', name: 'prod_glv' });
};

exports.down = (pgm) => {
  pgm.createTable(
    { schema: 'txn', name: 'prod_glv' },
    {
      entry_id: { type: 'bigserial', primaryKey: true },
      shift_log_id: {
        type: 'bigint',
        notNull: true,
        references: 'txn.shift_log(shift_log_id)',
      },
      coil_id: { type: 'varchar(50)', notNull: true },
      line_speed_mpm: { type: 'numeric(10,2)' },
      zinc_coating_mass: { type: 'numeric(10,2)' },
      defects: { type: 'jsonb' },
      status: {
        type: 'varchar(50)',
        notNull: true,
        default: 'PROCESSED',
      },
      created_at: {
        type: 'timestamp with time zone',
        notNull: true,
        default: pgm.func('CURRENT_TIMESTAMP'),
      },
      created_by: { type: 'integer' },
    }
  );
};
