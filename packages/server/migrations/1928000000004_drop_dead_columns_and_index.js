/**
 * P8 / E8+E9 — drop dead columns + redundant active-session index.
 * Recreates audit.fn_audit without change_request_id (same PK/key logic as 1781…).
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.sql(`
CREATE OR REPLACE FUNCTION audit.fn_audit() RETURNS trigger AS $$
DECLARE
    pk TEXT;
    uid INTEGER;
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
        NULLIF(to_jsonb(NEW)->>'order_id', ''),
        NULLIF(to_jsonb(OLD)->>'order_id', ''),
        NULLIF(to_jsonb(NEW)->>'tenant_id', ''),
        NULLIF(to_jsonb(OLD)->>'tenant_id', ''),
        'UNKNOWN'
    );

    uid := NULLIF(current_setting('app.user_id', true), '')::integer;

    IF (TG_OP = 'UPDATE') THEN
        old_row := to_jsonb(OLD);
        new_row := to_jsonb(NEW);
        FOR k IN SELECT jsonb_object_keys(new_row) LOOP
            v_old := old_row->>k;
            v_new := new_row->>k;
            IF v_old IS DISTINCT FROM v_new THEN
                INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, old_value, new_value, user_id, ts)
                VALUES (tbl, pk, 'UPDATE', k, v_old, v_new, uid, now());
            END IF;
        END LOOP;
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        new_row := to_jsonb(NEW);
        FOR k IN SELECT jsonb_object_keys(new_row) LOOP
            v_new := new_row->>k;
            INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, new_value, user_id, ts)
            VALUES (tbl, pk, 'INSERT', k, v_new, uid, now());
        END LOOP;
        RETURN NEW;
    ELSE
        old_row := to_jsonb(OLD);
        FOR k IN SELECT jsonb_object_keys(old_row) LOOP
            v_old := old_row->>k;
            INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, old_value, user_id, ts)
            VALUES (tbl, pk, 'DELETE', k, v_old, uid, now());
        END LOOP;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE audit.audit_log DROP COLUMN IF EXISTS change_request_id;
ALTER TABLE security.app_user DROP COLUMN IF EXISTS auth_subject;
DROP INDEX IF EXISTS txn.ix_machine_shift_session_active;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit.audit_log ADD COLUMN IF NOT EXISTS change_request_id BIGINT;
    ALTER TABLE security.app_user ADD COLUMN IF NOT EXISTS auth_subject VARCHAR(255);
    CREATE INDEX IF NOT EXISTS ix_machine_shift_session_active
      ON txn.machine_shift_session (machine_code) WHERE ended_at IS NULL;
  `);
};
