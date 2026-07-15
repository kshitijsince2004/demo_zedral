/**
 * P6 / E4 — drop unused dpr.* tables/schema (export uses in-memory geometry, not these tables).
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS dpr.field_mapping CASCADE;
    DROP TABLE IF EXISTS dpr.source_map CASCADE;
    DROP TABLE IF EXISTS dpr.daily_entry CASCADE;
    DROP TABLE IF EXISTS dpr.month CASCADE;
    DROP TABLE IF EXISTS dpr.template CASCADE;
    DROP SCHEMA IF EXISTS dpr CASCADE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`CREATE SCHEMA IF NOT EXISTS dpr`);
  // Full recreate deferred — use 1798000000000_dpr_schema.js if rollback needed in full.
};
