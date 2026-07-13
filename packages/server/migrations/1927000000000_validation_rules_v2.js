/**
 * Database Migration for Configurable Input Validation (Schema V2)
 */

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // Add new columns to existing table
  pgm.addColumns({ schema: 'config', name: 'validation_rule' }, {
    rule_id: {
      type: 'uuid',
      default: pgm.func('gen_random_uuid()'),
      notNull: true
    },
    process_code: { type: 'varchar' },
    machine_code: { type: 'varchar' },
    applies_when: { type: 'jsonb' }
  });

  // Drop old primary key and set new one
  pgm.dropConstraint({ schema: 'config', name: 'validation_rule' }, 'validation_rule_pkey');
  pgm.addConstraint({ schema: 'config', name: 'validation_rule' }, 'validation_rule_pkey', {
    primaryKey: 'rule_id'
  });

  // Insert CRM weight-floor rule for Rolling
  pgm.sql(`
    INSERT INTO config.validation_rule (rule_id, field_id, rule_type, severity, is_active, params, process_code, updated_by)
    VALUES (
      gen_random_uuid(),
      'actual_weight_mt',
      'MIN_PCT_OF_FIELD',
      'BLOCK',
      true,
      '{"ofField": "ppc_weight_mt", "pct": 97}',
      'ROLLING',
      'system'
    );
  `);

  // Insert CRM weight-floor rule for Skin Pass
  pgm.sql(`
    INSERT INTO config.validation_rule (rule_id, field_id, rule_type, severity, is_active, params, process_code, updated_by)
    VALUES (
      gen_random_uuid(),
      'actual_weight_mt',
      'MIN_PCT_OF_FIELD',
      'BLOCK',
      true,
      '{"ofField": "ppc_weight_mt", "pct": 97}',
      'SKIN_PASS',
      'system'
    );
  `);

  // Bump version
  pgm.sql(`
    INSERT INTO config.ruleset_version (version, published_by)
    SELECT COALESCE(MAX(version), 0) + 1, 'system'
    FROM config.ruleset_version;
  `);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM config.validation_rule WHERE rule_type = 'MIN_PCT_OF_FIELD'`);
  
  // Note: we can't easily revert the primary key back if there are duplicates on field_id.
  // We assume no duplicates for the rollback.
  pgm.dropConstraint({ schema: 'config', name: 'validation_rule' }, 'validation_rule_pkey');
  pgm.addConstraint({ schema: 'config', name: 'validation_rule' }, 'validation_rule_pkey', {
    primaryKey: 'field_id'
  });
  
  pgm.dropColumns({ schema: 'config', name: 'validation_rule' }, ['rule_id', 'process_code', 'machine_code', 'applies_when']);
};
