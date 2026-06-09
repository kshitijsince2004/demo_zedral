exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.import_batch
      ADD COLUMN IF NOT EXISTS errors_json JSONB;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.import_batch
      DROP COLUMN IF EXISTS errors_json;
  `);
};
