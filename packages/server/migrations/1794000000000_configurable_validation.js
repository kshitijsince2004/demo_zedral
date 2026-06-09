/**
 * Database Migration for Configurable Input Validation
 */

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createSchema('config', { ifNotExists: true });

  pgm.createTable(
    { schema: 'config', name: 'validation_rule' },
    {
      field_id: { type: 'varchar', primaryKey: true },
      rule_type: { type: 'varchar', notNull: true },
      severity: { type: 'varchar', notNull: true },
      is_active: { type: 'boolean', notNull: true, default: true },
      params: { type: 'jsonb', notNull: true },
      updated_at: {
        type: 'timestamp with time zone',
        default: pgm.func('current_timestamp'),
      },
      updated_by: { type: 'varchar' },
    }
  );

  // Register for audit logging
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_audit_validation_rule ON config.validation_rule;
    CREATE TRIGGER trg_audit_validation_rule 
    AFTER INSERT OR UPDATE OR DELETE ON config.validation_rule 
    FOR EACH ROW EXECUTE FUNCTION audit.fn_audit();
  `);

  pgm.createTable(
    { schema: 'config', name: 'ruleset_version' },
    {
      id: { type: 'serial', primaryKey: true },
      version: { type: 'int', notNull: true, default: 1 },
      published_at: {
        type: 'timestamp with time zone',
        default: pgm.func('current_timestamp'),
      },
      published_by: { type: 'varchar' },
    }
  );

  // Initialize version to 1
  pgm.sql(`INSERT INTO config.ruleset_version (version, published_by) VALUES (1, 'system')`);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable({ schema: 'config', name: 'ruleset_version' });
  pgm.dropTable({ schema: 'config', name: 'validation_rule' });
  // We may choose not to drop the schema if other tables depend on it, 
  // but since we created it here and nothing else seems to be in it, we can drop it.
  pgm.dropSchema('config', { ifExists: true, cascade: true });
};
