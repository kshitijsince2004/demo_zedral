/** Machine allocation at move-to-production (separate from route codes 4 / X). */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.ppc_batch
      ADD COLUMN IF NOT EXISTS machine_allocated BOOLEAN NOT NULL DEFAULT TRUE;

    UPDATE planning.ppc_batch
    SET machine_allocated = TRUE
    WHERE machine_allocated IS DISTINCT FROM TRUE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.ppc_batch
      DROP COLUMN IF EXISTS machine_allocated;
  `);
};
