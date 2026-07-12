/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // 1. Rename order_stoppage to stoppage
  pgm.renameTable({ schema: 'txn', name: 'order_stoppage' }, 'stoppage');

  // 2. Make order_id nullable for legacy non-6hi logs
  pgm.alterColumn({ schema: 'txn', name: 'stoppage' }, 'order_id', {
    notNull: false
  });

  // 3. Add columns needed for unification
  pgm.addColumns({ schema: 'txn', name: 'stoppage' }, {
    tenant_id: { type: 'uuid', notNull: true, default: '00000000-0000-0000-0000-000000000001' },
    shift_log_id: { type: 'bigint', references: '"txn"."shift_log"("shift_log_id")' },
    machine_code: { type: 'varchar(16)', references: '"master"."machine"("machine_code")' },
    shift_code: { type: 'varchar(4)' },
    prod_date: { type: 'date' }
  });

  // 4. Enable RLS
  pgm.sql(`ALTER TABLE "txn"."stoppage" ENABLE ROW LEVEL SECURITY;`);
  pgm.sql(`
    CREATE POLICY tenant_isolation ON "txn"."stoppage"
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `);

  // 5. Open stoppage index for shift flows (parallel to the open order stoppage index)
  pgm.createIndex({ schema: 'txn', name: 'stoppage' }, ['shift_log_id'], {
    name: 'ix_stoppage_shift_open',
    where: 'end_at IS NULL'
  });

  // 6. Backfill data from txn.stoppage_entry (timezone aware)
  pgm.sql(`
    INSERT INTO "txn"."stoppage" (
      tenant_id,
      shift_log_id,
      category_code,
      breakdown_code,
      start_at,
      end_at,
      duration_min,
      shift_code,
      prod_date,
      remarks,
      operator_id
    )
    SELECT
      sl.tenant_id,
      se.shift_log_id,
      sc.category,
      se.stoppage_code,
      ((sl.prod_date + se.time_from::time) AT TIME ZONE 'Asia/Kolkata'),
      CASE 
        WHEN se.time_to IS NULL THEN NULL
        WHEN se.time_to <= se.time_from THEN ((sl.prod_date + se.time_to::time) + interval '1 day') AT TIME ZONE 'Asia/Kolkata'
        ELSE ((sl.prod_date + se.time_to::time) AT TIME ZONE 'Asia/Kolkata')
      END,
      se.duration_min,
      se.shift_code,
      sl.prod_date,
      se.remarks,
      NULL
    FROM txn.stoppage_entry se
    JOIN txn.shift_log sl ON sl.shift_log_id = se.shift_log_id
    JOIN master.stoppage_code sc ON sc.stoppage_code = se.stoppage_code;
  `);
};

exports.down = (pgm) => {
  // Reverse the backfill by deleting rows that have shift_log_id
  pgm.sql(`DELETE FROM "txn"."stoppage" WHERE shift_log_id IS NOT NULL;`);

  // Drop open stoppage index
  pgm.dropIndex({ schema: 'txn', name: 'stoppage' }, ['shift_log_id'], {
    name: 'ix_stoppage_shift_open',
    where: 'end_at IS NULL'
  });

  // Drop policies
  pgm.sql(`DROP POLICY IF EXISTS tenant_isolation ON "txn"."stoppage";`);
  pgm.sql(`ALTER TABLE "txn"."stoppage" DISABLE ROW LEVEL SECURITY;`);

  // Drop columns
  pgm.dropColumns({ schema: 'txn', name: 'stoppage' }, [
    'tenant_id',
    'shift_log_id',
    'machine_code',
    'shift_code',
    'prod_date'
  ]);

  // Enforce order_id not null again
  // (Assuming there's no data without order_id left after the delete)
  pgm.alterColumn({ schema: 'txn', name: 'stoppage' }, 'order_id', {
    notNull: true
  });

  // Rename back
  pgm.renameTable({ schema: 'txn', name: 'stoppage' }, 'order_stoppage');
};
