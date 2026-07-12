import { db } from '../src/db';
import { sql } from 'kysely';

async function migrate() {
  console.log('Starting Phase 11 RLS Migration...');

  try {
    await db.transaction().execute(async (trx) => {
      
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
        console.log(`Enabling RLS on ${table}...`);
        await sql.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`).execute(trx);
      }

      // 1. Shift Log policies
      console.log('Creating policies for txn.shift_log...');
      await sql.raw(`
        -- READ POLICY
        CREATE POLICY rls_shift_log_read ON txn.shift_log FOR SELECT
        USING (
            current_setting('app.user_id', true) = '' OR
            process_id IN (SELECT process_id FROM security.line_access WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
            OR EXISTS (
                SELECT 1 FROM security.user_role ur
                JOIN security.role r ON ur.role_id = r.role_id
                WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
                AND r.role_name IN ('ADMIN', 'PLANT_HEAD')
            )
        );

        -- WRITE POLICY (INSERT/UPDATE/DELETE)
        CREATE POLICY rls_shift_log_write ON txn.shift_log FOR ALL
        USING (
            current_setting('app.user_id', true) = '' OR
            (
                process_id IN (SELECT process_id FROM security.line_access WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
                AND EXISTS (
                    SELECT 1 FROM security.user_role ur
                    JOIN security.role r ON ur.role_id = r.role_id
                    WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
                    AND r.role_name IN ('OPERATOR', 'MACHINE_HEAD')
                )
            )
        )
        WITH CHECK (
            current_setting('app.user_id', true) = '' OR
            (
                process_id IN (SELECT process_id FROM security.line_access WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
                AND EXISTS (
                    SELECT 1 FROM security.user_role ur
                    JOIN security.role r ON ur.role_id = r.role_id
                    WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
                    AND r.role_name IN ('OPERATOR', 'MACHINE_HEAD')
                )
            )
        );
      `).execute(trx);

      // 2. Child Tables policies (join through shift_log_id)
      const childTables = tables.filter(t => t !== 'txn.shift_log');

      for (const table of childTables) {
        console.log(`Creating policies for ${table}...`);
        
        // For ann_charge, the column is shift_log_id just like the rest, so it's consistent.
        await sql.raw(`
          CREATE POLICY rls_${table.split('.')[1]}_read ON ${table} FOR SELECT
          USING (
              current_setting('app.user_id', true) = '' OR
              shift_log_id IN (
                  SELECT shift_log_id FROM txn.shift_log 
                  WHERE process_id IN (SELECT process_id FROM security.line_access WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
                     OR EXISTS (
                          SELECT 1 FROM security.user_role ur
                          JOIN security.role r ON ur.role_id = r.role_id
                          WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
                          AND r.role_name IN ('ADMIN', 'PLANT_HEAD')
                     )
              )
          );

          CREATE POLICY rls_${table.split('.')[1]}_write ON ${table} FOR ALL
          USING (
              current_setting('app.user_id', true) = '' OR
              shift_log_id IN (
                  SELECT shift_log_id FROM txn.shift_log 
                  WHERE process_id IN (SELECT process_id FROM security.line_access WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
                    AND EXISTS (
                          SELECT 1 FROM security.user_role ur
                          JOIN security.role r ON ur.role_id = r.role_id
                          WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
                          AND r.role_name IN ('OPERATOR', 'MACHINE_HEAD')
                    )
              )
          )
          WITH CHECK (
              current_setting('app.user_id', true) = '' OR
              shift_log_id IN (
                  SELECT shift_log_id FROM txn.shift_log 
                  WHERE process_id IN (SELECT process_id FROM security.line_access WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::integer)
                    AND EXISTS (
                          SELECT 1 FROM security.user_role ur
                          JOIN security.role r ON ur.role_id = r.role_id
                          WHERE ur.user_id = NULLIF(current_setting('app.user_id', true), '')::integer
                          AND r.role_name IN ('OPERATOR', 'MACHINE_HEAD')
                    )
              )
          );
        `).execute(trx);
      }
    });

    console.log('Phase 11 RLS Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrate();
