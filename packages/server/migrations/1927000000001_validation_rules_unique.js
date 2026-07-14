exports.up = (pgm) => {
  // Deduplicate existing rules before applying the unique constraint
  pgm.sql(`
    DELETE FROM config.validation_rule
    WHERE rule_id IN (
      SELECT rule_id
      FROM (
        SELECT rule_id,
               ROW_NUMBER() OVER (
                 PARTITION BY field_id, rule_type, process_code, machine_code 
                 ORDER BY rule_id
               ) as row_num
        FROM config.validation_rule
      ) t
      WHERE t.row_num > 1
    );
  `);

  pgm.sql(`
    ALTER TABLE config.validation_rule 
    ADD CONSTRAINT validation_rule_unq 
    UNIQUE NULLS NOT DISTINCT (field_id, rule_type, process_code, machine_code)
  `);
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'config', name: 'validation_rule' }, 'validation_rule_unq');
};
