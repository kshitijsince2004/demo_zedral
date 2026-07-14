exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE config.validation_rule 
    ADD CONSTRAINT validation_rule_unq 
    UNIQUE NULLS NOT DISTINCT (field_id, rule_type, process_code, machine_code)
  `);
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'config', name: 'validation_rule' }, 'validation_rule_unq');
};
