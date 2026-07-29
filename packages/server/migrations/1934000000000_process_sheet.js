/**
 * Phase 5 - process sheets (routing / where-checked overlay).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS master.process_sheet (
      process_sheet_id serial PRIMARY KEY,
      grade_code text NOT NULL,
      customer_id int REFERENCES master.customer(customer_id),
      route_code text,
      title text,
      status text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
      is_active boolean NOT NULL DEFAULT true,
      notes text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES security.tenant(tenant_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_process_sheet_key
      ON master.process_sheet (
        tenant_id, grade_code,
        COALESCE(customer_id, -1),
        COALESCE(route_code, '')
      )
      WHERE is_active = true;

    CREATE TABLE IF NOT EXISTS master.process_sheet_step (
      step_id serial PRIMARY KEY,
      process_sheet_id int NOT NULL REFERENCES master.process_sheet(process_sheet_id) ON DELETE CASCADE,
      seq_no int NOT NULL,
      process_code text NOT NULL,
      step_label text,
      UNIQUE (process_sheet_id, seq_no),
      UNIQUE (process_sheet_id, process_code)
    );

    CREATE TABLE IF NOT EXISTS master.process_sheet_step_check (
      step_id int NOT NULL REFERENCES master.process_sheet_step(step_id) ON DELETE CASCADE,
      parameter_code text NOT NULL REFERENCES master.spec_parameter(parameter_code),
      is_mandatory boolean NOT NULL DEFAULT false,
      PRIMARY KEY (step_id, parameter_code)
    );

    DO $$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY[
        'master.process_sheet',
        'master.process_sheet_step',
        'master.process_sheet_step_check'
      ]
      LOOP
        BEGIN
          EXECUTE format(
            'CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit.fn_audit()',
            replace(t, '.', '_'),
            t
          );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
      END LOOP;
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_audit_master_process_sheet_step_check ON master.process_sheet_step_check;
    DROP TRIGGER IF EXISTS trg_audit_master_process_sheet_step ON master.process_sheet_step;
    DROP TRIGGER IF EXISTS trg_audit_master_process_sheet ON master.process_sheet;
    DROP TABLE IF EXISTS master.process_sheet_step_check;
    DROP TABLE IF EXISTS master.process_sheet_step;
    DROP TABLE IF EXISTS master.process_sheet;
  `);
};
