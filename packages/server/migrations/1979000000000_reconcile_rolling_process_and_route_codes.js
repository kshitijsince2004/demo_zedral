/**
 * Idempotent end-state for CRM mill taxonomy (audit F1/F2/F3).
 * process 31 = ROLLING; 6HI/4HI/2HI wired; canonical route_code tokens restored.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.line_area DROP CONSTRAINT IF EXISTS line_area_process_code_fkey;

    UPDATE master.process
       SET code = 'ROLLING', name = 'Rolling'
     WHERE process_id = 31;

    UPDATE master.line_area
       SET process_code = 'ROLLING'
     WHERE process_code IN ('6HI', 'CRM6');

    ALTER TABLE master.line_area
      ADD CONSTRAINT line_area_process_code_fkey
      FOREIGN KEY (process_code) REFERENCES master.process(code);

    UPDATE master.machine
       SET process_id = 31, process_code = 'ROLLING'
     WHERE machine_code IN ('6HI', '4HI', '2HI');

    INSERT INTO master.route_code (route_code, display_label, process_code, machine_code, sub_process, seq_hint) VALUES
      ('4', '4HI Rolling',   'ROLLING', '4HI', 'ROLLING',   30),
      ('6', '6HI Rolling',   'ROLLING', '6HI', 'ROLLING',   31),
      ('X', '2HI Skin Pass', 'ROLLING', '2HI', 'SKIN_PASS', 60),
      ('Y', '4HI Skin Pass', 'ROLLING', '4HI', 'SKIN_PASS', 61),
      ('Z', '6HI Skin Pass', 'ROLLING', '6HI', 'SKIN_PASS', 62)
    ON CONFLICT (route_code) DO UPDATE SET
      machine_code = EXCLUDED.machine_code,
      sub_process = EXCLUDED.sub_process,
      process_code = EXCLUDED.process_code;

    DELETE FROM master.route_code
     WHERE route_code IN ('4I', '6I', '2HIS', '4HIS', '6HIS');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {
  // Repair migration — do not revert mill wiring.
};
