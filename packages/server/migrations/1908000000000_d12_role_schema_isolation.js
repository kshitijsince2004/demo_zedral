exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_platform_rw') THEN
        CREATE ROLE zedral_platform_rw NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_platform_ro') THEN
        CREATE ROLE zedral_platform_ro NOLOGIN;
      END IF;
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

    GRANT USAGE ON SCHEMA security, canon, audit TO zedral_platform_rw, zedral_platform_ro;
    GRANT SELECT ON ALL TABLES IN SCHEMA security, canon, audit TO zedral_platform_ro;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA security, canon, audit TO zedral_platform_rw;

    GRANT USAGE ON SCHEMA txn, planning, coil, master, config, dpr TO zedral_m1_rw, zedral_m1_ro;
    GRANT SELECT ON ALL TABLES IN SCHEMA txn, planning, coil, master, config, dpr TO zedral_m1_ro;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA txn, planning, coil, config, dpr TO zedral_m1_rw;
    GRANT SELECT ON ALL TABLES IN SCHEMA master TO zedral_m1_rw;

    GRANT USAGE ON SCHEMA canon TO zedral_m1_rw, zedral_m1_ro, zedral_canon_writeback;
    GRANT SELECT ON ALL TABLES IN SCHEMA canon TO zedral_m1_rw, zedral_m1_ro;
    GRANT SELECT, INSERT ON canon.event, canon.production_count TO zedral_canon_writeback;

    ALTER DEFAULT PRIVILEGES IN SCHEMA security GRANT SELECT ON TABLES TO zedral_platform_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA canon GRANT SELECT ON TABLES TO zedral_platform_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT ON TABLES TO zedral_platform_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA security GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_platform_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA canon GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_platform_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_platform_rw;

    ALTER DEFAULT PRIVILEGES IN SCHEMA txn GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA planning GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA coil GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA master GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA dpr GRANT SELECT ON TABLES TO zedral_m1_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA canon GRANT SELECT ON TABLES TO zedral_m1_ro;

    ALTER DEFAULT PRIVILEGES IN SCHEMA txn GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA planning GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA coil GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA config GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA dpr GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA canon GRANT SELECT ON TABLES TO zedral_m1_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA canon GRANT SELECT, INSERT ON TABLES TO zedral_canon_writeback;

    ALTER ROLE zedral_platform_rw SET search_path = security, canon, audit;
    ALTER ROLE zedral_platform_ro SET search_path = security, canon, audit;
    ALTER ROLE zedral_m1_rw SET search_path = txn, planning, coil, master, config, dpr, canon;
    ALTER ROLE zedral_m1_ro SET search_path = txn, planning, coil, master, config, dpr, canon;
    ALTER ROLE zedral_canon_writeback SET search_path = canon;

    DO $$
    DECLARE
      foreign_schema text;
    BEGIN
      FOREACH foreign_schema IN ARRAY ARRAY['maint', 'plan', 'oee', 'yield_', 'qual', 'energy']
      LOOP
        IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = foreign_schema) THEN
          EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM zedral_m1_rw, zedral_m1_ro, zedral_canon_writeback', foreign_schema);
          EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM zedral_m1_rw, zedral_m1_ro, zedral_canon_writeback', foreign_schema);
        END IF;
      END LOOP;
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_platform_rw') THEN
        ALTER ROLE zedral_platform_rw RESET search_path;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_platform_ro') THEN
        ALTER ROLE zedral_platform_ro RESET search_path;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
        ALTER ROLE zedral_m1_rw RESET search_path;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_ro') THEN
        ALTER ROLE zedral_m1_ro RESET search_path;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_canon_writeback') THEN
        ALTER ROLE zedral_canon_writeback RESET search_path;
      END IF;
    END $$;

    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA security, canon, audit FROM zedral_platform_rw, zedral_platform_ro;
    REVOKE ALL PRIVILEGES ON SCHEMA security, canon, audit FROM zedral_platform_rw, zedral_platform_ro;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA txn, planning, coil, master, config, dpr, canon FROM zedral_m1_rw, zedral_m1_ro;
    REVOKE ALL PRIVILEGES ON SCHEMA txn, planning, coil, master, config, dpr, canon FROM zedral_m1_rw, zedral_m1_ro;
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA canon FROM zedral_canon_writeback;
    REVOKE USAGE ON SCHEMA canon FROM zedral_canon_writeback;

    DROP ROLE IF EXISTS zedral_canon_writeback;
    DROP ROLE IF EXISTS zedral_m1_ro;
    DROP ROLE IF EXISTS zedral_m1_rw;
    DROP ROLE IF EXISTS zedral_platform_ro;
    DROP ROLE IF EXISTS zedral_platform_rw;
  `);
};
