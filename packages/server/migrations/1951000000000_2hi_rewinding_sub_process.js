/**
 * Additive registry seed: 2HI Rewinding mode (alongside Skin Pass).
 * REWINDING is the ppc_batch.sub_process marker (FK); 2HI_REWINDING mirrors 2HI_SKIN_PASS registry style.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
      ('REWINDING', 'Rewinding', '2HI'),
      ('2HI_REWINDING', '2HI Rewinding', '2HI')
    ON CONFLICT (sub_process_code) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM master.crm_sub_process
    WHERE sub_process_code IN ('REWINDING', '2HI_REWINDING');
  `);
};
