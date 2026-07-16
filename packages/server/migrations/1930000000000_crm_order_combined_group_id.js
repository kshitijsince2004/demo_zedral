/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.addColumns(
    { schema: 'txn', name: 'crm_order' },
    {
      combined_group_id: { type: 'uuid', notNull: false },
    },
  );
  pgm.createIndex(
    { schema: 'txn', name: 'crm_order' },
    'combined_group_id',
    { name: 'idx_crm_order_combined_group_id', where: 'combined_group_id IS NOT NULL' },
  );
};

exports.down = (pgm) => {
  pgm.dropIndex({ schema: 'txn', name: 'crm_order' }, 'combined_group_id', {
    name: 'idx_crm_order_combined_group_id',
  });
  pgm.dropColumns({ schema: 'txn', name: 'crm_order' }, ['combined_group_id']);
};