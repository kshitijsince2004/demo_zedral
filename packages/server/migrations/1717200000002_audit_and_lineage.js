exports.up = (pgm) => {
  // Alter audit.audit_log to match the spec
  // Add correlation_id, tenant_id, before_value, after_value (jsonb)
  pgm.sql(`
    -- We'll rename some columns to match the new spec requirements
    ALTER TABLE audit.audit_log RENAME COLUMN table_name TO resource;
    ALTER TABLE audit.audit_log RENAME COLUMN user_id TO actor_id;
    
    ALTER TABLE audit.audit_log ADD COLUMN actor TEXT;
    ALTER TABLE audit.audit_log ADD COLUMN correlation_id TEXT;
    
    -- old_value / new_value were TEXT, let's cast them to JSONB for better querying or keep them and use before_value/after_value
    ALTER TABLE audit.audit_log RENAME COLUMN old_value TO before_value;
    ALTER TABLE audit.audit_log RENAME COLUMN new_value TO after_value;
    
    -- The table already got tenant_id from the multi_tenancy migration.
  `);

  // Define the generalized trigger function
  pgm.sql(`
    CREATE OR REPLACE FUNCTION audit.fn_audit() RETURNS trigger AS $$
    DECLARE
        pk_val TEXT;
        current_tenant UUID;
        corr_id TEXT;
    BEGIN
        current_tenant := current_setting('app.tenant_id', true)::uuid;
        corr_id := current_setting('app.correlation_id', true);
        
        -- Try to extract primary key dynamically or assume 'entry_id'/'id'/'record_id'
        -- For simplicity in this implementation, we will JSON serialize the whole row 
        -- and use a generic identifier if available.
        pk_val := COALESCE(
          (row_to_json(NEW)->>'id'),
          (row_to_json(NEW)->>'entry_id'),
          (row_to_json(NEW)->>'record_id'),
          (row_to_json(OLD)->>'id'),
          (row_to_json(OLD)->>'entry_id'),
          (row_to_json(OLD)->>'record_id'),
          'UNKNOWN'
        );

        IF (TG_OP = 'UPDATE') THEN
            INSERT INTO audit.audit_log(resource, record_pk, action, after_value, before_value, ts, tenant_id, correlation_id)
            VALUES (TG_TABLE_NAME, pk_val, 'UPDATE', row_to_json(NEW)::text, row_to_json(OLD)::text, now(), current_tenant, corr_id);
            RETURN NEW;
        ELSIF (TG_OP = 'INSERT') THEN
            INSERT INTO audit.audit_log(resource, record_pk, action, after_value, ts, tenant_id, correlation_id)
            VALUES (TG_TABLE_NAME, pk_val, 'INSERT', row_to_json(NEW)::text, now(), current_tenant, corr_id);
            RETURN NEW;
        ELSE
            INSERT INTO audit.audit_log(resource, record_pk, action, before_value, ts, tenant_id, correlation_id)
            VALUES (TG_TABLE_NAME, pk_val, 'DELETE', row_to_json(OLD)::text, now(), current_tenant, corr_id);
            RETURN OLD;
        END IF;
    END; $$ LANGUAGE plpgsql;
  `);

  // Create lineage table
  pgm.sql(`
    CREATE TABLE audit.lineage_ref (
        record_id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES security.tenant(tenant_id) ON DELETE CASCADE,
        batch_id UUID,
        source_row_ref TEXT,
        mapping_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE audit.lineage_ref ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit.lineage_ref FORCE ROW LEVEL SECURITY;
    
    CREATE POLICY tenant_isolation ON audit.lineage_ref
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  `);

  // Immutability Enforcement
  pgm.sql(`
    -- Revoke UPDATE and DELETE on audit_log from all application roles
    REVOKE UPDATE, DELETE ON audit.audit_log FROM PUBLIC;
    
    -- In postgres, the owner still has rights, so we can also create a trigger that prevents updates/deletes unconditionally
    CREATE OR REPLACE FUNCTION audit.fn_prevent_modify() RETURNS trigger AS $$
    BEGIN
        RAISE EXCEPTION 'Audit log is append-only. Modification is strictly prohibited.';
    END; $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_audit_immutability
    BEFORE UPDATE OR DELETE ON audit.audit_log
    FOR EACH ROW EXECUTE FUNCTION audit.fn_prevent_modify();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_audit_immutability ON audit.audit_log;
    DROP FUNCTION IF EXISTS audit.fn_prevent_modify();
    DROP TABLE IF EXISTS audit.lineage_ref;
    
    ALTER TABLE audit.audit_log RENAME COLUMN resource TO table_name;
    ALTER TABLE audit.audit_log RENAME COLUMN actor_id TO user_id;
    ALTER TABLE audit.audit_log DROP COLUMN actor;
    ALTER TABLE audit.audit_log DROP COLUMN correlation_id;
    ALTER TABLE audit.audit_log RENAME COLUMN before_value TO old_value;
    ALTER TABLE audit.audit_log RENAME COLUMN after_value TO new_value;
  `);
};
