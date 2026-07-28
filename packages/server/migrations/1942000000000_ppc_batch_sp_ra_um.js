exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.ppc_batch
      ADD COLUMN IF NOT EXISTS sp_ra_max_um NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS sp_ra_min_um NUMERIC NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.ppc_batch
      DROP COLUMN IF EXISTS sp_ra_max_um,
      DROP COLUMN IF EXISTS sp_ra_min_um;
  `);
};
