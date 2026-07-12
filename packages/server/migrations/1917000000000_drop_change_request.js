/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // Drop the standalone audit.change_request table.
  // Note: We intentionally do NOT drop audit.audit_log.change_request_id column, 
  // nor modify the fn_audit trigger. They resolve to NULL gracefully.
  pgm.dropTable({ schema: 'audit', name: 'change_request' });
};

exports.down = (pgm) => {
  // Restore the change_request table
  pgm.createTable(
    { schema: 'audit', name: 'change_request' },
    {
      cr_id: { type: 'bigserial', primaryKey: true },
      record_pk: { type: 'varchar(255)', notNull: true },
      proposed_changes: { type: 'jsonb' },
      reason: { type: 'text', notNull: true },
      requested_by: { type: 'integer', notNull: true },
      requested_at: {
        type: 'timestamp with time zone',
        notNull: true,
        default: pgm.func('CURRENT_TIMESTAMP'),
      },
      state: {
        type: 'varchar(50)',
        notNull: true,
        default: 'PENDING',
      },
      approved_by: { type: 'integer' },
      decided_at: { type: 'timestamp with time zone' },
      rejection_note: { type: 'text' },
    }
  );
};
