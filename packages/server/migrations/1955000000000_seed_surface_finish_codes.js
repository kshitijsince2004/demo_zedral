/**
 * Ensure operator surface codes exist for prod_rwd / coil FK.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO master.surface_finish (surface_finish, description) VALUES
      ('M', 'Matt Finish'),
      ('B', 'Bright Finish')
    ON CONFLICT (surface_finish) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {
  // keep codes — other rows may reference them
};
