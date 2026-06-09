/** Rename master.process code CRM6 → 6HI for line access and routing. */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE master.process
    SET code = '6HI', name = '6HI'
    WHERE code = 'CRM6';

    UPDATE master.machine
    SET process_code = '6HI'
    WHERE process_code = 'CRM6';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE master.machine
    SET process_code = 'CRM6'
    WHERE process_code = '6HI';

    UPDATE master.process
    SET code = 'CRM6', name = 'CRM 6HI'
    WHERE code = '6HI';
  `);
};
