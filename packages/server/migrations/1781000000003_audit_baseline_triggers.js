/**
 * Batch 4 — Audit alignment: baseline M1-08 column names + per-column triggers.
 * Reverts migration 1717200000002 renames if present, replaces audit.fn_audit,
 * attaches triggers to all capture/master tables, enforces append-only audit_log.
 */

const AUDITED_TABLES = [
  'txn.shift_log',
  'txn.stoppage_entry',
  'txn.crew_entry',
  'txn.prod_hrs',
  'txn.prod_hrs_slit',
  'txn.prod_pkl',
  'txn.prod_pkl_chart',
  'txn.prod_crm',
  'txn.ann_charge',
  'txn.ann_charge_coil',
  'txn.prod_skp',
  'txn.prod_skp_pass',
  'txn.prod_rwd',
  'txn.prod_crs',
  'txn.prod_crs_slit',
  'txn.prod_ctl',
  'txn.prod_glv',
  'txn.defect_entry',
  'txn.validation_overrides',
  'coil.coil',
  'coil.coil_process_history',
  'planning.plan_order',
  'planning.coil_plan',
  'master.customer',
  'master.grade',
  'master.grade_spec',
  'master.defect_code',
  'master.stoppage_code',
  'master.operator',
  'master.furnace',
  'master.rp_oil_grade',
  'master.surface_finish',
  'security.tenant_config',
];

const FN_AUDIT = `
CREATE OR REPLACE FUNCTION audit.fn_audit() RETURNS trigger AS $$
DECLARE
    pk TEXT;
    uid INTEGER;
    cr_id BIGINT;
    tbl TEXT;
    old_row JSONB;
    new_row JSONB;
    k TEXT;
    v_old TEXT;
    v_new TEXT;
BEGIN
    tbl := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;

    pk := COALESCE(
        NULLIF(to_jsonb(NEW)->>'entry_id', ''),
        NULLIF(to_jsonb(OLD)->>'entry_id', ''),
        NULLIF(to_jsonb(NEW)->>'shift_log_id', ''),
        NULLIF(to_jsonb(OLD)->>'shift_log_id', ''),
        NULLIF(to_jsonb(NEW)->>'coil_no', ''),
        NULLIF(to_jsonb(OLD)->>'coil_no', ''),
        NULLIF(to_jsonb(NEW)->>'charge_no', ''),
        NULLIF(to_jsonb(OLD)->>'charge_no', ''),
        NULLIF(to_jsonb(NEW)->>'stoppage_id', ''),
        NULLIF(to_jsonb(OLD)->>'stoppage_id', ''),
        NULLIF(to_jsonb(NEW)->>'defect_id', ''),
        NULLIF(to_jsonb(OLD)->>'defect_id', ''),
        NULLIF(to_jsonb(NEW)->>'override_id', ''),
        NULLIF(to_jsonb(OLD)->>'override_id', ''),
        NULLIF(to_jsonb(NEW)->>'customer_id', ''),
        NULLIF(to_jsonb(OLD)->>'customer_id', ''),
        NULLIF(to_jsonb(NEW)->>'grade_code', ''),
        NULLIF(to_jsonb(OLD)->>'grade_code', ''),
        NULLIF(to_jsonb(NEW)->>'defect_code', ''),
        NULLIF(to_jsonb(OLD)->>'defect_code', ''),
        NULLIF(to_jsonb(NEW)->>'stoppage_code', ''),
        NULLIF(to_jsonb(OLD)->>'stoppage_code', ''),
        NULLIF(to_jsonb(NEW)->>'coil_plan_id', ''),
        NULLIF(to_jsonb(OLD)->>'coil_plan_id', ''),
        NULLIF(to_jsonb(NEW)->>'plan_order_id', ''),
        NULLIF(to_jsonb(OLD)->>'plan_order_id', ''),
        NULLIF(to_jsonb(NEW)->>'import_batch_id', ''),
        NULLIF(to_jsonb(OLD)->>'import_batch_id', ''),
        NULLIF(to_jsonb(NEW)->>'cr_id', ''),
        NULLIF(to_jsonb(OLD)->>'cr_id', ''),
        NULLIF(to_jsonb(NEW)->>'tenant_id', ''),
        NULLIF(to_jsonb(OLD)->>'tenant_id', ''),
        'UNKNOWN'
    );

    uid := NULLIF(current_setting('app.user_id', true), '')::integer;
    cr_id := NULLIF(current_setting('app.change_request_id', true), '')::bigint;

    IF (TG_OP = 'UPDATE') THEN
        old_row := to_jsonb(OLD);
        new_row := to_jsonb(NEW);
        FOR k IN SELECT jsonb_object_keys(new_row) LOOP
            v_old := old_row->>k;
            v_new := new_row->>k;
            IF v_old IS DISTINCT FROM v_new THEN
                INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, old_value, new_value, user_id, change_request_id, ts)
                VALUES (tbl, pk, 'UPDATE', k, v_old, v_new, uid, cr_id, now());
            END IF;
        END LOOP;
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        new_row := to_jsonb(NEW);
        FOR k IN SELECT jsonb_object_keys(new_row) LOOP
            v_new := new_row->>k;
            INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, new_value, user_id, change_request_id, ts)
            VALUES (tbl, pk, 'INSERT', k, v_new, uid, cr_id, now());
        END LOOP;
        RETURN NEW;
    ELSE
        old_row := to_jsonb(OLD);
        FOR k IN SELECT jsonb_object_keys(old_row) LOOP
            v_old := old_row->>k;
            INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, old_value, user_id, change_request_id, ts)
            VALUES (tbl, pk, 'DELETE', k, v_old, uid, cr_id, now());
        END LOOP;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;
`;

