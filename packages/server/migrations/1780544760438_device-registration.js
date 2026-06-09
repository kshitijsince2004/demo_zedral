exports.up = (pgm) => {
  const defaultTenant = '00000000-0000-0000-0000-000000000001';

  pgm.sql(`
    CREATE TABLE security.device_registration (
      device_id VARCHAR(64) PRIMARY KEY,
      process_code VARCHAR(8) NOT NULL REFERENCES master.process(code),
      registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_heartbeat TIMESTAMPTZ,
      tenant_id UUID DEFAULT '${defaultTenant}' NOT NULL REFERENCES security.tenant(tenant_id) ON DELETE CASCADE
    );

    ALTER TABLE security.device_registration ENABLE ROW LEVEL SECURITY;
    ALTER TABLE security.device_registration FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON security.device_registration
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS tenant_isolation ON security.device_registration;
    ALTER TABLE security.device_registration DISABLE ROW LEVEL SECURITY;
    DROP TABLE security.device_registration;
  `);
};
