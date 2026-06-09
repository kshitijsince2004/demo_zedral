exports.up = (pgm) => {
  // Create default tenant UUID
  const defaultTenant = '00000000-0000-0000-0000-000000000001';

  // Create TENANT table
  pgm.sql(`
    CREATE TABLE security.tenant (
        tenant_id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    
    INSERT INTO security.tenant (tenant_id, name) VALUES ('${defaultTenant}', 'Hero Steels Limited (Default)');

    CREATE TABLE security.tenant_config (
        tenant_id UUID PRIMARY KEY REFERENCES security.tenant(tenant_id) ON DELETE CASCADE,
        deployment_mode TEXT NOT NULL DEFAULT 'cloud',
        latency_target_seconds INTEGER,
        retention_policy JSONB,
        enabled_modules JSONB,
        isolation_level TEXT NOT NULL DEFAULT 'logical',
        branding JSONB,
        cost_rate_ownership TEXT,
        config_version INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    
    INSERT INTO security.tenant_config (tenant_id) VALUES ('${defaultTenant}');
    
    CREATE TABLE security.permission (
        permission_id BIGSERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES security.tenant(tenant_id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        UNIQUE (tenant_id, role, resource, action)
    );
  `);

  const schemas = ['master', 'coil', 'security', 'txn', 'planning', 'audit'];
  
  // List of all tables that need tenant_id
  const tables = [
    'master.process', 'master.shift', 'master.customer', 'master.grade', 'master.surface_finish',
    'master.defect_code', 'master.stoppage_code', 'master.operator', 'master.furnace', 'master.rp_oil_grade', 'master.grade_spec',
    'coil.coil', 'coil.coil_process_history',
    'security.app_user', 'security.role', 'security.user_role', 'security.line_access',
    'txn.shift_log', 'txn.stoppage_entry', 'txn.crew_entry', 'txn.prod_hrs', 'txn.prod_hrs_slit', 'txn.prod_pkl',
    'txn.prod_pkl_chart', 'txn.prod_crm', 'txn.ann_charge', 'txn.ann_charge_coil', 'txn.prod_skp', 'txn.prod_skp_pass',
    'txn.prod_rwd', 'txn.prod_crs', 'txn.prod_crs_slit', 'txn.prod_ctl', 'txn.defect_entry',
    'planning.import_batch', 'planning.plan_order', 'planning.coil_plan',
    'audit.audit_log', 'audit.change_request', 'audit.export_job'
  ];

  for (const table of tables) {
    pgm.sql(`
      ALTER TABLE ${table} ADD COLUMN tenant_id UUID DEFAULT '${defaultTenant}' NOT NULL;
      ALTER TABLE ${table} ADD CONSTRAINT fk_${table.replace('.', '_')}_tenant FOREIGN KEY (tenant_id) REFERENCES security.tenant(tenant_id) ON DELETE CASCADE;
      
      -- Drop the old PK if needed and recreate with tenant_id? 
      -- Wait, design.md doesn't explicitly mandate composite PKs with tenant_id, 
      -- it just says "tenant_id stamped on every record". We can leave existing PKs.

      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      
      CREATE POLICY tenant_isolation ON ${table}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    `);
  }
};

exports.down = (pgm) => {
  const tables = [
    'master.process', 'master.shift', 'master.customer', 'master.grade', 'master.surface_finish',
    'master.defect_code', 'master.stoppage_code', 'master.operator', 'master.furnace', 'master.rp_oil_grade', 'master.grade_spec',
    'coil.coil', 'coil.coil_process_history',
    'security.app_user', 'security.role', 'security.user_role', 'security.line_access',
    'txn.shift_log', 'txn.stoppage_entry', 'txn.crew_entry', 'txn.prod_hrs', 'txn.prod_hrs_slit', 'txn.prod_pkl',
    'txn.prod_pkl_chart', 'txn.prod_crm', 'txn.ann_charge', 'txn.ann_charge_coil', 'txn.prod_skp', 'txn.prod_skp_pass',
    'txn.prod_rwd', 'txn.prod_crs', 'txn.prod_crs_slit', 'txn.prod_ctl', 'txn.defect_entry',
    'planning.import_batch', 'planning.plan_order', 'planning.coil_plan',
    'audit.audit_log', 'audit.change_request', 'audit.export_job'
  ];

  for (const table of tables) {
    pgm.sql(`
      DROP POLICY IF EXISTS tenant_isolation ON ${table};
      ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} DROP CONSTRAINT fk_${table.replace('.', '_')}_tenant;
      ALTER TABLE ${table} DROP COLUMN tenant_id;
    `);
  }

  pgm.sql(`
    DROP TABLE security.permission;
    DROP TABLE security.tenant_config;
    DROP TABLE security.tenant;
  `);
};
