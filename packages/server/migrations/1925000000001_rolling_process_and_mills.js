exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE master.line_area DROP CONSTRAINT IF EXISTS line_area_process_code_fkey;

    -- process 31 is the Rolling process (holds 6HI/4HI/2HI); recode away from the single-mill '6HI'
    UPDATE master.process SET code = 'ROLLING', name = 'Rolling' WHERE process_id = 31;

    -- update referencing tables
    UPDATE master.line_area SET process_code = 'ROLLING' WHERE process_code = '6HI';

    -- re-add constraint
    ALTER TABLE master.line_area ADD CONSTRAINT line_area_process_code_fkey FOREIGN KEY (process_code) REFERENCES master.process(code);

    -- all three mills sit under the Rolling process; machine_code is the real discriminator
    UPDATE master.machine SET process_id = 31, process_code = 'ROLLING'
     WHERE machine_code IN ('6HI','4HI','2HI');

    -- sub-processes: 6HI/4HI roll + skin-pass; 2HI skin-pass ONLY (temper mill)
    INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
      ('4HI_ROLLING',   '4HI Rolling',   '4HI'),
      ('4HI_SKIN_PASS', '4HI Skin Pass', '4HI'),
      ('2HI_SKIN_PASS', '2HI Skin Pass', '2HI')
    ON CONFLICT (sub_process_code) DO NOTHING;
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE master.machine SET process_id = NULL, process_code = NULL WHERE machine_code IN ('4HI','2HI');
    UPDATE master.machine SET process_code = '6HI' WHERE machine_code = '6HI';
    
    ALTER TABLE master.line_area DROP CONSTRAINT IF EXISTS line_area_process_code_fkey;
    UPDATE master.process SET code = '6HI', name = '6HI' WHERE process_id = 31;
    UPDATE master.line_area SET process_code = '6HI' WHERE process_code = 'ROLLING';
    ALTER TABLE master.line_area ADD CONSTRAINT line_area_process_code_fkey FOREIGN KEY (process_code) REFERENCES master.process(code);
  `);
};
