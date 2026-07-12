/**
 * Migration: drop `txn.crm` (crm6-redesign residue) after zero-row check.
 */

exports.up = async (pgm) => {
  // Precheck: ensure the table exists and is empty before dropping
  const tableCheck = await pgm.db.query(`
    SELECT count(*) as count 
    FROM information_schema.tables 
    WHERE table_schema = 'txn' AND table_name = 'crm'
  `);
  if (tableCheck.rows[0].count === '0') {
    // Table doesn't exist, nothing to drop
    return;
  }

  const result = await pgm.db.query(`SELECT count(*) as count FROM txn.crm`);
  if (result.rows[0].count > 0) {
    throw new Error('Cannot drop txn.crm: table is not empty. Contains ' + result.rows[0].count + ' rows.');
  }

  pgm.dropTable({ schema: 'txn', name: 'crm' });
};

exports.down = (pgm) => {
  // Recreate the empty table to allow rollback
  pgm.createTable(
    { schema: 'txn', name: 'crm' },
    {
      entry_id: { type: 'bigserial', primaryKey: true },
      shift_log_id: { type: 'bigint', notNull: true },
    }
  );
};
