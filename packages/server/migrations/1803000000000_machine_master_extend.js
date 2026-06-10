/** Machine master admin fields + transfer audit type. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.machine
      ADD COLUMN IF NOT EXISTS machine_type VARCHAR(24) DEFAULT 'PLANT',
      ADD COLUMN IF NOT EXISTS department VARCHAR(64),
      ADD COLUMN IF NOT EXISTS capacity_mt NUMERIC(10, 3);

    UPDATE master.machine
    SET machine_type = CASE
      WHEN machine_code IN ('6HI', '4HI') THEN 'CRM_ROLLING'
      WHEN machine_code = '2HI' THEN 'CRM_SKIN_PASS'
      ELSE COALESCE(machine_type, 'PLANT')
    END
    WHERE machine_code IN ('6HI', '4HI', '2HI') OR machine_type IS NULL;

    ALTER TABLE txn.order_machine_transfer
      ADD COLUMN IF NOT EXISTS transfer_type VARCHAR(16) NOT NULL DEFAULT 'SINGLE';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.order_machine_transfer DROP COLUMN IF EXISTS transfer_type;
    ALTER TABLE master.machine
      DROP COLUMN IF EXISTS capacity_mt,
      DROP COLUMN IF EXISTS department,
      DROP COLUMN IF EXISTS machine_type;
  `);
};
