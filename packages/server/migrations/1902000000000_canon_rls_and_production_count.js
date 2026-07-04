exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA IF NOT EXISTS canon;

    CREATE TABLE IF NOT EXISTS canon.equipment_node (
      asset_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id UUID NOT NULL REFERENCES security.tenant(tenant_id) ON DELETE CASCADE,
      asset_code TEXT NOT NULL,
      name TEXT NOT NULL,
      process_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, asset_code)
    );

    CREATE TABLE IF NOT EXISTS canon.event (
      event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES security.tenant(tenant_id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      asset_id TEXT REFERENCES canon.equipment_node(asset_id),
      category TEXT,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      duration_min INTEGER,
      lineage_ref TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS canon.cost_rate (
      cost_rate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES security.tenant(tenant_id) ON DELETE CASCADE,
      asset_id TEXT REFERENCES canon.equipment_node(asset_id),
      rate_type TEXT NOT NULL,
      amount NUMERIC(14,4) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      effective_from TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS canon.personnel (
      person_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES security.tenant(tenant_id) ON DELETE CASCADE,
      source_user_id INTEGER,
      emp_code TEXT,
      full_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS canon.production_count (
      count_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES security.tenant(tenant_id) ON DELETE CASCADE,
      asset_id TEXT REFERENCES canon.equipment_node(asset_id),
      quantity NUMERIC(14,3) NOT NULL,
      uom TEXT NOT NULL DEFAULT 'MT',
      counted_at TIMESTAMPTZ NOT NULL,
      lineage_ref TEXT NOT NULL,
      shift_log_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS ix_canon_production_count_tenant_asset_time
      ON canon.production_count (tenant_id, asset_id, counted_at DESC);

    CREATE INDEX IF NOT EXISTS ix_canon_event_tenant_type_started
      ON canon.event (tenant_id, event_type, started_at DESC);

    INSERT INTO canon.equipment_node (asset_id, tenant_id, asset_code, name, process_code)
    SELECT asset_id, tenant_id, asset_code, name, process_code
    FROM (
      VALUES
        ('101', '00000000-0000-0000-0000-000000000001'::uuid, '6HI', '6HI Mill', '6HI'),
        ('102', '00000000-0000-0000-0000-000000000001'::uuid, '4HI', '4HI Mill', '4HI'),
        ('103', '00000000-0000-0000-0000-000000000001'::uuid, '2HI', '2HI Mill', '2HI')
    ) AS seed(asset_id, tenant_id, asset_code, name, process_code)
    WHERE EXISTS (SELECT 1 FROM security.tenant WHERE tenant_id = seed.tenant_id)
    ON CONFLICT (tenant_id, asset_code) DO UPDATE
      SET asset_id = EXCLUDED.asset_id,
          name = EXCLUDED.name,
          process_code = EXCLUDED.process_code;

    ALTER TABLE canon.equipment_node ENABLE ROW LEVEL SECURITY;
    ALTER TABLE canon.event ENABLE ROW LEVEL SECURITY;
    ALTER TABLE canon.cost_rate ENABLE ROW LEVEL SECURITY;
    ALTER TABLE canon.personnel ENABLE ROW LEVEL SECURITY;
    ALTER TABLE canon.production_count ENABLE ROW LEVEL SECURITY;

    ALTER TABLE canon.equipment_node FORCE ROW LEVEL SECURITY;
    ALTER TABLE canon.event FORCE ROW LEVEL SECURITY;
    ALTER TABLE canon.cost_rate FORCE ROW LEVEL SECURITY;
    ALTER TABLE canon.personnel FORCE ROW LEVEL SECURITY;
    ALTER TABLE canon.production_count FORCE ROW LEVEL SECURITY;

    DO $$
    DECLARE
      table_name TEXT;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY['equipment_node','event','cost_rate','personnel','production_count']
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS canon_tenant_isolation ON canon.%I', table_name);
        EXECUTE format(
          'CREATE POLICY canon_tenant_isolation ON canon.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
          table_name
        );
      END LOOP;
    END $$;

    GRANT USAGE ON SCHEMA canon TO zedral_canon_writeback;
    GRANT SELECT, INSERT ON canon.production_count, canon.event TO zedral_canon_writeback;
    GRANT SELECT ON canon.equipment_node, canon.cost_rate, canon.personnel TO zedral_canon_writeback;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA canon FROM zedral_canon_writeback;
    REVOKE USAGE ON SCHEMA canon FROM zedral_canon_writeback;
    DROP TABLE IF EXISTS canon.production_count;
    DROP TABLE IF EXISTS canon.event;
    DROP TABLE IF EXISTS canon.cost_rate;
    DROP TABLE IF EXISTS canon.personnel;
    DROP TABLE IF EXISTS canon.equipment_node;
    DROP SCHEMA IF EXISTS canon;
  `);
};
