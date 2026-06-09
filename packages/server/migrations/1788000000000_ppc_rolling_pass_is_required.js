/** Add is_required to ppc_rolling_pass_plan when table predates the column. */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.ppc_rolling_pass_plan
      ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.ppc_rolling_pass_plan
      DROP COLUMN IF EXISTS is_required;
  `);
};
