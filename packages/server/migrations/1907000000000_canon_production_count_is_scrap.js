exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE canon.production_count
      ADD COLUMN IF NOT EXISTS is_scrap BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE canon.production_count
      DROP COLUMN IF EXISTS is_scrap;
  `);
};
