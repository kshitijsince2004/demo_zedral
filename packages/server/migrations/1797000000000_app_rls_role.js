/**
 * Application role subject to row-level security (superusers bypass RLS).
 * Integration tests and CI use m1_app so tenant-isolation policies are enforced.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'm1_app') THEN
        CREATE ROLE m1_app WITH LOGIN PASSWORD 'm1_app_password'
          NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END
    $$;

    GRANT CONNECT ON DATABASE m1_db TO m1_app;

    GRANT USAGE ON SCHEMA master, coil, security, txn, planning, audit TO m1_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA master, coil, security, txn, planning, audit TO m1_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA master, coil, security, txn, planning, audit TO m1_app;

    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA master
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA coil
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA security
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA txn
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA planning
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA audit
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m1_app;

    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA master
      GRANT USAGE, SELECT ON SEQUENCES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA coil
      GRANT USAGE, SELECT ON SEQUENCES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA security
      GRANT USAGE, SELECT ON SEQUENCES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA txn
      GRANT USAGE, SELECT ON SEQUENCES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA planning
      GRANT USAGE, SELECT ON SEQUENCES TO m1_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA audit
      GRANT USAGE, SELECT ON SEQUENCES TO m1_app;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA master, coil, security, txn, planning, audit FROM m1_app;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA master, coil, security, txn, planning, audit FROM m1_app;
    REVOKE USAGE ON SCHEMA master, coil, security, txn, planning, audit FROM m1_app;
    REVOKE CONNECT ON DATABASE m1_db FROM m1_app;
    DROP ROLE IF EXISTS m1_app;
  `);
};
