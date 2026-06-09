#!/usr/bin/env node
/**
 * Seeds fixed-date production data for export testing (DPR, LINE_LOG, COIL_TRACE, RAW).
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run seed:export
 *   npm run seed:admin   (includes this via seedPilotData exportDemo flag)
 */
import pg from 'pg';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

const EXPORT_START = process.env.EXPORT_SEED_START ?? '2026-06-01';
const EXPORT_END = process.env.EXPORT_SEED_END ?? '2026-06-07';

function dateRange(start, end) {
  const out = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function loadProcessMap(client) {
  const res = await client.query(
    `SELECT process_id, code FROM master.process
     WHERE code IN ('HRS','PKL','6HI','ANN','SKP','RWD','CRS','CTL')`,
  );
  const map = Object.fromEntries(res.rows.map((r) => [r.code, r.process_id]));
  if (!map['6HI']) {
    await client.query(`
      INSERT INTO master.process (process_id, code, name, seq_no, has_mill_type)
      VALUES (31, '6HI', '6HI', 31, FALSE)
      ON CONFLICT (process_id) DO NOTHING
    `);
    map['6HI'] = 31;
  }
  await client.query(`
    INSERT INTO master.machine (machine_code, process_id, name) VALUES
      ('6HI', 31, '6HI'),
      ('4HI', NULL, 'CRM 4HI'),
      ('2HI', NULL, 'CRM 2HI')
    ON CONFLICT (machine_code) DO NOTHING
  `);
  return map;
}

async function upsertShiftLog(client, {
  processId,
  prodDate,
  shiftCode,
  millType = null,
  targetMt = 100,
  totalProdMt = 85,
  state = 'APPROVED',
  shiftManagerId = null,
}) {
  const res = await client.query(
    `INSERT INTO txn.shift_log (
       process_id, prod_date, shift_code, mill_type, target_mt, total_prod_mt, state, shift_manager_id
     ) VALUES ($1, $2::date, $3, $4, $5, $6, $7::varchar(16), $8)
     ON CONFLICT (prod_date, shift_code, process_id, mill_type)
     DO UPDATE SET
       target_mt = EXCLUDED.target_mt,
       total_prod_mt = EXCLUDED.total_prod_mt,
       state = EXCLUDED.state
     RETURNING shift_log_id`,
    [processId, prodDate, shiftCode, millType, targetMt, totalProdMt, state, shiftManagerId],
  );
  return res.rows[0].shift_log_id;
}

async function grantExportLineAccess(client) {
  const lines = ['HRS', 'PKL', '6HI', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'];
  for (const empCode of ['1000', '2000']) {
    for (const code of lines) {
      await client.query(
        `INSERT INTO security.line_access (user_id, process_id, access_level)
         SELECT u.user_id, p.process_id, 'APPROVE'
         FROM security.app_user u
         JOIN master.process p ON p.code = $2
         WHERE u.emp_code = $1
         ON CONFLICT DO NOTHING`,
        [empCode, code],
      );
    }
  }
}

async function ensureMasters(client) {
  await client.query(`
    INSERT INTO master.customer (customer_code, customer_name) VALUES
      ('CUST_TATA', 'Tata Motors'),
      ('CUST_MARUTI', 'Maruti Suzuki')
    ON CONFLICT (customer_code) DO NOTHING
  `);
  await client.query(`
    INSERT INTO master.grade (grade_code, description, grade_family) VALUES
      ('CRCA', 'Cold Rolled Close Annealed', 'CRCA'),
      ('SPHC', 'Hot Rolled Pickled', 'HROP'),
      ('D513', 'Deep Drawing Grade', 'CRCA')
    ON CONFLICT (grade_code) DO NOTHING
  `);
  await client.query(`
    INSERT INTO master.operator (emp_code, full_name) VALUES
      ('EMP001', 'Rajesh Kumar'),
      ('EMP002', 'Amit Singh')
    ON CONFLICT (emp_code) DO NOTHING
  `);
  await client.query(`
    INSERT INTO master.stoppage_code (stoppage_code, description, category, is_planned) VALUES
      ('S_ROLL', 'Roll Change', 'MECH', TRUE),
      ('S_WEB', 'Web Break', 'MECH', FALSE),
      ('S_ELEC', 'Electrical Fault', 'ELECT', FALSE),
      ('S_SETUP', 'Line Setup', 'OPN', TRUE)
    ON CONFLICT (stoppage_code) DO NOTHING
  `);
}

async function ensureTraceCoils(client) {
  const cust = await client.query(
    `SELECT customer_id FROM master.customer WHERE customer_code = 'CUST_TATA' LIMIT 1`,
  );
  const customerId = cust.rows[0]?.customer_id;
  const procs = await client.query(`SELECT process_id, code FROM master.process`);
  const procByCode = Object.fromEntries(procs.rows.map((r) => [r.code, r.process_id]));

  const coils = [
    ['HSL-2026-04400', null, customerId, 'SPHC', 1250, 2.8, 24.5, procByCode.HRS, 'PKL', 'PLANNED'],
    ['HRS-COIL-002', null, customerId, 'D513', 1500, 3.5, 28.0, procByCode.HRS, 'PKL', 'PLANNED'],
    ['HRS-COIL-003', null, customerId, 'CRCA', 1250, 4.0, 22.0, procByCode.HRS, 'PKL', 'IN_PROCESS'],
    ['HSL-2026-04471', 'HSL-2026-04400', customerId, 'SPHC', 1250, 0.8, 11.2, procByCode.CTL, null, 'PLANNED'],
    ['EXP-COIL-001', 'HSL-2026-04400', customerId, 'CRCA', 1250, 1.2, 10.5, procByCode.CRS, 'CTL', 'PLANNED'],
    ['PKL-COIL-001', 'HRS-COIL-003', customerId, 'CRCA', 1250, 3.8, 23.0, procByCode.PKL, '6HI', 'PLANNED'],
    ['PKL-COIL-002', 'HRS-COIL-002', customerId, 'D513', 1500, 3.2, 26.5, procByCode.PKL, '6HI', 'PLANNED'],
  ];

  for (const c of coils) {
    await client.query(
      `INSERT INTO coil.coil (
         coil_no, parent_coil_no, customer_id, grade_code, nominal_width_mm,
         coil_thk_mm, weight_mt, current_process_id, next_dest, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (coil_no) DO UPDATE SET
         parent_coil_no = EXCLUDED.parent_coil_no,
         weight_mt = EXCLUDED.weight_mt,
         status = EXCLUDED.status`,
      c,
    );
  }
}

async function seedProductionTargets(client, dates) {
  const areas = [
    ['HRS', 130, 9.2],
    ['PKLG', 110, 8.5],
    ['4HI_R', 260, 13.76],
    ['6HI_R', 220, 12.4],
    ['HPH', 180, 7.8],
    ['RW_LINE', 95, 6.5],
    ['CRS_1', 88, 6.1],
    ['CTL_1', 92, 6.3],
  ];
  for (const day of dates) {
    for (const [area, targetMt, targetRate] of areas) {
      await client.query(
        `INSERT INTO planning.production_target (area_code, period, target_mt, target_rate)
         VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (area_code, period) DO UPDATE SET
           target_mt = EXCLUDED.target_mt,
           target_rate = EXCLUDED.target_rate`,
        [area, day, targetMt, targetRate],
      );
    }
  }
}

async function insertStoppage(client, shiftLogId, code, tFrom, tTo, mins, remarks) {
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

async function seedCrm6RollingOrder(client, {
  shiftLogId,
  prodDate,
  shiftCode,
  batchNumber,
  coilNo,
  machineCode,
  weightMt,
  thkMm,
  stoppages = [],
}) {
  const batchRes = await client.query(
    `INSERT INTO planning.ppc_batch (
       batch_number, plan_date, shift_code, machine_code, sub_process, machine_allocated,
       coil_no, customer_name, grade_code, width_mm, input_thk_mm, ppc_thk_mm, ppc_weight_mt,
       destination, roll_finish, ppc_reroll_flag, queue_seq
     ) VALUES (
       $1, $2::date, $3, $4, 'ROLLING', TRUE,
       $5, 'Tata Motors', 'CRCA', 1250, $6, $7, $8,
       'ANNEALING', 'MATT', FALSE, 1
     )
     ON CONFLICT (batch_number) DO UPDATE SET
       plan_date = EXCLUDED.plan_date,
       shift_code = EXCLUDED.shift_code,
       ppc_weight_mt = EXCLUDED.ppc_weight_mt
     RETURNING batch_id`,
    [batchNumber, prodDate, shiftCode, machineCode, coilNo, thkMm + 0.9, thkMm, weightMt],
  );
  const batchId = batchRes.rows[0].batch_id;

  const orderRes = await client.query(
    `INSERT INTO txn.crm6_order (
       shift_log_id, batch_id, batch_number, coil_no, customer_name, grade_code,
       width_mm, input_thk_mm, ppc_thk_mm, ppc_weight_mt, sub_process, status, production_day
     ) VALUES ($1,$2,$3,$4,'Tata Motors','CRCA',1250,$5,$6,$7,'ROLLING','COMPLETED',$8::date)
     ON CONFLICT (batch_id) DO UPDATE SET
       shift_log_id = EXCLUDED.shift_log_id,
       production_day = EXCLUDED.production_day,
       status = EXCLUDED.status
     RETURNING order_id`,
    [shiftLogId, batchId, batchNumber, coilNo, thkMm + 0.9, thkMm, weightMt, prodDate],
  );
  const orderId = orderRes.rows[0].order_id;

  await client.query(
    `INSERT INTO txn.crm6_rolling (order_id, actual_weight_mt, final_thk_mm, rerolling, total_passes)
     VALUES ($1, $2, $3, FALSE, 3)
     ON CONFLICT (order_id) DO UPDATE SET
       actual_weight_mt = EXCLUDED.actual_weight_mt,
       final_thk_mm = EXCLUDED.final_thk_mm`,
    [orderId, weightMt, thkMm],
  );

  for (const [code, mins, remarks] of stoppages) {
    await client.query(
      `INSERT INTO txn.order_stoppage (order_id, category_code, duration_min, remarks)
       SELECT $1, $2::varchar(16), $3, $4
       WHERE NOT EXISTS (
         SELECT 1 FROM txn.order_stoppage
         WHERE order_id = $1 AND category_code = $2::varchar(16) AND duration_min = $3
       )`,
      [orderId, code, mins, remarks],
    );
  }

  return orderId;
}

/**
 * @param {pg.Client | string} connOrUrl — connected client or database URL
 * @param {{ startDate?: string, endDate?: string, adminUserId?: number }} opts
 */
export async function seedExportDemo(connOrUrl = DEFAULT_URL, opts = {}) {
  const startDate = opts.startDate ?? EXPORT_START;
  const endDate = opts.endDate ?? EXPORT_END;
  const dates = dateRange(startDate, endDate);

  const ownsClient = typeof connOrUrl === 'string';
  const client = ownsClient ? new pg.Client({ connectionString: connOrUrl }) : connOrUrl;
  if (ownsClient) {
    await client.connect();
    await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  }

  try {
    if (ownsClient) await client.query('BEGIN');

    await ensureMasters(client);
    await grantExportLineAccess(client);
    const proc = await loadProcessMap(client);
    await ensureTraceCoils(client);
    await seedProductionTargets(client, dates);

    const operators = await client.query(
      `SELECT operator_id FROM master.operator WHERE emp_code = 'EMP001' LIMIT 1`,
    );
    const shiftManagerId = operators.rows[0]?.operator_id ?? null;

    // ── Daily HRS + PKL baseline (feeds RAW + DPR) ───────────────────────
    for (const day of dates) {
      const hrsShift = await upsertShiftLog(client, {
        processId: proc.HRS,
        prodDate: day,
        shiftCode: 'A',
        targetMt: 130,
        totalProdMt: 100,
        shiftManagerId,
      });
      await client.query(
        `INSERT INTO txn.prod_hrs (shift_log_id, coil_no, weight_mt, nominal_thk_mm, time_from, time_to, scrap_mt)
         SELECT $1, 'HRS-COIL-003', 95 + ($2::int % 5), 4.0, '08:00', '14:00', 1.2
         WHERE NOT EXISTS (SELECT 1 FROM txn.prod_hrs WHERE shift_log_id = $1 AND coil_no = 'HRS-COIL-003')`,
        [hrsShift, dates.indexOf(day)],
      );
      await insertStoppage(client, hrsShift, 'S_ROLL', '09:30', '10:15', 45, 'Roll change');
      await insertStoppage(client, hrsShift, 'S_ELEC', '11:00', '11:15', 15, 'Electrical trip');

      await client.query(
        `INSERT INTO txn.crew_entry (shift_log_id, operator_id, role_code)
         SELECT $1, $2, 'OPERATOR'
         WHERE NOT EXISTS (
           SELECT 1 FROM txn.crew_entry WHERE shift_log_id = $1 AND role_code = 'OPERATOR'
         )`,
        [hrsShift, shiftManagerId],
      );

      const pklShift = await upsertShiftLog(client, {
        processId: proc.PKL,
        prodDate: day,
        shiftCode: 'B',
        targetMt: 110,
        totalProdMt: 88,
        shiftManagerId,
      });
      await client.query(
        `INSERT INTO txn.prod_pkl (shift_log_id, coil_no, weight_mt, thk_mm, width_mm, time_from, time_to)
         SELECT $1, 'PKL-COIL-001', 88 + ($2::int % 4), 3.8, 1250, '14:00', '20:00'
         WHERE NOT EXISTS (SELECT 1 FROM txn.prod_pkl WHERE shift_log_id = $1 AND coil_no = 'PKL-COIL-001')`,
        [pklShift, dates.indexOf(day)],
      );
    }

    // ── Trace chain runs (COIL_TRACE + multi-process LINE_LOG) ─────────────
    const tracePlan = [
      { date: startDate, proc: 'HRS', shift: 'A', coil: 'HSL-2026-04400', table: 'hrs', weight: 24.5, thk: 2.8 },
      { date: dates[1] ?? startDate, proc: 'PKL', shift: 'B', coil: 'HSL-2026-04400', table: 'pkl', weight: 24.1, thk: 2.75 },
      { date: dates[2] ?? startDate, proc: '6HI', shift: 'A', coil: 'HSL-2026-04400', table: 'crm6_6hi', weight: 23.8, thk: 1.2, machine: '6HI' },
      { date: dates[3] ?? startDate, proc: 'ANN', shift: 'C', coil: 'HSL-2026-04400', table: 'ann', weight: 23.5, thk: null },
      { date: dates[4] ?? startDate, proc: 'SKP', shift: 'A', coil: 'HSL-2026-04471', table: 'skp', weight: 11.2, thk: 0.95 },
      { date: dates[4] ?? startDate, proc: 'RWD', shift: 'B', coil: 'HSL-2026-04471', table: 'rwd', weight: 10.8, thk: 0.92 },
      { date: dates[5] ?? startDate, proc: 'CRS', shift: 'A', coil: 'EXP-COIL-001', table: 'crs', weight: 10.5, thk: 1.2 },
      { date: startDate, proc: 'CTL', shift: 'C', coil: 'HSL-2026-04471', table: 'ctl', weight: 94.31, thk: 0.8 },
    ];

    for (const row of tracePlan) {
      const shiftId = await upsertShiftLog(client, {
        processId: proc[row.proc],
        prodDate: row.date,
        shiftCode: row.shift,
        millType: row.mill ?? null,
        targetMt: 100,
        totalProdMt: row.weight,
        shiftManagerId,
      });

      if (row.table === 'hrs') {
        await client.query(
          `INSERT INTO txn.prod_hrs (shift_log_id, coil_no, weight_mt, nominal_thk_mm, time_from, time_to)
           SELECT $1, $2::varchar(30), $3, $4, '06:00', '12:00'
           WHERE NOT EXISTS (SELECT 1 FROM txn.prod_hrs WHERE shift_log_id = $1 AND coil_no = $2::varchar(30))`,
          [shiftId, row.coil, row.weight, row.thk],
        );
      } else if (row.table === 'pkl') {
        await client.query(
          `INSERT INTO txn.prod_pkl (shift_log_id, coil_no, weight_mt, thk_mm, width_mm, time_from, time_to)
           SELECT $1, $2::varchar(30), $3, $4, 1250, '14:00', '20:00'
           WHERE NOT EXISTS (SELECT 1 FROM txn.prod_pkl WHERE shift_log_id = $1 AND coil_no = $2::varchar(30))`,
          [shiftId, row.coil, row.weight, row.thk],
        );
      } else if (row.table === 'crm6_6hi') {
        await seedCrm6RollingOrder(client, {
          shiftLogId: shiftId,
          prodDate: row.date,
          shiftCode: row.shift,
          batchNumber: `EXP-6HI-${row.date.replace(/-/g, '')}`,
          coilNo: row.coil,
          machineCode: row.machine,
          weightMt: row.weight,
          thkMm: row.thk,
        });
      } else if (row.table === 'ann') {
        const chargeNo = `EXP-CH-${row.date.replace(/-/g, '')}`;
        await client.query(
          `INSERT INTO txn.ann_charge (
             shift_log_id, charge_no, base_no, loading_mt, unloading_mt, unloading_wt_mt,
             temperature_degc, status, grade_code
           ) VALUES ($1, $2, 'BASE-42', 24.0, 23.5, 23.5, 720, 'DONE', 'SPHC')
           ON CONFLICT (charge_no) DO UPDATE SET unloading_wt_mt = EXCLUDED.unloading_wt_mt`,
          [shiftId, chargeNo],
        );
        await client.query(
          `INSERT INTO txn.ann_charge_coil (charge_no, coil_no, seq_no)
           VALUES ($1, $2, 1)
           ON CONFLICT (charge_no, coil_no) DO NOTHING`,
          [chargeNo, row.coil],
        );
      } else if (row.table === 'skp') {
        await client.query(
          `INSERT INTO txn.prod_skp (shift_log_id, coil_no, weight_mt, final_thk_mm, thk_mm, width_mm)
           SELECT $1, $2::varchar(30), $3, $4, $4, 1250
           WHERE NOT EXISTS (SELECT 1 FROM txn.prod_skp WHERE shift_log_id = $1 AND coil_no = $2::varchar(30))`,
          [shiftId, row.coil, row.weight, row.thk],
        );
      } else if (row.table === 'rwd') {
        await client.query(
          `INSERT INTO txn.prod_rwd (shift_log_id, coil_no, weight_mt, output_thk_mm, thk_mm, width_mm, time_from, time_to)
           SELECT $1, $2::varchar(30), $3, $4, $4, 1250, '14:00', '18:00'
           WHERE NOT EXISTS (SELECT 1 FROM txn.prod_rwd WHERE shift_log_id = $1 AND coil_no = $2::varchar(30))`,
          [shiftId, row.coil, row.weight, row.thk],
        );
      } else if (row.table === 'crs') {
        await client.query(
          `INSERT INTO txn.prod_crs (
             shift_log_id, coil_no, output_wt_mt, nominal_thk_mm, for_ctl_mt, coil_width_mm
           ) SELECT $1, $2::varchar(30), $3, $4, 2.5, 1250
           WHERE NOT EXISTS (SELECT 1 FROM txn.prod_crs WHERE shift_log_id = $1 AND coil_no = $2::varchar(30))`,
          [shiftId, row.coil, row.weight, row.thk],
        );
      } else if (row.table === 'ctl') {
        await client.query(
          `INSERT INTO txn.prod_ctl (
             shift_log_id, coil_no, total_prod_mt, weight_mt, thk_mm, width_mm, time_from, time_to
           ) SELECT $1, $2::varchar(30), $3, $3, $4, 1250, '22:00', '05:30'
           WHERE NOT EXISTS (SELECT 1 FROM txn.prod_ctl WHERE shift_log_id = $1 AND coil_no = $2::varchar(30))`,
          [shiftId, row.coil, row.weight, row.thk],
        );
      }
    }

    // ── 4HI rolling demo on day 1 (DPR 4HI_R — shifts A/B/C) ───────────────
    const crm6Shifts = [
      { shift: 'A', coil: 'PKL-COIL-001', weight: 12.22, thk: 0.8, stops: [['SETUP', 60, 'Line setup']] },
      { shift: 'B', coil: 'PKL-COIL-002', weight: 13.32, thk: 0.8, stops: [['MATERIAL', 30, 'RM wait']] },
      { shift: 'C', coil: 'HSL-2026-04400', weight: 43.7, thk: 0.8, stops: [['BREAKDOWN', 15, 'Roll guide']] },
    ];
    for (const s of crm6Shifts) {
      const shiftId = await upsertShiftLog(client, {
        processId: proc['6HI'],
        prodDate: startDate,
        shiftCode: s.shift,
        targetMt: 260,
        totalProdMt: s.weight,
        shiftManagerId,
      });
      await insertStoppage(client, shiftId, 'S_ELEC', '10:00', '10:15', 15, 'Electrical');
      await insertStoppage(client, shiftId, 'S_SETUP', '12:00', '13:00', 60, 'Setup');
      await seedCrm6RollingOrder(client, {
        shiftLogId: shiftId,
        prodDate: startDate,
        shiftCode: s.shift,
        batchNumber: `EXP-4HI-${startDate.replace(/-/g, '')}-${s.shift}`,
        coilNo: s.coil,
        machineCode: '4HI',
        weightMt: s.weight,
        thkMm: s.thk,
        stoppages: s.stops,
      });
    }

    if (opts.adminUserId) {
      await client.query(
        `INSERT INTO planning.import_batch (source, file_name, row_count, status, imported_by, error_count)
         SELECT 'MANUAL', 'export-demo-seed', 10, 'LOADED', $1, 0
         WHERE NOT EXISTS (
           SELECT 1 FROM planning.import_batch WHERE file_name = 'export-demo-seed'
         )`,
        [opts.adminUserId],
      );
    }

    if (ownsClient) await client.query('COMMIT');

    const summary = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM txn.shift_log WHERE prod_date >= $1::date AND prod_date <= $2::date) AS shifts,
        (SELECT COUNT(*) FROM txn.crm6_order WHERE production_day >= $1::date AND production_day <= $2::date) AS crm6_orders,
        (SELECT COUNT(*) FROM planning.production_target WHERE period >= $1::date AND period <= $2::date) AS targets,
        (SELECT COUNT(*) FROM txn.stoppage_entry se
           JOIN txn.shift_log sl ON se.shift_log_id = sl.shift_log_id
           WHERE sl.prod_date >= $1::date AND sl.prod_date <= $2::date) AS stoppages
    `, [startDate, endDate]);

    return { startDate, endDate, ...summary.rows[0] };
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) await client.end();
  }
}

const isMain = process.argv[1]?.includes('seed-export-demo');
if (isMain) {
  console.log(`Seeding export demo data (${EXPORT_START} → ${EXPORT_END})…`);
  seedExportDemo()
    .then((s) => {
      console.log(`  shifts=${s.shifts} crm6_orders=${s.crm6_orders} targets=${s.targets} stoppages=${s.stoppages}`);
      console.log('\nExport test scopes:');
      console.log(`  DPR:        { "type": "DPR", "format": "XLSX", "scope": { "month": "${s.startDate.slice(0, 7)}" } }`);
      console.log(`  LINE_LOG:   { "type": "LINE_LOG", "format": "XLSX", "scope": { "process_code": "HRS", "date_from": "${s.startDate}", "date_to": "${s.endDate}" } }`);
      console.log(`  COIL_TRACE: { "type": "COIL_TRACE", "format": "PDF", "scope": { "coil_no": "HSL-2026-04471" } }`);
      console.log(`  RAW:        { "type": "RAW", "format": "CSV", "scope": { "dateFrom": "${s.startDate}", "dateTo": "${s.endDate}", "processId": "HRS" } }`);
      console.log('\nExport demo seed complete.');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
