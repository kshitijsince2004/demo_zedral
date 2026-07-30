const fs = require('fs');
const params = JSON.parse(fs.readFileSync('packages/server/migrations/_qss_seed_params.json', 'utf8'));

function esc(s) {
  return String(s).replace(/'/g, "''");
}
function arr(a) {
  if (!a || !a.length) return "'{}'";
  return `ARRAY[${a.map((x) => `'${esc(x)}'`).join(',')}]::text[]`;
}

const inserts = params
  .map(
    (p) =>
      `('${esc(p.parameter_code)}','${esc(p.label)}','${esc(p.unit)}','${esc(p.data_type)}','${esc(p.limit_kind)}','${esc(p.param_group)}',${arr(p.applies_to)},${p.sort_order},${p.is_mandatory_default})`,
  )
  .join(',\n      ');

const migration = `/** Quality Spec-Sheet Module Phase 0 — catalog, sheets, versions, values, QC, QUALITY role. */
exports.up = (pgm) => {
  pgm.sql(\`
    CREATE TABLE IF NOT EXISTS master.spec_parameter (
      parameter_code text PRIMARY KEY,
      label text NOT NULL,
      unit text,
      data_type text NOT NULL CHECK (data_type IN ('NUMERIC','TEXT','ENUM')),
      limit_kind text NOT NULL CHECK (limit_kind IN ('MIN_MAX','MAX_ONLY','MIN_ONLY','TARGET_TOL','EXACT')),
      param_group text,
      applies_to text[] NOT NULL DEFAULT '{ALL}',
      sort_order int NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      is_mandatory_default boolean NOT NULL DEFAULT false,
      tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES security.tenant(tenant_id)
    );

    CREATE TABLE IF NOT EXISTS master.spec_sheet (
      spec_sheet_id serial PRIMARY KEY,
      grade_code text NOT NULL REFERENCES master.grade(grade_code),
      material_code text NOT NULL DEFAULT '',
      surface_finish text REFERENCES master.surface_finish(surface_finish),
      width_mm numeric,
      finish_thk_mm numeric,
      length_mm numeric,
      customer_id integer REFERENCES master.customer(customer_id),
      title text,
      end_product text,
      isi_mark text,
      is_active boolean NOT NULL DEFAULT true,
      tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES security.tenant(tenant_id),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_spec_sheet_identity
      ON master.spec_sheet (
        tenant_id,
        grade_code,
        COALESCE(material_code, ''),
        COALESCE(surface_finish, ''),
        COALESCE(width_mm, -1),
        COALESCE(finish_thk_mm, -1),
        COALESCE(length_mm, -1),
        COALESCE(customer_id, -1)
      );

    CREATE TABLE IF NOT EXISTS master.spec_sheet_version (
      version_id serial PRIMARY KEY,
      spec_sheet_id int NOT NULL REFERENCES master.spec_sheet(spec_sheet_id) ON DELETE CASCADE,
      version_no int NOT NULL,
      status text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED','RETIRED')),
      effective_from timestamptz,
      effective_to timestamptz,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      approved_by text,
      approved_at timestamptz,
      notes text,
      tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES security.tenant(tenant_id),
      UNIQUE (spec_sheet_id, version_no)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_spec_sheet_one_active
      ON master.spec_sheet_version (spec_sheet_id)
      WHERE status = 'ACTIVE';

    CREATE TABLE IF NOT EXISTS master.spec_value (
      version_id int NOT NULL REFERENCES master.spec_sheet_version(version_id) ON DELETE CASCADE,
      parameter_code text NOT NULL REFERENCES master.spec_parameter(parameter_code),
      min_value numeric,
      max_value numeric,
      target_value numeric,
      tolerance numeric,
      text_value text,
      is_mandatory boolean NOT NULL DEFAULT false,
      PRIMARY KEY (version_id, parameter_code)
    );

    CREATE TABLE IF NOT EXISTS planning.plan_order_spec (
      plan_order_id bigint PRIMARY KEY REFERENCES planning.plan_order(plan_order_id) ON DELETE CASCADE,
      version_id int NOT NULL REFERENCES master.spec_sheet_version(version_id),
      resolved_at timestamptz NOT NULL DEFAULT now(),
      resolved_by text NOT NULL DEFAULT 'SYSTEM',
      override_reason text,
      tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES security.tenant(tenant_id)
    );

    CREATE TABLE IF NOT EXISTS txn.qc_measurement (
      qc_id serial PRIMARY KEY,
      coil_no text NOT NULL,
      process_code text NOT NULL,
      parameter_code text NOT NULL REFERENCES master.spec_parameter(parameter_code),
      measured_value_num numeric,
      measured_value_text text,
      version_id int REFERENCES master.spec_sheet_version(version_id),
      verdict text NOT NULL DEFAULT 'NOT_EVALUATED'
        CHECK (verdict IN ('PASS','FAIL','NOT_EVALUATED')),
      shift_log_id bigint,
      entry_id bigint,
      measured_by text,
      measured_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES security.tenant(tenant_id)
    );
    CREATE INDEX IF NOT EXISTS ix_qc_measurement_coil ON txn.qc_measurement (coil_no);
    CREATE INDEX IF NOT EXISTS ix_qc_measurement_version ON txn.qc_measurement (version_id);

    INSERT INTO master.spec_parameter
      (parameter_code, label, unit, data_type, limit_kind, param_group, applies_to, sort_order, is_mandatory_default)
    VALUES
      ${inserts}
    ON CONFLICT (parameter_code) DO NOTHING;

    INSERT INTO security.role (role_id, role_name, description)
    VALUES (6, 'QUALITY', 'Quality: Authors and publishes material specification sheets')
    ON CONFLICT (role_id) DO NOTHING;

    DO \\$\\$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY[
        'master.spec_parameter',
        'master.spec_sheet',
        'master.spec_sheet_version',
        'master.spec_value',
        'planning.plan_order_spec',
        'txn.qc_measurement'
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
    END \\$\\$;

    INSERT INTO master.spec_sheet (grade_code, material_code, customer_id, title, tenant_id)
    SELECT gs.grade_code,
           '',
           gs.customer_id,
           gs.grade_code || CASE WHEN gs.customer_id IS NULL THEN ' (default)' ELSE ' (customer)' END,
           gs.tenant_id
    FROM master.grade_spec gs
    WHERE NOT EXISTS (
      SELECT 1 FROM master.spec_sheet s
      WHERE s.grade_code = gs.grade_code
        AND COALESCE(s.customer_id, -1) = COALESCE(gs.customer_id, -1)
        AND COALESCE(s.material_code, '') = ''
        AND s.surface_finish IS NULL
        AND s.width_mm IS NULL
        AND s.finish_thk_mm IS NULL
        AND s.length_mm IS NULL
    );

    INSERT INTO master.spec_sheet_version (spec_sheet_id, version_no, status, effective_from, created_by, notes, tenant_id)
    SELECT s.spec_sheet_id, 1, 'ACTIVE', now(), 'SYSTEM', 'Migrated from master.grade_spec', s.tenant_id
    FROM master.spec_sheet s
    WHERE NOT EXISTS (
      SELECT 1 FROM master.spec_sheet_version v WHERE v.spec_sheet_id = s.spec_sheet_id
    )
    AND EXISTS (
      SELECT 1 FROM master.grade_spec gs
      WHERE gs.grade_code = s.grade_code
        AND COALESCE(gs.customer_id, -1) = COALESCE(s.customer_id, -1)
    );

    INSERT INTO master.spec_value (version_id, parameter_code, min_value, max_value, is_mandatory)
    SELECT v.version_id, 'HARDNESS', gs.hardness_hrb_min, gs.hardness_hrb_max, true
    FROM master.grade_spec gs
    JOIN master.spec_sheet s
      ON s.grade_code = gs.grade_code
     AND COALESCE(s.customer_id, -1) = COALESCE(gs.customer_id, -1)
     AND COALESCE(s.material_code, '') = ''
     AND s.surface_finish IS NULL AND s.width_mm IS NULL AND s.finish_thk_mm IS NULL AND s.length_mm IS NULL
    JOIN master.spec_sheet_version v ON v.spec_sheet_id = s.spec_sheet_id AND v.version_no = 1
    WHERE gs.hardness_hrb_min IS NOT NULL OR gs.hardness_hrb_max IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO master.spec_value (version_id, parameter_code, min_value, max_value, is_mandatory)
    SELECT v.version_id, 'UTS', gs.uts_nmm2_min, gs.uts_nmm2_max, true
    FROM master.grade_spec gs
    JOIN master.spec_sheet s
      ON s.grade_code = gs.grade_code
     AND COALESCE(s.customer_id, -1) = COALESCE(gs.customer_id, -1)
     AND COALESCE(s.material_code, '') = ''
     AND s.surface_finish IS NULL AND s.width_mm IS NULL AND s.finish_thk_mm IS NULL AND s.length_mm IS NULL
    JOIN master.spec_sheet_version v ON v.spec_sheet_id = s.spec_sheet_id AND v.version_no = 1
    WHERE gs.uts_nmm2_min IS NOT NULL OR gs.uts_nmm2_max IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO master.spec_value (version_id, parameter_code, min_value, max_value, is_mandatory)
    SELECT v.version_id, 'ELONGATION', gs.elongation_pct_min, NULL, true
    FROM master.grade_spec gs
    JOIN master.spec_sheet s
      ON s.grade_code = gs.grade_code
     AND COALESCE(s.customer_id, -1) = COALESCE(gs.customer_id, -1)
     AND COALESCE(s.material_code, '') = ''
     AND s.surface_finish IS NULL AND s.width_mm IS NULL AND s.finish_thk_mm IS NULL AND s.length_mm IS NULL
    JOIN master.spec_sheet_version v ON v.spec_sheet_id = s.spec_sheet_id AND v.version_no = 1
    WHERE gs.elongation_pct_min IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO master.spec_value (version_id, parameter_code, min_value, max_value, is_mandatory)
    SELECT v.version_id, 'RA_UM', NULL, gs.ra_um_max, false
    FROM master.grade_spec gs
    JOIN master.spec_sheet s
      ON s.grade_code = gs.grade_code
     AND COALESCE(s.customer_id, -1) = COALESCE(gs.customer_id, -1)
     AND COALESCE(s.material_code, '') = ''
     AND s.surface_finish IS NULL AND s.width_mm IS NULL AND s.finish_thk_mm IS NULL AND s.length_mm IS NULL
    JOIN master.spec_sheet_version v ON v.spec_sheet_id = s.spec_sheet_id AND v.version_no = 1
    WHERE gs.ra_um_max IS NOT NULL
    ON CONFLICT DO NOTHING;
  \`);
};

exports.down = (pgm) => {
  pgm.sql(\`
    DROP TRIGGER IF EXISTS trg_audit_txn_qc_measurement ON txn.qc_measurement;
    DROP TRIGGER IF EXISTS trg_audit_planning_plan_order_spec ON planning.plan_order_spec;
    DROP TRIGGER IF EXISTS trg_audit_master_spec_value ON master.spec_value;
    DROP TRIGGER IF EXISTS trg_audit_master_spec_sheet_version ON master.spec_sheet_version;
    DROP TRIGGER IF EXISTS trg_audit_master_spec_sheet ON master.spec_sheet;
    DROP TRIGGER IF EXISTS trg_audit_master_spec_parameter ON master.spec_parameter;
    DROP TABLE IF EXISTS txn.qc_measurement;
    DROP TABLE IF EXISTS planning.plan_order_spec;
    DROP TABLE IF EXISTS master.spec_value;
    DROP TABLE IF EXISTS master.spec_sheet_version;
    DROP TABLE IF EXISTS master.spec_sheet;
    DROP TABLE IF EXISTS master.spec_parameter;
    DELETE FROM security.role WHERE role_name = 'QUALITY';
  \`);
};
`;

fs.writeFileSync('packages/server/migrations/1933000000000_quality_spec_sheet.js', migration);
console.log('wrote', migration.length, 'chars');
