#!/usr/bin/env node
/**
 * Seeds pilot demo data: masters, coils, planning, shift logs, production,
 * stoppages, and defects. Idempotent — safe to re-run.
 */
import pg from 'pg';
import { seedSixHiPpc } from './seed-crm6-ppc.mjs';
import { seedExportDemo } from './seed-export-demo.mjs';
import { seedProcessQueues } from './seed-process-queues.mjs';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

export async function seedPilotData(databaseUrl = DEFAULT_URL, opts = {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);

  try {
    await client.query('BEGIN');

    // ── Master reference data ─────────────────────────────────────────────
    await client.query(`
      INSERT INTO master.shift (shift_code, name, start_time, end_time) VALUES
        ('A', 'Morning Shift', '06:00', '14:00'),
        ('B', 'Afternoon Shift', '14:00', '22:00'),
        ('C', 'Night Shift', '22:00', '06:00')
      ON CONFLICT (shift_code) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO master.customer (customer_code, customer_name) VALUES
        ('CUST_TATA', 'Tata Motors'),
        ('CUST_MARUTI', 'Maruti Suzuki'),
        ('CUST_HONDA', 'Honda Cars India')
      ON CONFLICT (customer_code) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO master.grade (grade_code, description, grade_family) VALUES
        ('CRCA', 'Cold Rolled Close Annealed', 'CRCA'),
        ('D513', 'Deep Drawing Grade', 'CRCA'),
        ('HROP', 'Hot Rolled Pickled & Oiled', 'HROP')
      ON CONFLICT (grade_code) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO master.surface_finish (surface_finish, description) VALUES
        ('M', 'Matt Finish'),
        ('B', 'Bright Finish')
      ON CONFLICT (surface_finish) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO master.defect_code (defect_code, symbol, description, applies_to) VALUES
        ('D_SCRATCH', 'SC', 'Surface Scratch', 'HRS,PKL,CRM,CRS'),
        ('D_EDGE', 'ED', 'Edge Wave', 'CRM,CRS'),
        ('D_RUST', 'RU', 'Surface Rust', 'PKL,CRM')
      ON CONFLICT (defect_code) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO master.stoppage_code (stoppage_code, description, category, is_planned) VALUES
        ('S_ROLL', 'Roll Change', 'MECH', TRUE),
        ('S_WEB', 'Web Break', 'MECH', FALSE),
        ('S_ELEC', 'Electrical Fault', 'ELECT', FALSE),
        ('S_SETUP', 'Line Setup', 'OPN', TRUE)
      ON CONFLICT (stoppage_code) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO master.operator (emp_code, full_name) VALUES
        ('EMP001', 'Rajesh Kumar'),
        ('EMP002', 'Amit Singh')
      ON CONFLICT (emp_code) DO NOTHING;
    `);

    const cust = await client.query(
      `SELECT customer_id, customer_code FROM master.customer WHERE customer_code IN ('CUST_TATA','CUST_MARUTI')`,
    );
    const custMap = Object.fromEntries(cust.rows.map((r) => [r.customer_code, r.customer_id]));
    const tataId = custMap.CUST_TATA;
    const marutiId = custMap.CUST_MARUTI;

    // ── Coils ─────────────────────────────────────────────────────────────
    const coils = [
      ['HRS-COIL-001', null, tataId, 'CRCA', 1250, 4.0, 24.5, 1, 'PKL', 'PLANNED'],
      ['HRS-COIL-002', null, marutiId, 'D513', 1500, 3.5, 28.0, 1, 'PKL', 'PLANNED'],
      ['HRS-COIL-003', null, tataId, 'CRCA', 1250, 4.0, 22.0, 1, 'PKL', 'IN_PROCESS'],
      ['PKL-COIL-001', 'HRS-COIL-001', tataId, 'CRCA', 1250, 3.8, 23.0, 2, 'CRM', 'PLANNED'],
      ['PKL-COIL-002', 'HRS-COIL-002', marutiId, 'D513', 1500, 3.2, 26.5, 2, 'CRM', 'PLANNED'],
      ['CRM-COIL-001', 'PKL-COIL-001', tataId, 'CRCA', 1250, 2.5, 21.0, 3, 'ANN', 'PLANNED'],
      ['CRM-COIL-002', 'PKL-COIL-002', marutiId, 'D513', 1500, 2.0, 24.0, 3, 'ANN', 'PLANNED'],
      ['CRS-COIL-001', null, tataId, 'CRCA', 1200, 1.2, 10.5, 7, 'CTL', 'PLANNED'],
      ['CTL-COIL-001', null, marutiId, 'D513', 1000, 1.0, 8.5, 8, null, 'PLANNED'],
    ];

    for (const c of coils) {
      await client.query(
        `INSERT INTO coil.coil (coil_no, parent_coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, current_process_id, next_dest, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (coil_no) DO UPDATE SET
           status = EXCLUDED.status,
           current_process_id = EXCLUDED.current_process_id,
           weight_mt = EXCLUDED.weight_mt`,
        c,
      );
    }

    // ── Planning ──────────────────────────────────────────────────────────
    const planRes = await client.query(`
      INSERT INTO planning.plan_order (sap_order_no, customer_id, grade_code, planned_qty_mt)
      VALUES ('SAP-PILOT-001', $1, 'CRCA', 150.0)
      ON CONFLICT (sap_order_no) DO UPDATE SET planned_qty_mt = EXCLUDED.planned_qty_mt
      RETURNING plan_order_id
    `, [tataId]);
    const planOrderId = planRes.rows[0].plan_order_id;

    for (const [coilNo, seq] of [
      ['HRS-COIL-001', 1],
      ['HRS-COIL-002', 2],
      ['HRS-COIL-003', 3],
    ]) {
      await client.query(
        `INSERT INTO planning.coil_plan (plan_order_id, coil_no, planned_process_id, seq_no)
         SELECT $1, $2::varchar(30), 1, $3::smallint
         WHERE NOT EXISTS (
           SELECT 1 FROM planning.coil_plan
           WHERE coil_no = $2::varchar(30) AND planned_process_id = 1
         )`,
        [planOrderId, coilNo, seq],
      );
    }

    // shift_manager_id / line_incharge_id reference master.operator, not app_user
    const operators = await client.query(
      `SELECT operator_id, emp_code FROM master.operator WHERE emp_code = 'EMP001' LIMIT 1`,
    );
    const shiftManagerId = operators.rows[0]?.operator_id ?? null;

    // Allow open stoppages (running downtime indicator)
    await client.query(`
      ALTER TABLE txn.stoppage_entry ALTER COLUMN time_to DROP NOT NULL;
    `);

    const today = new Date();
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const lineConfigs = [
      { processId: 1, code: 'HRS', target: 130, prodFactor: 0.92 },
      { processId: 2, code: 'PKL', target: 110, prodFactor: 0.88 },
      { processId: 3, code: 'CRM', target: 95, prodFactor: 0.85, millType: '4HI' },
    ];

    let submittedShiftId = null;
    let activeShiftId = null;

    for (const dateStr of dates) {
      const dayIndex = dates.indexOf(dateStr);
      const isToday = dateStr === dates[dates.length - 1];

      for (const line of lineConfigs) {
        const prodMt = Math.round(line.target * line.prodFactor * (0.9 + dayIndex * 0.02) * 10) / 10;
        let state = 'APPROVED';
        if (isToday && line.code === 'HRS') state = 'DRAFT';
        else if (isToday && line.code === 'PKL') state = 'SUBMITTED';
        else if (dayIndex === 5 && line.code === 'CRM') state = 'SUBMITTED';

        const submittedAt = state === 'SUBMITTED' || state === 'APPROVED' ? new Date() : null;
        const approvedAt = state === 'APPROVED' ? new Date() : null;

        const shiftRes = await client.query(
          `INSERT INTO txn.shift_log (process_id, prod_date, shift_code, mill_type, target_mt, total_prod_mt, state, shift_manager_id, submitted_at, approved_at)
           VALUES ($1, $2::date, 'A', $3, $4, $5, $6::varchar(16), $7, $8, $9)
           ON CONFLICT (prod_date, shift_code, process_id, mill_type)
           DO UPDATE SET target_mt = EXCLUDED.target_mt, total_prod_mt = EXCLUDED.total_prod_mt, state = EXCLUDED.state
           RETURNING shift_log_id`,
          [line.processId, dateStr, line.millType || null, line.target, prodMt, state, shiftManagerId, submittedAt, approvedAt],
        );
        const shiftLogId = shiftRes.rows[0].shift_log_id;

        if (state === 'SUBMITTED' && !submittedShiftId) submittedShiftId = shiftLogId;
        if (isToday && line.code === 'HRS') activeShiftId = shiftLogId;

        // Production entry
        const coilNo =
          line.code === 'HRS' ? 'HRS-COIL-003' :
          line.code === 'PKL' ? 'PKL-COIL-001' : 'CRM-COIL-001';

        if (line.code === 'HRS') {
          await client.query(
            `INSERT INTO txn.prod_hrs (shift_log_id, coil_no, scrap_mt, time_from, time_to, weight_mt)
             SELECT $1, $2::varchar(30), 1.2, '08:00', '12:00', $3
             WHERE NOT EXISTS (
               SELECT 1 FROM txn.prod_hrs WHERE shift_log_id = $1 AND coil_no = $2::varchar(30)
             )`,
            [shiftLogId, coilNo, prodMt],
          );
        } else if (line.code === 'PKL') {
          await client.query(
            `INSERT INTO txn.prod_pkl (shift_log_id, coil_no, weight_mt, time_from, time_to)
             SELECT $1, $2::varchar(30), $3, '08:00', '14:00'
             WHERE NOT EXISTS (
               SELECT 1 FROM txn.prod_pkl WHERE shift_log_id = $1 AND coil_no = $2::varchar(30)
             )`,
            [shiftLogId, coilNo, prodMt],
          );
        } else {
          await client.query(
            `INSERT INTO txn.prod_crm (shift_log_id, coil_no, scrap_mt, weight_mt, time_from, time_to)
             SELECT $1, $2::varchar(30), 0.8, $3, '08:00', '16:00'
             WHERE NOT EXISTS (
               SELECT 1 FROM txn.prod_crm WHERE shift_log_id = $1 AND coil_no = $2::varchar(30)
             )`,
            [shiftLogId, coilNo, prodMt],
          );
        }

        // Stoppages (2 per shift, more on recent days)
        const stoppages = [
          ['S_ROLL', '09:30', '10:15', 45, 'Scheduled roll change'],
          ['S_WEB', '13:00', '13:25', 25, 'Web break at entry section'],
        ];
        for (const [code, tFrom, tTo, mins, remarks] of stoppages) {
          await client.query(
            `INSERT INTO txn.stoppage_entry (shift_log_id, stoppage_code, time_from, time_to, duration_min, remarks)
             SELECT $1, $2::varchar(16), $3::time, $4::time, $5, $6
             WHERE NOT EXISTS (
               SELECT 1 FROM txn.stoppage_entry
               WHERE shift_log_id = $1 AND stoppage_code = $2::varchar(16) AND time_from = $3::time
             )`,
            [shiftLogId, code, tFrom, tTo, mins, remarks],
          );
        }

        // Running stoppage on today's active HRS shift
        if (activeShiftId === shiftLogId) {
          await client.query(
            `INSERT INTO txn.stoppage_entry (shift_log_id, stoppage_code, time_from, time_to, duration_min, remarks)
             SELECT $1, 'S_ELEC'::varchar(16), '14:30'::time, NULL, NULL, 'Crane interlock — awaiting clearance'
             WHERE NOT EXISTS (
               SELECT 1 FROM txn.stoppage_entry
               WHERE shift_log_id = $1 AND time_to IS NULL
             )`,
            [shiftLogId],
          );
        }
      }
    }

    // ── Defects (for plant-head top defects chart) ────────────────────────
    const hrsEntry = await client.query(
      `SELECT entry_id FROM txn.prod_hrs WHERE coil_no = 'HRS-COIL-003' ORDER BY entry_id DESC LIMIT 1`,
    );
    if (hrsEntry.rows[0]) {
      for (const [code, qty, loc] of [
        ['D_SCRATCH', 2.5, 'Top surface'],
        ['D_EDGE', 1.1, 'Drive side'],
        ['D_RUST', 0.6, 'Entry section'],
      ]) {
        await client.query(
          `INSERT INTO txn.defect_entry (process_id, entry_id, coil_no, defect_code, location, qty_mt)
           SELECT 1, $1, 'HRS-COIL-003'::varchar(30), $2::varchar(16), $3, $4
           WHERE NOT EXISTS (
             SELECT 1 FROM txn.defect_entry WHERE entry_id = $1 AND defect_code = $2::varchar(16)
           )`,
          [hrsEntry.rows[0].entry_id, code, loc, qty],
        );
      }
    }

    if (opts.adminUserId) {
      const planImport = await client.query(
        `SELECT import_batch_id FROM planning.import_batch
         WHERE file_name = 'sap-plan-pilot.csv' AND imported_by = $1 LIMIT 1`,
        [opts.adminUserId],
      );
      if (planImport.rows.length === 0) {
        await client.query(
          `INSERT INTO planning.import_batch (source, file_name, row_count, status, imported_by, error_count)
           VALUES ('SAP', 'sap-plan-pilot.csv', 3, 'LOADED', $1, 0)`,
          [opts.adminUserId],
        );
      }
    }

    // ── CRM 6HI PPC batches (linked to admin import when adminUserId set) ─
    const ppcSeed = await seedSixHiPpc(client, {
      importedByUserId: opts.adminUserId ?? undefined,
    });
    console.log(`  SixHi_ppc: ${ppcSeed.rollingBatches} rolling + ${ppcSeed.skinPassBatches} skin pass (${ppcSeed.planDate} shift ${ppcSeed.shiftCode})`);
    if (ppcSeed.importBatchId) {
      console.log(`  SixHi_import_batch=${ppcSeed.importBatchId} (imported by admin)`);
    }

    if (opts.exportDemo !== false) {
      const exportSeed = await seedExportDemo(client, { adminUserId: opts.adminUserId });
      console.log(
        `  export_demo: ${exportSeed.startDate}→${exportSeed.endDate} shifts=${exportSeed.shifts} crm6=${exportSeed.crm6_orders} targets=${exportSeed.targets}`,
      );
    }

    const processQueues = await seedProcessQueues(client);
    console.log(
      `  process_queues: created=${processQueues.created} skipped=${processQueues.skipped} (${processQueues.planDate} shift ${processQueues.shiftCode})`,
    );

    await client.query('COMMIT');

    const summary = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM coil.coil) AS coils,
        (SELECT COUNT(*) FROM txn.shift_log) AS shifts,
        (SELECT COUNT(*) FROM txn.stoppage_entry) AS stoppages,
        (SELECT COUNT(*) FROM txn.defect_entry) AS defects,
        (SELECT COUNT(*) FROM planning.coil_plan) AS coil_plans,
        (SELECT COUNT(*) FROM planning.ppc_batch) AS ppc_batches
    `);

    const s = summary.rows[0];
    console.log(`  coils=${s.coils} shifts=${s.shifts} stoppages=${s.stoppages} defects=${s.defects} plans=${s.coil_plans} ppc_batches=${s.ppc_batches}`);
    return s;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1]?.includes('seed-pilot-data');
if (isMain) {
  const url = process.argv[2] || DEFAULT_URL;
  console.log(`Seeding pilot data → ${url.replace(/:[^:@]+@/, ':***@')}`);
  seedPilotData(url)
    .then(() => console.log('Pilot data seed complete.'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
