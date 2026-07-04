exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
        CREATE ROLE zedral_m1_rw NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_ro') THEN
        CREATE ROLE zedral_m1_ro NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_canon_writeback') THEN
        CREATE ROLE zedral_canon_writeback NOLOGIN;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA txn, planning, coil, master TO zedral_m1_rw, zedral_m1_ro;
    GRANT SELECT ON ALL TABLES IN SCHEMA txn, planning, coil, master TO zedral_m1_ro;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA txn, planning, coil TO zedral_m1_rw;
    GRANT SELECT ON ALL TABLES IN SCHEMA master TO zedral_m1_rw;

    ALTER DEFAULT PRIVILEGES IN SCHEMA txn GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA planning GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA coil GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA master GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA txn GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA planning GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA coil GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA txn, planning, coil, master FROM zedral_m1_rw, zedral_m1_ro;
    REVOKE USAGE ON SCHEMA txn, planning, coil, master FROM zedral_m1_rw, zedral_m1_ro;

    DROP ROLE IF EXISTS zedral_canon_writeback;
    DROP ROLE IF EXISTS zedral_m1_ro;
    DROP ROLE IF EXISTS zedral_m1_rw;
  `);
};
