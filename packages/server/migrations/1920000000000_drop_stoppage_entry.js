/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.dropTable({ schema: 'txn', name: 'stoppage_entry' });
};

exports.down = (pgm) => {
  pgm.createTable({ schema: 'txn', name: 'stoppage_entry' }, {
    stoppage_id: { type: 'bigserial', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, default: '00000000-0000-0000-0000-000000000001' },
    shift_log_id: { type: 'bigint', notNull: true, references: '"txn"."shift_log"("shift_log_id")' },
    stoppage_code: { type: 'varchar(16)', notNull: true, references: '"master"."stoppage_code"("stoppage_code")' },
    time_from: { type: 'varchar(5)', notNull: true },
    time_to: { type: 'varchar(5)' },
    duration_min: { type: 'integer' },
    remarks: { type: 'varchar(200)' },
    shift_code: { type: 'varchar(4)' },
    prod_date: { type: 'timestamp' }
  });

  pgm.sql(`ALTER TABLE "txn"."stoppage_entry" ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`
    CREATE POLICY tenant_isolation ON "txn"."stoppage_entry"
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `);
};
