#!/usr/bin/env node
/**
 * Seeds journey-driven queue orders for each process station (HRS, PKL, ANN, RWD, CRS, CTL).
 * Usage: npm run seed:process-queues
 */
import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const DEFAULT_URL = resolveDatabaseUrl();
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ROUTE_RAW = 'S-P-6-Z-R-F-C-LE-PKG';

const ROUTE_META = {
  S: { displayLabel: 'HR Slitting', processCode: 'HRS', machineCode: 'HRS', subProcess: null },
  P: { displayLabel: 'Pickling', processCode: 'PKL', machineCode: 'PKL', subProcess: null },
  '6': { displayLabel: '6HI Rolling', processCode: 'CRM', machineCode: '6HI', subProcess: 'ROLLING' },
  Z: { displayLabel: '6HI Skin Pass', processCode: 'CRM', machineCode: '6HI', subProcess: 'SKIN_PASS' },
  R: { displayLabel: 'Rewinding', processCode: 'RWD', machineCode: 'RWD', subProcess: null },
  F: { displayLabel: 'Annealing', processCode: 'ANN', machineCode: 'ANN', subProcess: null },
  C: { displayLabel: 'CR Slitting', processCode: 'CRS', machineCode: 'CRS', subProcess: null },
  LE: { displayLabel: 'CTL', processCode: 'CTL', machineCode: 'CTL', subProcess: null },
  PKG: { displayLabel: 'Packaging', processCode: null, machineCode: null, subProcess: null },
};

function parseRouteString(routeRaw) {
  const tokens = routeRaw.toUpperCase().split('-').map((t) => t.trim()).filter((t) => t && t !== 'PKG' && t !== 'PACKAGING');
  const codes = [...tokens];
  if (!codes.includes('PKG')) codes.push('PKG');
  return codes.map((code) => {
    const meta = ROUTE_META[code];
    if (!meta) throw new Error('Unknown route code: ' + code);
    return { routeCode: code, ...meta };
  });
}

