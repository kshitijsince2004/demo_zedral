/**
 * Add tenant_id to planning.order_journey and scope the active-coil unique index per tenant.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE planning.order_journey
      ADD COLUMN IF NOT EXISTS tenant_id UUID;

    UPDATE planning.order_journey oj
    SET tenant_id = c.tenant_id
    FROM coil.coil c
    WHERE c.coil_no = oj.coil_no
      AND oj.tenant_id IS NULL;

    UPDATE planning.order_journey
    SET tenant_id = '00000000-0000-0000-0000-000000000001'
    WHERE tenant_id IS NULL;

    ALTER TABLE planning.order_journey
      ALTER COLUMN tenant_id SET NOT NULL,
      ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

    DROP INDEX IF EXISTS planning.ux_order_journey_active_coil;

    CREATE UNIQUE INDEX IF NOT EXISTS ux_order_journey_active_coil_tenant
      ON planning.order_journey (tenant_id, coil_no)
      WHERE status = 'ACTIVE';

    ALTER TABLE planning.order_journey ENABLE ROW LEVEL SECURITY;
    ALTER TABLE planning.order_journey FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation ON planning.order_journey;
    CREATE POLICY tenant_isolation ON planning.order_journey
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS tenant_isolation ON planning.order_journey;
    ALTER TABLE planning.order_journey DISABLE ROW LEVEL SECURITY;

    DROP INDEX IF EXISTS planning.ux_order_journey_active_coil_tenant;

    CREATE UNIQUE INDEX IF NOT EXISTS ux_order_journey_active_coil
      ON planning.order_journey (coil_no)
      WHERE status = 'ACTIVE';

    ALTER TABLE planning.order_journey DROP COLUMN IF EXISTS tenant_id;
  `);
};
