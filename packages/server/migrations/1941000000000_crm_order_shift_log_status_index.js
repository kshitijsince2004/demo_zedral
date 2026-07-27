/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.createIndex(
    { schema: 'txn', name: 'crm_order' },
    ['shift_log_id', 'status'],
    { name: 'idx_crm_order_shift_log_status' },
  );
};

exports.down = (pgm) => {
  pgm.dropIndex({ schema: 'txn', name: 'crm_order' }, ['shift_log_id', 'status'], {
    name: 'idx_crm_order_shift_log_status',
  });
};
