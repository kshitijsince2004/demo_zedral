/**
 * Add shift_code and prod_date natively to all transactional production tables.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  const tables = [
    'txn.prod_hrs',
    'txn.prod_pkl',
    'txn.prod_crm',
    'txn.prod_crs',
    'txn.prod_ctl',
    'txn.prod_rwd',
    'txn.prod_skp',
    'txn.prod_glv',
    'txn.crm6_order',
    'txn.stoppage_entry',
    'txn.ann_charge'
  ];

  for (const table of tables) {
    // Add columns as nullable first
    pgm.sql(`
      ALTER TABLE ${table} 
      ADD COLUMN IF NOT EXISTS shift_code VARCHAR(4),
      ADD COLUMN IF NOT EXISTS prod_date DATE;
    `);

    // Backfill data using shift_log_id
    pgm.sql(`
      UPDATE ${table} t
      SET shift_code = sl.shift_code,
          prod_date = sl.prod_date
      FROM txn.shift_log sl
      WHERE t.shift_log_id = sl.shift_log_id
        AND t.shift_code IS NULL;
    `);
  }

  // crm6_rolling backfill via crm6_order
  pgm.sql(`
    ALTER TABLE txn.crm6_rolling 
    ADD COLUMN IF NOT EXISTS shift_code VARCHAR(4),
    ADD COLUMN IF NOT EXISTS prod_date DATE;

    UPDATE txn.crm6_rolling r
    SET shift_code = o.shift_code,
        prod_date = o.prod_date
    FROM txn.crm6_order o
    WHERE r.order_id = o.order_id
      AND r.shift_code IS NULL;
  `);

  // defect_entry backfill is too complex due to polymorphic entry_id. 
  // We'll just add the columns so new records can populate them.
  pgm.sql(`
    ALTER TABLE txn.defect_entry 
    ADD COLUMN IF NOT EXISTS shift_code VARCHAR(4),
    ADD COLUMN IF NOT EXISTS prod_date DATE;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  const tables = [
    'txn.prod_hrs',
    'txn.prod_pkl',
    'txn.prod_crm',
    'txn.prod_crs',
    'txn.prod_ctl',
    'txn.prod_rwd',
    'txn.prod_skp',
    'txn.prod_glv',
    'txn.crm6_order',
    'txn.crm6_rolling',
    'txn.stoppage_entry',
    'txn.defect_entry',
    'txn.ann_charge'
  ];

  for (const table of tables) {
    pgm.sql(`
      ALTER TABLE ${table}
      DROP COLUMN IF NOT EXISTS shift_code,
      DROP COLUMN IF NOT EXISTS prod_date;
    `);
  }
};