async function ensureProcessShiftLogs(client, planDate, shiftCode) {
  const procs = await client.query(
    'SELECT process_id, code FROM master.process WHERE code = ANY($1::varchar[])',
    [['HRS', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL']],
  );
  const operators = await client.query("SELECT operator_id FROM master.operator WHERE emp_code = 'EMP001' LIMIT 1");
  const shiftManagerId = operators.rows[0]?.operator_id ?? null;

  for (const proc of procs.rows) {
    await client.query(
      `INSERT INTO txn.shift_log (process_id, prod_date, shift_code, target_mt, total_prod_mt, state, shift_manager_id)
       VALUES ($1, $2::date, $3, 100, 0, 'DRAFT', $4)
       ON CONFLICT (prod_date, shift_code, process_id, mill_type)
       DO UPDATE SET state = CASE WHEN txn.shift_log.state = 'APPROVED' THEN txn.shift_log.state ELSE 'DRAFT' END`,
      [proc.process_id, planDate, shiftCode, shiftManagerId],
    );
  }
}

async function upsertCoil(client, coil) {
  await client.query(
    `INSERT INTO coil.coil (coil_no, customer_id, grade_code, nominal_width_mm, coil_width_mm, coil_thk_mm, weight_mt, status)
     VALUES ($1, $2, $3, $4, $4, $5, $6, 'PLANNED')
     ON CONFLICT (coil_no) DO UPDATE SET grade_code = EXCLUDED.grade_code, nominal_width_mm = EXCLUDED.nominal_width_mm,
       coil_width_mm = EXCLUDED.coil_width_mm, coil_thk_mm = EXCLUDED.coil_thk_mm, weight_mt = EXCLUDED.weight_mt`,
    [coil.coilNo, coil.customerId, coil.gradeCode, coil.widthMm, coil.thicknessMm, coil.weightMt],
  );
}

async function seedQueueEntry(client, entry) {
  const routeRaw = entry.routeRaw ?? ROUTE_RAW;
  const steps = parseRouteString(routeRaw);
  const activeIdx = steps.findIndex((s) => s.routeCode === entry.activeRouteCode);
  if (activeIdx < 0) throw new Error('Route ' + routeRaw + ' has no step ' + entry.activeRouteCode);

  const existing = await client.query(
    `SELECT oj.journey_id FROM planning.order_journey oj
     JOIN planning.order_journey_step ojs ON ojs.journey_id = oj.journey_id AND ojs.step_no = oj.current_step_no
     WHERE oj.coil_no = $1 AND oj.status = 'ACTIVE' AND ojs.process_code = $2`,
    [entry.coilNo, entry.processCode],
  );
  if (existing.rows.length > 0) return { coilNo: entry.coilNo, skipped: true };

  const anyActive = await client.query(
    "SELECT journey_id FROM planning.order_journey WHERE coil_no = $1 AND status = 'ACTIVE' LIMIT 1",
    [entry.coilNo],
  );
  if (anyActive.rows.length > 0) return { coilNo: entry.coilNo, skipped: true, reason: 'other_active_journey' };

  const batchRes = await client.query(
    `INSERT INTO planning.ppc_batch (batch_number, plan_date, shift_code, machine_code, sub_process, coil_no, customer_name,
       grade_code, width_mm, input_thk_mm, ppc_thk_mm, ppc_weight_mt, queue_seq, process_route_raw, sap_order_no)
     VALUES ($1, $2::date, $3, $4, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, 'SAP-PROCESS-SEED')
     ON CONFLICT (batch_number) DO UPDATE SET plan_date = EXCLUDED.plan_date, queue_seq = EXCLUDED.queue_seq,
       process_route_raw = EXCLUDED.process_route_raw RETURNING batch_id`,
    [entry.batchNumber, entry.planDate, entry.shiftCode, entry.processCode, entry.coilNo, entry.customerName,
      entry.gradeCode, entry.widthMm, entry.thicknessMm, entry.weightMt, activeIdx + 1, routeRaw],
  );
  const batchId = batchRes.rows[0].batch_id;

  const journeyRes = await client.query(
    "INSERT INTO planning.order_journey (coil_no, route_raw, current_step_no, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING journey_id",
    [entry.coilNo, routeRaw, activeIdx + 1],
  );
  const journeyId = journeyRes.rows[0].journey_id;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    let status = 'PENDING';
    if (i < activeIdx) status = 'COMPLETED';
    else if (i === activeIdx) status = entry.stepStatus;
    const isActiveStep = i === activeIdx;
    await client.query(
      `INSERT INTO planning.order_journey_step (journey_id, step_no, route_code, display_label, process_code, machine_code,
         sub_process, status, started_at, completed_at, queue_batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [journeyId, i + 1, s.routeCode, s.displayLabel, s.processCode, s.machineCode, s.subProcess, status,
        isActiveStep && status === 'ACTIVE' ? new Date() : null, i < activeIdx ? new Date() : null, isActiveStep ? batchId : null],
    );
  }

  return { coilNo: entry.coilNo, processCode: entry.processCode, journeyId, batchId, skipped: false };
}

async function seedAnnCharge(client, planDate, shiftCode) {
  const annProc = await client.query("SELECT process_id FROM master.process WHERE code = 'ANN' LIMIT 1");
  const processId = annProc.rows[0]?.process_id;
  if (!processId) return { chargeNo: null, skipped: true };

  const shiftRes = await client.query(
    `SELECT shift_log_id FROM txn.shift_log WHERE process_id = $1 AND prod_date = $2::date AND shift_code = $3 AND mill_type IS NULL LIMIT 1`,
    [processId, planDate, shiftCode],
  );
  const shiftLogId = shiftRes.rows[0]?.shift_log_id;
  if (!shiftLogId) return { chargeNo: null, skipped: true };

  const chargeNo = 'SEED-ANN-CHG-001';
  await client.query(
    `INSERT INTO txn.ann_charge (charge_no, shift_log_id, status, grade_code, no_of_coils, charge_wt_mt)
     VALUES ($1, $2, 'IN_PROCESS', 'CRCA', 0, 0) ON CONFLICT (charge_no) DO NOTHING`,
    [chargeNo, shiftLogId],
  );

  for (const [coilNo, seq] of [['ANN-SEED-001', 1], ['ANN-SEED-002', 2]]) {
    await client.query('INSERT INTO txn.ann_charge_coil (charge_no, coil_no, seq_no) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [chargeNo, coilNo, seq]);
  }

  const roster = await client.query(
    `SELECT c.weight_mt FROM txn.ann_charge_coil acc JOIN coil.coil c ON c.coil_no = acc.coil_no WHERE acc.charge_no = $1`,
    [chargeNo],
  );
  const chargeWt = roster.rows.reduce((sum, r) => sum + Number(r.weight_mt ?? 0), 0);
  await client.query('UPDATE txn.ann_charge SET no_of_coils = $2, charge_wt_mt = $3 WHERE charge_no = $1', [chargeNo, roster.rows.length, chargeWt]);
  return { chargeNo, shiftLogId, rosterCount: roster.rows.length };
}


async function ensureMasterData(client) {
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
    INSERT INTO master.operator (emp_code, full_name) VALUES ('EMP001', 'Rajesh Kumar')
    ON CONFLICT (emp_code) DO NOTHING;
  `);
}
export async function seedProcessQueues(client, opts = {}) {
  const planDate = opts.planDate ?? new Date().toISOString().slice(0, 10);
  const shiftCode = opts.shiftCode ?? 'A';

  await ensureMasterData(client);
  const custRes = await client.query("SELECT customer_id, customer_code, customer_name FROM master.customer WHERE customer_code IN ('CUST_TATA', 'CUST_MARUTI', 'CUST_HONDA')");
  const cust = Object.fromEntries(custRes.rows.map((r) => [r.customer_code, r]));
  await ensureProcessShiftLogs(client, planDate, shiftCode);

  const coilSpecs = [
    { coilNo: 'HRS-COIL-001', customerId: cust.CUST_TATA?.customer_id, customerName: cust.CUST_TATA?.customer_name ?? 'Tata Motors', gradeCode: 'CRCA', widthMm: 1250, thicknessMm: 4.0, weightMt: 24.5 },
    { coilNo: 'HRS-COIL-002', customerId: cust.CUST_MARUTI?.customer_id, customerName: cust.CUST_MARUTI?.customer_name ?? 'Maruti Suzuki', gradeCode: 'D513', widthMm: 1500, thicknessMm: 3.5, weightMt: 28.0 },
    { coilNo: 'PKL-COIL-001', customerId: cust.CUST_TATA?.customer_id, customerName: cust.CUST_TATA?.customer_name ?? 'Tata Motors', gradeCode: 'CRCA', widthMm: 1250, thicknessMm: 3.8, weightMt: 23.0 },
    { coilNo: 'PKL-COIL-002', customerId: cust.CUST_MARUTI?.customer_id, customerName: cust.CUST_MARUTI?.customer_name ?? 'Maruti Suzuki', gradeCode: 'D513', widthMm: 1500, thicknessMm: 3.2, weightMt: 26.5 },
    { coilNo: 'ANN-SEED-001', customerId: cust.CUST_TATA?.customer_id, customerName: cust.CUST_TATA?.customer_name ?? 'Tata Motors', gradeCode: 'CRCA', widthMm: 1250, thicknessMm: 2.5, weightMt: 21.0 },
    { coilNo: 'ANN-SEED-002', customerId: cust.CUST_MARUTI?.customer_id, customerName: cust.CUST_MARUTI?.customer_name ?? 'Maruti Suzuki', gradeCode: 'D513', widthMm: 1500, thicknessMm: 2.0, weightMt: 24.0 },
    { coilNo: 'RWD-SEED-001', customerId: cust.CUST_TATA?.customer_id, customerName: cust.CUST_TATA?.customer_name ?? 'Tata Motors', gradeCode: 'CRCA', widthMm: 1250, thicknessMm: 1.8, weightMt: 19.5 },
    { coilNo: 'RWD-SEED-002', customerId: cust.CUST_HONDA?.customer_id, customerName: cust.CUST_HONDA?.customer_name ?? 'Honda Cars India', gradeCode: 'HROP', widthMm: 1500, thicknessMm: 1.6, weightMt: 18.0 },
    { coilNo: 'CRS-COIL-001', customerId: cust.CUST_TATA?.customer_id, customerName: cust.CUST_TATA?.customer_name ?? 'Tata Motors', gradeCode: 'CRCA', widthMm: 1200, thicknessMm: 1.2, weightMt: 10.5 },
    { coilNo: 'CRS-SEED-002', customerId: cust.CUST_MARUTI?.customer_id, customerName: cust.CUST_MARUTI?.customer_name ?? 'Maruti Suzuki', gradeCode: 'D513', widthMm: 1180, thicknessMm: 1.0, weightMt: 9.8 },
    { coilNo: 'CTL-COIL-001', customerId: cust.CUST_MARUTI?.customer_id, customerName: cust.CUST_MARUTI?.customer_name ?? 'Maruti Suzuki', gradeCode: 'D513', widthMm: 1000, thicknessMm: 1.0, weightMt: 8.5 },
    { coilNo: 'CTL-SEED-002', customerId: cust.CUST_TATA?.customer_id, customerName: cust.CUST_TATA?.customer_name ?? 'Tata Motors', gradeCode: 'CRCA', widthMm: 1050, thicknessMm: 0.9, weightMt: 7.2 },
  ];
  for (const coil of coilSpecs) await upsertCoil(client, coil);

  const queueEntries = [
    { processCode: 'HRS', activeRouteCode: 'S', coilNo: 'HRS-COIL-001', stepStatus: 'ACTIVE', batchNumber: 'SEED-HRS-001' },
    { processCode: 'HRS', activeRouteCode: 'S', coilNo: 'HRS-COIL-002', stepStatus: 'PENDING', batchNumber: 'SEED-HRS-002' },
    { processCode: 'PKL', activeRouteCode: 'P', coilNo: 'PKL-COIL-001', stepStatus: 'ACTIVE', batchNumber: 'SEED-PKL-001' },
    { processCode: 'PKL', activeRouteCode: 'P', coilNo: 'PKL-COIL-002', stepStatus: 'PENDING', batchNumber: 'SEED-PKL-002' },
    { processCode: 'ANN', activeRouteCode: 'F', coilNo: 'ANN-SEED-001', stepStatus: 'ACTIVE', batchNumber: 'SEED-ANN-001' },
    { processCode: 'ANN', activeRouteCode: 'F', coilNo: 'ANN-SEED-002', stepStatus: 'PENDING', batchNumber: 'SEED-ANN-002' },
    { processCode: 'RWD', activeRouteCode: 'R', coilNo: 'RWD-SEED-001', stepStatus: 'ACTIVE', batchNumber: 'SEED-RWD-001' },
    { processCode: 'RWD', activeRouteCode: 'R', coilNo: 'RWD-SEED-002', stepStatus: 'PENDING', batchNumber: 'SEED-RWD-002' },
    { processCode: 'CRS', activeRouteCode: 'C', coilNo: 'CRS-COIL-001', stepStatus: 'ACTIVE', batchNumber: 'SEED-CRS-001' },
    { processCode: 'CRS', activeRouteCode: 'C', coilNo: 'CRS-SEED-002', stepStatus: 'PENDING', batchNumber: 'SEED-CRS-002' },
    { processCode: 'CTL', activeRouteCode: 'LE', coilNo: 'CTL-COIL-001', stepStatus: 'ACTIVE', batchNumber: 'SEED-CTL-001' },
    { processCode: 'CTL', activeRouteCode: 'LE', coilNo: 'CTL-SEED-002', stepStatus: 'PENDING', batchNumber: 'SEED-CTL-002' },
  ];

  const coilByNo = Object.fromEntries(coilSpecs.map((c) => [c.coilNo, c]));
  const results = [];
  for (const q of queueEntries) {
    const coil = coilByNo[q.coilNo];
    results.push(await seedQueueEntry(client, { ...q, customerName: coil.customerName, gradeCode: coil.gradeCode, widthMm: coil.widthMm, thicknessMm: coil.thicknessMm, weightMt: coil.weightMt, planDate, shiftCode }));
  }

  const annCharge = await seedAnnCharge(client, planDate, shiftCode);
  return { planDate, shiftCode, created: results.filter((r) => !r.skipped).length, skipped: results.filter((r) => r.skipped).length, annCharge, results };
}

async function main() {
  const client = new pg.Client({ connectionString: DEFAULT_URL });
  await client.connect();
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [TENANT_ID]);
  try {
    await client.query('BEGIN');
    const summary = await seedProcessQueues(client);
    await client.query('COMMIT');
    console.log('Process queue seed (' + summary.planDate + ' shift ' + summary.shiftCode + '):');
    console.log('  journeys created=' + summary.created + ' skipped=' + summary.skipped);
    if (summary.annCharge?.chargeNo) console.log('  ANN charge ' + summary.annCharge.chargeNo + ' (' + summary.annCharge.rosterCount + ' coils)');
    for (const r of summary.results) if (!r.skipped) console.log('    + ' + r.processCode + ' ' + r.coilNo);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.includes('seed-process-queues')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}