function attachTriggers(pgm) {
  for (const table of AUDITED_TABLES) {
    const [schema, shortName] = table.split('.');
    pgm.sql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = '${schema}' AND table_name = '${shortName}'
        ) THEN
          EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_${shortName} ON ${table}';
          EXECUTE 'CREATE TRIGGER trg_audit_${shortName} AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION audit.fn_audit()';
        END IF;
      END $$;
    `);
  }
}

function dropTriggers(pgm) {
  for (const table of AUDITED_TABLES) {
    const shortName = table.split('.')[1];
    pgm.sql(`DROP TRIGGER IF EXISTS trg_audit_${shortName} ON ${table};`);
  }
}

exports.up = (pgm) => {
  // Reconcile schema to M1-08 baseline names if migration 2 ran
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'audit_log' AND column_name = 'resource'
      ) THEN
        ALTER TABLE audit.audit_log RENAME COLUMN resource TO table_name;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'audit_log' AND column_name = 'actor_id'
      ) THEN
        ALTER TABLE audit.audit_log RENAME COLUMN actor_id TO user_id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'audit_log' AND column_name = 'before_value'
      ) THEN
        ALTER TABLE audit.audit_log RENAME COLUMN before_value TO old_value;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'audit_log' AND column_name = 'after_value'
      ) THEN
        ALTER TABLE audit.audit_log RENAME COLUMN after_value TO new_value;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'audit_log' AND column_name = 'actor'
      ) THEN
        ALTER TABLE audit.audit_log DROP COLUMN actor;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'audit' AND table_name = 'audit_log' AND column_name = 'correlation_id'
      ) THEN
        ALTER TABLE audit.audit_log DROP COLUMN correlation_id;
      END IF;
    END $$;
  `);

  pgm.sql(FN_AUDIT);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION audit.fn_prevent_modify() RETURNS trigger AS $$
    BEGIN
        RAISE EXCEPTION 'Audit log is append-only. Modification is strictly prohibited.';
    END;
    $$ LANGUAGE plpgsql;

    REVOKE UPDATE, DELETE ON audit.audit_log FROM PUBLIC;

    DROP TRIGGER IF EXISTS trg_audit_immutability ON audit.audit_log;
    CREATE TRIGGER trg_audit_immutability
      BEFORE UPDATE OR DELETE ON audit.audit_log
      FOR EACH ROW EXECUTE FUNCTION audit.fn_prevent_modify();
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS txn.validation_overrides (
      override_id     BIGSERIAL    PRIMARY KEY,
      shift_log_id    BIGINT       NOT NULL REFERENCES txn.shift_log(shift_log_id) ON DELETE CASCADE,
      field_path      VARCHAR(120) NOT NULL,
      reason          VARCHAR(300) NOT NULL,
      override_by     INTEGER      NOT NULL REFERENCES security.app_user(user_id),
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    ALTER TABLE audit.change_request
      ADD COLUMN IF NOT EXISTS proposed_changes JSONB;
  `);

  attachTriggers(pgm);
};

exports.down = (pgm) => {
  dropTriggers(pgm);
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_audit_immutability ON audit.audit_log;
    DROP FUNCTION IF EXISTS audit.fn_prevent_modify();
    DROP FUNCTION IF EXISTS audit.fn_audit();
  `);
};
