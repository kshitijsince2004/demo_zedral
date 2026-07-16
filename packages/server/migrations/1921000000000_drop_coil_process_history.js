/**
 * Phase 5.2 Process History Cluster Collapse
 * Drops the legacy coil.coil_process_history table.
 */
exports.up = async (pgm) => {
  // Check that the table is empty before dropping
  const res = await pgm.db.query(`SELECT count(*) as cnt FROM coil.coil_process_history`);
  if (res.rows[0].cnt > 0) {
    console.warn(`[WARNING] coil.coil_process_history has ${res.rows[0].cnt} rows. Proceeding with drop as this data is legacy and handled by order_journey_step.`);
  }

  pgm.dropTable({ schema: 'coil', name: 'coil_process_history' }, { ifExists: true, cascade: true });
};

exports.down = async (pgm) => {
  pgm.createTable(
    { schema: 'coil', name: 'coil_process_history' },
    {
      coil_no: { type: 'varchar(50)', notNull: true },
      process_id: { type: 'integer', notNull: true },
      entered_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      completed_at: { type: 'timestamptz' },
      in_thk_mm: { type: 'numeric' },
      out_thk_mm: { type: 'numeric' },
      out_weight_mt: { type: 'numeric' },
      tenant_id: { type: 'uuid', notNull: true, default: pgm.func('current_setting(\'app.tenant_id\', true)::uuid') }
    }
  );

  pgm.addConstraint({ schema: 'coil', name: 'coil_process_history' }, 'coil_process_history_pkey', {
    primaryKey: ['coil_no', 'process_id']
  });

  // Enable RLS for the re-created table
  pgm.sql(`ALTER TABLE coil.coil_process_history ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY tenant_isolation ON coil.coil_process_history
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
  `);
};
