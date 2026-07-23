/**
 * Restore audit.fn_audit after a stub (entry_id/field_id-only, whole-row) overwrote
 * the baseline from 1781000000003 / 1928000000004.
 *
 * Shape matches AuditTrailService / Plant Head UI:
 * - UPDATE → one row per changed column (Field / Old / New populated)
 * - INSERT / DELETE → one row with full JSON; record_pk always set
 *
 * @type {import("node-pg-migrate").MigrationBuilder}
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
    row_json JSONB;
BEGIN
    tbl := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
    row_json := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

    pk := COALESCE(
        NULLIF(row_json->>'entry_id', ''),
        NULLIF(row_json->>'field_id', ''),
        NULLIF(row_json->>'shift_log_id', ''),
        NULLIF(row_json->>'coil_no', ''),
        NULLIF(row_json->>'charge_no', ''),
        NULLIF(row_json->>'stoppage_id', ''),
        NULLIF(row_json->>'defect_id', ''),
        NULLIF(row_json->>'override_id', ''),
        NULLIF(row_json->>'customer_id', ''),
        NULLIF(row_json->>'grade_code', ''),
        NULLIF(row_json->>'defect_code', ''),
        NULLIF(row_json->>'stoppage_code', ''),
        NULLIF(row_json->>'coil_plan_id', ''),
        NULLIF(row_json->>'plan_order_id', ''),
        NULLIF(row_json->>'import_batch_id', ''),
        NULLIF(row_json->>'order_id', ''),
        NULLIF(row_json->>'export_id', ''),
        NULLIF(row_json->>'user_id', ''),
        NULLIF(row_json->>'process_id', ''),
        NULLIF(row_json->>'machine_code', ''),
        NULLIF(row_json->>'tenant_id', ''),
        NULLIF(to_jsonb(OLD)->>'entry_id', ''),
        NULLIF(to_jsonb(OLD)->>'field_id', ''),
        NULLIF(to_jsonb(OLD)->>'shift_log_id', ''),
        NULLIF(to_jsonb(OLD)->>'defect_code', ''),
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
        INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, new_value, user_id, ts)
        VALUES (tbl, pk, 'INSERT', NULL, row_to_json(NEW)::text, uid, now());
        RETURN NEW;
    ELSE
        INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, old_value, user_id, ts)
        VALUES (tbl, pk, 'DELETE', NULL, row_to_json(OLD)::text, uid, now());
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;
  `);
};

exports.down = (_pgm) => {
  // No-op: previous stub must not be restored.
};