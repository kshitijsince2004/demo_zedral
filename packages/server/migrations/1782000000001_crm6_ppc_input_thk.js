/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.ppc_batch
      ADD COLUMN IF NOT EXISTS input_thk_mm NUMERIC(6,3);

    -- Backfill: input from mother coil thickness where available
    UPDATE planning.ppc_batch pb
    SET input_thk_mm = c.coil_thk_mm
    FROM coil.coil c
    WHERE c.coil_no = pb.coil_no AND pb.input_thk_mm IS NULL;

    -- Fallback: estimate input as target + 0.9mm for rolling, +0.15 for skin pass
    UPDATE planning.ppc_batch
    SET input_thk_mm = CASE
      WHEN sub_process = 'SKIN_PASS' THEN ppc_thk_mm + 0.15
      ELSE ppc_thk_mm + 0.9
    END
    WHERE input_thk_mm IS NULL;

    ALTER TABLE planning.ppc_batch
      ALTER COLUMN input_thk_mm SET NOT NULL;

    ALTER TABLE txn.crm6_order
      ADD COLUMN IF NOT EXISTS input_thk_mm NUMERIC(6,3);

    UPDATE txn.crm6_order o
    SET input_thk_mm = pb.input_thk_mm
    FROM planning.ppc_batch pb
    WHERE pb.batch_id = o.batch_id AND o.input_thk_mm IS NULL;

    UPDATE txn.crm6_order
    SET input_thk_mm = ppc_thk_mm + 0.9
    WHERE input_thk_mm IS NULL;

    ALTER TABLE txn.crm_roll_change
      ADD COLUMN IF NOT EXISTS reason_text VARCHAR(100);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE txn.crm_roll_change DROP COLUMN IF EXISTS reason_text;
    ALTER TABLE txn.crm6_order DROP COLUMN IF EXISTS input_thk_mm;
    ALTER TABLE planning.ppc_batch DROP COLUMN IF EXISTS input_thk_mm;
  `);
};
