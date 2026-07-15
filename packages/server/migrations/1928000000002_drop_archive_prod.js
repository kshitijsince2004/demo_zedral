/**
 * P5 / E3 — drop archive.prod_* after dual-writes removed from app code.
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = async (pgm) => {
  await pgm.db.query(`
    DO $$ BEGIN
      IF to_regclass('archive.prod_skp_pass') IS NOT NULL THEN
        DROP TABLE archive.prod_skp_pass;
      END IF;
      IF to_regclass('archive.prod_skp') IS NOT NULL THEN
        DROP TABLE archive.prod_skp;
      END IF;
      IF to_regclass('archive.prod_crm') IS NOT NULL THEN
        DROP TABLE archive.prod_crm;
      END IF;
    END $$;
  `);
};

exports.down = (pgm) => {
  // Irreversible without full table DDL + data; keep empty restore stubs for migrate down safety.
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS archive;
    CREATE TABLE IF NOT EXISTS archive.prod_crm (
      entry_id BIGSERIAL PRIMARY KEY,
      shift_log_id BIGINT,
      coil_no VARCHAR(50)
    );
    CREATE TABLE IF NOT EXISTS archive.prod_skp (
      entry_id BIGSERIAL PRIMARY KEY,
      shift_log_id BIGINT,
      coil_no VARCHAR(50)
    );
    CREATE TABLE IF NOT EXISTS archive.prod_skp_pass (
      entry_id BIGINT REFERENCES archive.prod_skp(entry_id) ON DELETE CASCADE,
      pass_no INTEGER,
      thickness_mm NUMERIC
    );
  `);
};
