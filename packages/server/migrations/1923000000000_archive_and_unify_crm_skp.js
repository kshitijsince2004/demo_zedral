/**
 * Phase 5.4 & 5.5: Archive prod_crm and prod_skp, migrate legacy data to crm6_*, and aggregate scrap.
 * 
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // 1. Create Archive schema
  pgm.sql(`CREATE SCHEMA IF NOT EXISTS archive;`);

  // 2. Rename tables to archive schema
  pgm.sql(`ALTER TABLE txn.prod_crm SET SCHEMA archive;`);
  pgm.sql(`ALTER TABLE txn.prod_skp SET SCHEMA archive;`);
  pgm.sql(`ALTER TABLE txn.prod_skp_pass SET SCHEMA archive;`);

  // 3. Create dummy batch for legacy records to satisfy NOT NULL constraints on crm6_order
  pgm.sql(`
    INSERT INTO master.grade (grade_code, description)
    VALUES ('ARCHIVE', 'Dummy grade for archived production')
    ON CONFLICT (grade_code) DO NOTHING;

    INSERT INTO planning.ppc_batch (
      batch_number, plan_date, shift_code, machine_code, sub_process, queue_seq, 
      width_mm, ppc_thk_mm, ppc_weight_mt, grade_code, customer_name, coil_no, input_thk_mm
    )
    VALUES (
      'ARCHIVE-LEGACY', CURRENT_DATE, 'A', '6HI', 'ROLLING', 9999, 
      0, 0, 0, 'ARCHIVE', 'ARCHIVE', 'ARCHIVE-COIL', 0
    )
    ON CONFLICT (batch_number) DO NOTHING;
  `);

  // 4. Backfill archive.prod_crm -> txn.crm6_order & txn.crm6_rolling
  pgm.sql(`
    WITH archive_batch AS (
      SELECT batch_id FROM planning.ppc_batch WHERE batch_number = 'ARCHIVE-LEGACY' LIMIT 1
    ),
    inserted_orders AS (
      INSERT INTO txn.crm6_order (
        shift_log_id, batch_id, batch_number, coil_no, 
        customer_name, grade_code, width_mm, ppc_thk_mm, ppc_weight_mt,
        sub_process, status, prod_duration_min, production_day, created_at, updated_at
      )
      SELECT 
        c.shift_log_id,
        b.batch_id,
        'ARCHIVE-LEGACY',
        c.coil_no,
        'ARCHIVE',
        'ARCHIVE',
        0,
        COALESCE(c.input_thk_mm, 0),
        COALESCE(c.sl_no, 0), -- fallback weight
        'ROLLING',
        'COMPLETED',
        0,
        CURRENT_DATE,
        NOW(),
        NOW()
      FROM archive.prod_crm c
      CROSS JOIN archive_batch b
      RETURNING order_id, coil_no
    )
    INSERT INTO txn.crm6_rolling (
      order_id, actual_weight_mt, final_thk_mm
    )
    SELECT 
      io.order_id,
      0,
      c.output_thk_mm
    FROM inserted_orders io
    JOIN archive.prod_crm c ON io.coil_no = c.coil_no;
  `);

  // 5. Backfill archive.prod_skp -> txn.crm6_order & txn.crm6_skinpass
  pgm.sql(`
    WITH archive_batch AS (
      SELECT batch_id FROM planning.ppc_batch WHERE batch_number = 'ARCHIVE-LEGACY' LIMIT 1
    ),
    inserted_skp_orders AS (
      INSERT INTO txn.crm6_order (
        shift_log_id, batch_id, batch_number, coil_no, 
        customer_name, grade_code, width_mm, ppc_thk_mm, ppc_weight_mt,
        sub_process, status, prod_duration_min, production_day, created_at, updated_at
      )
      SELECT 
        s.shift_log_id,
        b.batch_id,
        'ARCHIVE-LEGACY',
        s.coil_no,
        'ARCHIVE',
        'ARCHIVE',
        COALESCE(s.width_mm, 0),
        COALESCE(s.thk_mm, 0),
        COALESCE(s.weight_mt, 0),
        'SKINPASS',
        'COMPLETED',
        0,
        CURRENT_DATE,
        NOW(),
        NOW()
      FROM archive.prod_skp s
      CROSS JOIN archive_batch b
      RETURNING order_id, coil_no
    )
    INSERT INTO txn.crm6_skinpass (
      order_id, actual_weight_mt, output_thk_mm, rw_tension_1
    )
    SELECT 
      io.order_id,
      s.wt_skinpass_mt,
      s.final_thk_mm,
      s.rw_tension_kg
    FROM inserted_skp_orders io
    JOIN archive.prod_skp s ON io.coil_no = s.coil_no;
  `);

  // 6. Aggregate Scrap from archive.prod_skp -> txn.crm6_shift_summary
  pgm.sql(`
    WITH scrap_totals AS (
      SELECT 
        shift_log_id,
        SUM(wt_scrap_mt) as total_scrap_mt
      FROM archive.prod_skp
      WHERE wt_scrap_mt IS NOT NULL AND wt_scrap_mt > 0
      GROUP BY shift_log_id
    )
    INSERT INTO txn.crm6_shift_summary (shift_log_id, scrap_kg)
    SELECT shift_log_id, total_scrap_mt * 1000
    FROM scrap_totals
    ON CONFLICT (shift_log_id) 
    DO UPDATE SET scrap_kg = COALESCE(txn.crm6_shift_summary.scrap_kg, 0) + EXCLUDED.scrap_kg;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // Revert tables back to txn schema
  pgm.sql(`ALTER TABLE archive.prod_crm SET SCHEMA txn;`);
  pgm.sql(`ALTER TABLE archive.prod_skp SET SCHEMA txn;`);
  pgm.sql(`ALTER TABLE archive.prod_skp_pass SET SCHEMA txn;`);

  // Note: We do NOT delete the migrated rows from crm6_order, crm6_rolling, crm6_skinpass
  // or revert the aggregated scrap, as this is a safe non-destructive fallback for reads.
};
