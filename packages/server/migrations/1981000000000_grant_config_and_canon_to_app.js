/**
 * App role never got USAGE on schema config (created in 1794, omitted from 1797).
 * CRM rolling/skinpass save and shift-log submit SELECT config.validation_rule.
 * canon is read by m1Events equipment lookup; writes stay on zedral_canon_writeback.
 * No CREATE on either schema.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'config') THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
          GRANT USAGE ON SCHEMA config TO m1_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA config TO m1_app;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA config TO m1_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
          GRANT USAGE ON SCHEMA config TO zedral_m1_rw;
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA config TO zedral_m1_rw;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA config TO zedral_m1_rw;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_user') THEN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA config GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m1_app';
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA config GRANT USAGE, SELECT ON SEQUENCES TO m1_app';
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA config GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zedral_m1_rw';
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA config GRANT USAGE, SELECT ON SEQUENCES TO zedral_m1_rw';
          END IF;
        END IF;
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'canon') THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
          GRANT USAGE ON SCHEMA canon TO m1_app;
          GRANT SELECT ON ALL TABLES IN SCHEMA canon TO m1_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_user')
           AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
          EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE m1_user IN SCHEMA canon GRANT SELECT ON TABLES TO m1_app';
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
      IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'config') THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
          REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA config FROM m1_app;
          REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA config FROM m1_app;
          REVOKE USAGE ON SCHEMA config FROM m1_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zedral_m1_rw') THEN
          REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA config FROM zedral_m1_rw;
          REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA config FROM zedral_m1_rw;
          REVOKE USAGE ON SCHEMA config FROM zedral_m1_rw;
        END IF;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'canon') THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
          REVOKE SELECT ON ALL TABLES IN SCHEMA canon FROM m1_app;
          REVOKE USAGE ON SCHEMA canon FROM m1_app;
        END IF;
      END IF;
    END $$;
  `);
};
