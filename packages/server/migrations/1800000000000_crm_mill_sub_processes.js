/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
      ('4HI_ROLLING', '4HI Rolling', '4HI'),
      ('4HI_SKIN_PASS', '4HI Skin Pass', '4HI'),
      ('2HI_SKIN_PASS', '2HI Skin Pass', '2HI')
    ON CONFLICT (sub_process_code) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM master.crm_sub_process WHERE sub_process_code IN ('4HI_ROLLING', '4HI_SKIN_PASS', '2HI_SKIN_PASS');
  `);
};
