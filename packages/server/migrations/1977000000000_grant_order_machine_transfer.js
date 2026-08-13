/**
 * App role has USAGE+DML on schema txn but not CREATE.
 * Runtime CREATE TABLE IF NOT EXISTS txn.order_machine_transfer was removed;
 * re-grant USAGE + DML in case USAGE was dropped or the table has another owner.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
        GRANT USAGE ON SCHEMA txn TO m1_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA txn TO m1_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA txn TO m1_app;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
        GRANT USAGE ON SCHEMA txn TO zedral_m1_rw;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA txn TO zedral_m1_rw;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA txn TO zedral_m1_rw;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'txn' AND table_name = 'order_machine_transfer'
      ) THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON txn.order_machine_transfer TO m1_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON txn.order_machine_transfer TO zedral_m1_rw;
        END IF;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_user') THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
          EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA txn GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m1_app';
          EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA txn GRANT USAGE, SELECT ON SEQUENCES TO m1_app';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
          EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA txn GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw';
          EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA txn GRANT USAGE, SELECT ON SEQUENCES TO zedral_m1_rw';
        END IF;
      END IF;
    END $$;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'txn' AND table_name = 'order_machine_transfer'
      ) THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
          REVOKE SELECT, INSERT, UPDATE, DELETE ON txn.order_machine_transfer FROM m1_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
          REVOKE SELECT, INSERT, UPDATE, DELETE ON txn.order_machine_transfer FROM zedral_m1_rw;
        END IF;
      END IF;
    END $$;
  `);
};
