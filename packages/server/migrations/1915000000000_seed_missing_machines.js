/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  // Insert missing generic machines for processes that don't have a 1:1 machine in master.machine.
  // SKP (Skin Pass Mill), CRM (Cold Rolling Mill), GLV (Galvanizing Line)
  // According to master.process, SKP is 5, CRM is 3, GLV is 9.
  
  pgm.sql(`
    INSERT INTO master.machine (machine_code, name, process_code, process_id, machine_status, machine_type)
    SELECT 'SKP', 'Skin Pass Mill (Generic)', 'SKP', 5, 'OPERATIONAL', 'PLANT'
    WHERE NOT EXISTS (SELECT 1 FROM master.machine WHERE machine_code = 'SKP');
  `);

  pgm.sql(`
    INSERT INTO master.machine (machine_code, name, process_code, process_id, machine_status, machine_type)
    SELECT 'CRM', 'Cold Rolling Mill (Generic)', 'CRM', 3, 'OPERATIONAL', 'PLANT'
    WHERE NOT EXISTS (SELECT 1 FROM master.machine WHERE machine_code = 'CRM');
  `);

  pgm.sql(`
    INSERT INTO master.machine (machine_code, name, process_code, process_id, machine_status, machine_type)
    SELECT 'GLV', 'Galvanizing Line (Generic)', 'GLV', 9, 'OPERATIONAL', 'PLANT'
    WHERE NOT EXISTS (SELECT 1 FROM master.machine WHERE machine_code = 'GLV');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM master.machine WHERE machine_code IN ('SKP', 'CRM', 'GLV') AND name LIKE '%(Generic)%';
  `);
};
