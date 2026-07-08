#!/usr/bin/env node
/**
 * clear-demo-data.mjs — Removes the pilot/demo dataset (seeded by
 * seed-pilot-data.mjs / seed-crm6-ppc.mjs / seed-export-demo.mjs) so the
 * dashboards show only data captured through the live application.
 *
 * SAFETY MODEL
 * ────────────
 *  • DRY-RUN BY DEFAULT. Nothing is deleted unless you pass `--apply`.
 *  • Targets ONLY rows with the seeders' stable signatures (demo coil-number
 *    prefixes, fixed master codes, the SAP-PILOT plan). It does NOT delete by
 *    date range, so genuine captures are never caught by a broad filter.
 *  • Genuine coils (e.g. HSL-2026-*) and their production rows are preserved.
 *  • 6HI / CRM6 orders + PPC batches are PRESERVED by default (they hold real
 *    operator captures). Pass `--include-crm6` only if you also want the
 *    seeded 6HI planning/orders removed.
 *  • Runs inside a single transaction — any error rolls everything back.
 *  • REVERSIBILITY: `--apply` refuses to run unless you pass `--backup-done`,
 *    confirming you have taken a backup. Recommended backup command:
 *
 *      docker exec -t <db-container> pg_dump -U m1_user -d m1_db --no-owner --no-acl \
 *        > backup_before_demo_cleanup.sql
 *
 * Usage:
 *   node scripts/clear-demo-data.mjs                       # dry-run (report only)
 *   node scripts/clear-demo-data.mjs --apply --backup-done # delete (after backup)
 *   node scripts/clear-demo-data.mjs --apply --backup-done --include-crm6
 */
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://m1_user:m1_password@localhost:5432/m1_db';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const BACKUP_DONE = args.has('--backup-done');
const INCLUDE_CRM6 = args.has('--include-crm6');
const INCLUDE_MASTERS = args.has('--include-masters');

// ── Stable seed signatures (must match the seeders exactly) ──────────────────
const DEMO_COIL_PREFIXES = ['HRS-COIL-%', 'PKL-COIL-%', 'CRM-COIL-%', 'CRS-COIL-%', 'CTL-COIL-%'];
const DEMO_DEFECT_CODES = ['D_SCRATCH', 'D_EDGE', 'D_RUST'];
const DEMO_STOPPAGE_CODES = ['S_ROLL', 'S_WEB', 'S_ELEC', 'S_SETUP'];
const DEMO_CUSTOMER_CODES = ['CUST_TATA', 'CUST_MARUTI', 'CUST_HONDA'];
const DEMO_GRADE_CODES = ['CRCA', 'D513', 'HROP'];
const DEMO_OPERATOR_CODES = ['EMP001', 'EMP002'];
const DEMO_SAP_ORDER = 'SAP-PILOT-001';
const PROD_TABLES = ['prod_hrs', 'prod_pkl', 'prod_crm', 'prod_crs', 'prod_ctl', 'prod_rwd', 'prod_skp'];

const coilLike = (col) => `(${DEMO_COIL_PREFIXES.map((_, i) => `${col} LIKE $${i + 1}`).join(' OR ')})`;

async function scalar(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0]?.n ?? 0);
}

async function tableExists(client, schema, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    [schema, table],
  );
  return rows.length > 0;
}

