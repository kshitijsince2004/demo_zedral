/** Process route engine revision: standalone sub_process codes + CRM route metadata. */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
      ('PKL', 'Pickling', 'PKL'),
      ('ANN', 'Annealing', 'ANN'),
      ('RWD', 'Rewinding', 'RWD'),
      ('HRS', 'HR Slitting', 'HRS'),
      ('CRS', 'CR Slitting', 'CRS'),
      ('CTL', 'CTL', 'CTL')
    ON CONFLICT (sub_process_code) DO NOTHING;

    UPDATE master.route_code
    SET process_code = 'CRM'
    WHERE route_code IN ('4', '6', 'X', 'Y', 'Z');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE master.route_code
    SET process_code = '6HI'
    WHERE route_code IN ('4', '6', 'X', 'Y', 'Z');

    DELETE FROM master.crm_sub_process
    WHERE sub_process_code IN ('PKL', 'ANN', 'RWD', 'HRS', 'CRS', 'CTL');
  `);
};
