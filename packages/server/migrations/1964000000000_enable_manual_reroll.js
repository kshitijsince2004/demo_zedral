/**
 * Manual Re-Roll is live on CRM mills — flip the tenant flag on.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE security.tenant_config
    SET
      flags = COALESCE(flags, '{}'::jsonb) || '{"mode.manual_reroll": true}'::jsonb,
      updated_at = now();
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE security.tenant_config
    SET
      flags = COALESCE(flags, '{}'::jsonb) || '{"mode.manual_reroll": false}'::jsonb,
      updated_at = now();
  `);
};