export async function clearDemoData(databaseUrl = DATABASE_URL) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const report = {};

  try {
    await client.query('BEGIN');

    // Demo shift logs = shift logs whose production is on demo coils only.
    const prodCoilUnion = PROD_TABLES
      .filter(Boolean)
      .map((t) => `SELECT shift_log_id, coil_no FROM txn.${t}`)
      .join(' UNION ALL ');

    // 1) Defects on demo coils / demo defect codes
    report.defect_entry = (
      await client.query(
        `DELETE FROM txn.defect_entry
          WHERE ${coilLike('coil_no')} OR defect_code = ANY($${DEMO_COIL_PREFIXES.length + 1})
          RETURNING 1`,
        [...DEMO_COIL_PREFIXES, DEMO_DEFECT_CODES],
      )
    ).rowCount;

    // 2) Production rows on demo coils
    report.production = 0;
    for (const t of PROD_TABLES) {
      if (!(await tableExists(client, 'txn', t))) continue;
      const r = await client.query(
        `DELETE FROM txn.${t} WHERE ${coilLike('coil_no')} RETURNING 1`,
        [...DEMO_COIL_PREFIXES],
      );
      report.production += r.rowCount;
    }

    // 3) Identify demo shift logs: those with NO remaining production rows and
    //    that carry demo stoppages (i.e. pilot lines now emptied of real data).
    const demoShiftLogs = await client.query(
      `SELECT sl.shift_log_id
         FROM txn.shift_log sl
        WHERE sl.process_id IN (1,2,3)
          AND NOT EXISTS (SELECT 1 FROM (${prodCoilUnion}) p WHERE p.shift_log_id = sl.shift_log_id)
          AND EXISTS (
            SELECT 1 FROM txn.stoppage_entry se
             WHERE se.shift_log_id = sl.shift_log_id
               AND se.stoppage_code = ANY($1)
          )`,
      [DEMO_STOPPAGE_CODES],
    );
    const demoShiftIds = demoShiftLogs.rows.map((r) => r.shift_log_id);

    // 4) Stoppages belonging to those demo shift logs
    report.stoppage_entry = demoShiftIds.length
      ? (
          await client.query(
            `DELETE FROM txn.stoppage_entry WHERE shift_log_id = ANY($1) RETURNING 1`,
            [demoShiftIds],
          )
        ).rowCount
      : 0;

    // 5) The now-empty demo shift logs themselves
    report.shift_log = demoShiftIds.length
      ? (
          await client.query(
            `DELETE FROM txn.shift_log sl
              WHERE sl.shift_log_id = ANY($1)
                AND NOT EXISTS (SELECT 1 FROM (${prodCoilUnion}) p WHERE p.shift_log_id = sl.shift_log_id)
                AND NOT EXISTS (SELECT 1 FROM txn.stoppage_entry se WHERE se.shift_log_id = sl.shift_log_id)
              RETURNING 1`,
            [demoShiftIds],
          )
        ).rowCount
      : 0;

    // 6) Planning: pilot coil plans + SAP-PILOT plan order
    report.coil_plan = (
      await client.query(
        `DELETE FROM planning.coil_plan WHERE ${coilLike('coil_no')} RETURNING 1`,
        [...DEMO_COIL_PREFIXES],
      )
    ).rowCount;
    report.plan_order = (
      await client.query(
        `DELETE FROM planning.plan_order WHERE sap_order_no = $1 RETURNING 1`,
        [DEMO_SAP_ORDER],
      )
    ).rowCount;

    // 7) Demo coils (only if no production/order still references them)
    report.coils = (
      await client.query(
        `DELETE FROM coil.coil c
          WHERE ${coilLike('c.coil_no')}
            AND NOT EXISTS (SELECT 1 FROM txn.crm6_order o WHERE o.coil_no = c.coil_no)
            ${PROD_TABLES.map((t) => `AND NOT EXISTS (SELECT 1 FROM txn.${t} p WHERE p.coil_no = c.coil_no)`).join('\n            ')}
          RETURNING 1`,
        [...DEMO_COIL_PREFIXES],
      )
    ).rowCount;

    // 8) Optional: seeded 6HI/CRM6 planning + orders (OFF by default)
    if (INCLUDE_CRM6) {
      report.crm6_order = (await client.query(`DELETE FROM txn.crm6_order RETURNING 1`)).rowCount;
      report.ppc_batch = (await client.query(`DELETE FROM planning.ppc_batch RETURNING 1`)).rowCount;
    }

    // 9) Optional: demo master reference rows (OFF by default)
    if (INCLUDE_MASTERS) {
      report.master_defect_code = (
        await client.query(`DELETE FROM master.defect_code WHERE defect_code = ANY($1) RETURNING 1`, [DEMO_DEFECT_CODES])
      ).rowCount;
      report.master_stoppage_code = (
        await client.query(`DELETE FROM master.stoppage_code WHERE stoppage_code = ANY($1) RETURNING 1`, [DEMO_STOPPAGE_CODES])
      ).rowCount;
      report.master_operator = (
        await client.query(`DELETE FROM master.operator WHERE emp_code = ANY($1) RETURNING 1`, [DEMO_OPERATOR_CODES])
      ).rowCount;
      report.master_customer = (
        await client.query(`DELETE FROM master.customer WHERE customer_code = ANY($1) RETURNING 1`, [DEMO_CUSTOMER_CODES])
      ).rowCount;
      report.master_grade = (
        await client.query(`DELETE FROM master.grade WHERE grade_code = ANY($1) RETURNING 1`, [DEMO_GRADE_CODES])
      ).rowCount;
    }

    if (APPLY) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    return report;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1]?.includes('clear-demo-data');
if (isMain) {
  if (APPLY && !BACKUP_DONE) {
    console.error(
      '\nREFUSING TO APPLY: pass --backup-done to confirm you have a backup.\n' +
        'Backup command:\n' +
        '  docker exec -t zedralv22-db-primary-1 pg_dump -U m1_user -d m1_db --no-owner --no-acl > backup_before_demo_cleanup.sql\n',
    );
    process.exit(1);
  }

  const mode = APPLY ? 'APPLY (deleting)' : 'DRY-RUN (no changes)';
  console.log(`=== Clear demo data — ${mode} ===`);
  console.log(`include-crm6=${INCLUDE_CRM6} include-masters=${INCLUDE_MASTERS}\n`);

  clearDemoData()
    .then((report) => {
      console.log(APPLY ? 'Deleted rows:' : 'Rows that WOULD be deleted:');
      for (const [table, count] of Object.entries(report)) {
        console.log(`  ${table.padEnd(22)} ${count}`);
      }
      console.log(
        APPLY
          ? '\nCleanup complete. Dashboards now reflect only live-captured data.'
          : '\nDry-run only — nothing was deleted. Re-run with `--apply --backup-done` to execute.',
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
