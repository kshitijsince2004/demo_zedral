exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.change_request
      ADD COLUMN IF NOT EXISTS rejection_note VARCHAR(300);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.change_request
      DROP COLUMN IF EXISTS rejection_note;
  `);
};
