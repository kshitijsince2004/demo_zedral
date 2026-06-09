/**
 * @deprecated Superseded by formal migration 1781000000003_audit_baseline_triggers.js.
 * Run `npm run migrate` instead. This script is retained for manual recovery only.
 */
import { db } from '../src/db';
import { sql } from 'kysely';

async function migrate() {
  console.warn('DEPRECATED: use migration 1781000000003_audit_baseline_triggers.js via npm run migrate');
  console.log('Starting Phase 12 Audit Trail Migration...');

  try {
    await db.transaction().execute(async (trx) => {
      
      console.log('Replacing audit.fn_audit() function...');
      
      await sql.raw(`
        CREATE OR REPLACE FUNCTION audit.fn_audit() RETURNS trigger AS $$
        DECLARE 
            pk TEXT;
            uid INTEGER;
            cr_id BIGINT;
            old_row JSONB;
            new_row JSONB;
            k TEXT;
            v_old TEXT;
            v_new TEXT;
        BEGIN
            -- The primary key is either entry_id or the first column in composite, but we assume entry_id or id
            -- Using a generic approach to extract 'id' or 'entry_id' or 'charge_no' etc.
            pk := COALESCE(NEW.entry_id::text, OLD.entry_id::text, NEW.id::text, OLD.id::text, '');
            
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
                        VALUES (TG_TABLE_NAME, pk, 'UPDATE', k, v_old, v_new, uid, cr_id, now());
                    END IF;
                END LOOP;
                RETURN NEW;
            ELSIF (TG_OP = 'INSERT') THEN
                new_row := to_jsonb(NEW);
                FOR k IN SELECT jsonb_object_keys(new_row) LOOP
                    v_new := new_row->>k;
                    INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, new_value, user_id, change_request_id, ts)
                    VALUES (TG_TABLE_NAME, pk, 'INSERT', k, v_new, uid, cr_id, now());
                END LOOP;
                RETURN NEW;
            ELSE
                old_row := to_jsonb(OLD);
                FOR k IN SELECT jsonb_object_keys(old_row) LOOP
                    v_old := old_row->>k;
                    INSERT INTO audit.audit_log(table_name, record_pk, action, column_name, old_value, user_id, change_request_id, ts)
                    VALUES (TG_TABLE_NAME, pk, 'DELETE', k, v_old, uid, cr_id, now());
                END LOOP;
                RETURN OLD;
            END IF;
        END; $$ LANGUAGE plpgsql;
      `).execute(trx);

      console.log('Attaching trigger to transactional tables...');

      const tables = [
        'txn.shift_log',
        'txn.prod_hrs_slit',
        'txn.prod_pkl',
        'txn.prod_crm',
        'txn.ann_charge',
        'txn.prod_skp',
        'txn.prod_rwd',
        'txn.prod_crs',
        'txn.prod_ctl',
        'txn.stoppage_entry',
        'txn.defect_entry',
        'txn.validation_overrides'
      ];

      for (const table of tables) {
        console.log(`Ensuring trigger on ${table}...`);
        await sql.raw(`
          DROP TRIGGER IF EXISTS trg_audit_${table.split('.')[1]} ON ${table};
          CREATE TRIGGER trg_audit_${table.split('.')[1]} AFTER INSERT OR UPDATE OR DELETE
            ON ${table} FOR EACH ROW EXECUTE FUNCTION audit.fn_audit();
        `).execute(trx);
      }

    });

    console.log('Phase 12 Audit Trail Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrate();
