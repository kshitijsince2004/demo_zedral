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

async function listAnnQueueCoils(client) {
  const res = await client.query(`
    SELECT oj.coil_no, c.grade_code
    FROM planning.order_journey oj
    JOIN planning.order_journey_step ojs
      ON ojs.journey_id = oj.journey_id AND ojs.step_no = oj.current_step_no
    JOIN coil.coil c ON c.coil_no = oj.coil_no
    WHERE oj.status IN ('ACTIVE', 'HOLD')
      AND ojs.process_code = 'ANN'
      AND ojs.status IN ('PENDING', 'ACTIVE', 'HOLD')
      AND NOT EXISTS (SELECT 1 FROM txn.ann_charge_coil acc WHERE acc.coil_no = oj.coil_no)
    ORDER BY oj.journey_id ASC
  `);
  return res.rows;
}

async function seedAnnCharge(client, planDate, shiftCode, rosterOverride) {
  const annProc = await client.query("SELECT process_id FROM master.process WHERE code = 'ANN' LIMIT 1");
  const processId = annProc.rows[0]?.process_id;
  if (!processId) return { chargeNo: null, skipped: true };

  const shiftRes = await client.query(
    `SELECT shift_log_id FROM txn.shift_log WHERE process_id = $1 AND prod_date = $2::date AND shift_code = $3 AND mill_type IS NULL LIMIT 1`,
    [processId, planDate, shiftCode],
  );
  const shiftLogId = shiftRes.rows[0]?.shift_log_id;
  if (!shiftLogId) return { chargeNo: null, skipped: true };

  await ensureAnnSpecMasters(client);

  const stages = await client.query(
    `SELECT stage_code, seq FROM master.ann_stage
     WHERE is_active = true AND COALESCE(default_active, true) = true
     ORDER BY seq`,
  );

  async function upsertCharge({ chargeNo, annealingBatchNo, baseNo, roster, activeSeq, soakTemp }) {
    await client.query(
      `INSERT INTO txn.ann_charge (
         charge_no, shift_log_id, status, grade_code, no_of_coils, charge_wt_mt,
         annealing_batch_no, base_no, soak_temp_degc, soak_time_hr
       )
       VALUES ($1, $2, 'IN_PROCESS', 'CRCA', 0, 0, $3, $4, $5, 10)
       ON CONFLICT (charge_no) DO UPDATE SET
         annealing_batch_no = EXCLUDED.annealing_batch_no,
         base_no = EXCLUDED.base_no,
         soak_temp_degc = EXCLUDED.soak_temp_degc,
         soak_time_hr = EXCLUDED.soak_time_hr,
         status = CASE WHEN txn.ann_charge.status = 'DONE' THEN txn.ann_charge.status ELSE 'IN_PROCESS' END`,
      [chargeNo, shiftLogId, annealingBatchNo, baseNo, soakTemp],
    );

    for (const [coilNo, seq] of roster) {
      await client.query(
        `INSERT INTO txn.ann_charge_coil (charge_no, coil_no, seq_no, disposition)
         VALUES ($1, $2, $3, 'ADVANCE') ON CONFLICT DO NOTHING`,
        [chargeNo, coilNo, seq],
      );
      await client.query(
        `UPDATE planning.order_journey_step ojs
         SET status = 'ACTIVE', started_at = COALESCE(started_at, now())
         FROM planning.order_journey oj
         WHERE oj.journey_id = ojs.journey_id
           AND oj.coil_no = $1
           AND ojs.step_no = oj.current_step_no
           AND ojs.process_code = 'ANN'`,
        [coilNo],
      );
    }

    for (const s of stages.rows) {
      const done = s.seq < activeSeq;
      const active = s.seq === activeSeq;
      await client.query(
        `INSERT INTO txn.ann_charge_stage (charge_no, stage_code, seq, start_at, end_at, skipped)
         VALUES (
           $1, $2, $3::int,
           CASE WHEN $3::int <= $4::int THEN now() - ((($4::int - $3::int + 1) * interval '45 minutes')) ELSE NULL END,
           CASE WHEN $3::int < $4::int THEN now() - ((($4::int - $3::int) * interval '45 minutes')) ELSE NULL END,
           false
         )
         ON CONFLICT (charge_no, stage_code) DO UPDATE SET
           start_at = COALESCE(txn.ann_charge_stage.start_at, EXCLUDED.start_at),
           end_at = CASE
             WHEN txn.ann_charge_stage.end_at IS NOT NULL THEN txn.ann_charge_stage.end_at
             WHEN $3::int < $4::int THEN EXCLUDED.end_at
             ELSE txn.ann_charge_stage.end_at
           END`,
        [chargeNo, s.stage_code, s.seq, activeSeq],
      );
      if (active) {
        await client.query(
          `UPDATE txn.ann_charge_stage SET end_at = NULL, start_at = COALESCE(start_at, now())
           WHERE charge_no = $1 AND stage_code = $2`,
          [chargeNo, s.stage_code],
        );
      }
    }

    const activeStage = stages.rows.find((s) => s.seq === activeSeq);
    if (activeStage) {
      await client.query(
        `UPDATE txn.ann_charge SET current_stage_code = $2 WHERE charge_no = $1`,
        [chargeNo, activeStage.stage_code],
      );
    }

    const rosterWt = await client.query(
      `SELECT c.weight_mt FROM txn.ann_charge_coil acc JOIN coil.coil c ON c.coil_no = acc.coil_no WHERE acc.charge_no = $1`,
      [chargeNo],
    );
    const chargeWt = rosterWt.rows.reduce((sum, r) => sum + Number(r.weight_mt ?? 0), 0);
    await client.query(
      'UPDATE txn.ann_charge SET no_of_coils = $2, charge_wt_mt = $3 WHERE charge_no = $1',
      [chargeNo, rosterWt.rows.length, chargeWt],
    );

    // Sample readings for Trends (idempotent: skip if already have ≥3).
    const existing = await client.query(
      `SELECT COUNT(*)::int AS n FROM txn.ann_charge_reading WHERE charge_no = $1`,
      [chargeNo],
    );
    if ((existing.rows[0]?.n ?? 0) < 3 && activeStage) {
      const temps = [420, 510, 620, 670, 685];
      for (let i = 0; i < temps.length; i++) {
        await client.query(
          `INSERT INTO txn.ann_charge_reading (
             charge_no, base_no, taken_at, stage_code, shift_code,
             charge_temp, gas_temp, fc_temp, n2h2_flow, base_press, base_fan_rpm, fuel_flow, rcf_rpm
           ) VALUES (
             $1, $2, now() - ((($5::int - $6::int) * interval '30 minutes')), $3, $4,
             $7::numeric, $7::numeric + 15, $7::numeric - 40, 12.5, 180 + $6::int, 950 + ($6::int * 10), 8.2, 720
           )`,
          [chargeNo, baseNo, activeStage.stage_code, shiftCode, temps.length, i, temps[i]],
        );
      }
    }

    return { chargeNo, annealingBatchNo, baseNo, rosterCount: rosterWt.rows.length, stage: activeStage?.stage_code };
  }

  const defaultCharges = [
    {
      chargeNo: 'SEED-ANN-CHG-001',
      annealingBatchNo: 'SEED-ANN-BATCH-001',
      baseNo: 'AB16',
      roster: [['ANN-SEED-001', 1], ['ANN-SEED-002', 2]],
      activeSeq: 3,
      soakTemp: 680,
    },
    {
      chargeNo: 'SEED-ANN-CHG-002',
      annealingBatchNo: 'SEED-ANN-BATCH-002',
      baseNo: 'AB01',
      roster: [['ANN-SEED-003', 1]],
      activeSeq: 4,
      soakTemp: 660,
    },
  ];

  let chargePlans = defaultCharges;
  if (rosterOverride?.length >= 5) {
    chargePlans = [
      {
        chargeNo: 'SEED-ANN-CHG-001',
        annealingBatchNo: '10154',
        baseNo: 'AB16',
        roster: rosterOverride.slice(0, 3).map((r, i) => [r.coil_no, i + 1]),
        activeSeq: 3,
        soakTemp: 680,
      },
      {
        chargeNo: 'SEED-ANN-CHG-002',
        annealingBatchNo: '10155',
        baseNo: 'AB01',
        roster: rosterOverride.slice(3, 5).map((r, i) => [r.coil_no, i + 1]),
        activeSeq: 4,
        soakTemp: 660,
      },
    ];
  }

  const charges = [];
  for (const plan of chargePlans) {
    charges.push(await upsertCharge(plan));
  }

  const c1 = charges[0];
  const c2 = charges[1] ?? charges[0];

  return {
    chargeNo: c1.chargeNo,
    annealingBatchNo: c1.annealingBatchNo,
    baseNo: c1.baseNo,
    shiftLogId,
    rosterCount: charges.reduce((n, c) => n + c.rosterCount, 0),
    charges,
  };
}

/** ANN-only seed: board charges + PENDING batching queue from existing PPC/import coils. */
export async function seedAnnOnly(client, opts = {}) {
  const planDate = opts.planDate ?? new Date().toISOString().slice(0, 10);
  const shiftCode = opts.shiftCode ?? 'A';
  await ensureProcessShiftLogs(client, planDate, shiftCode);

  const queue = await listAnnQueueCoils(client);
  if (queue.length < 5) {
    throw new Error(`Need at least 5 ANN queue coils (have ${queue.length}). Import ANNE PPC plan first.`);
  }

  const onCharge = new Set(queue.slice(0, 5).map((r) => r.coil_no));
  const pendingReset = await client.query(
    `UPDATE planning.order_journey_step ojs
     SET status = 'PENDING', started_at = NULL, completed_at = NULL
     FROM planning.order_journey oj
     WHERE oj.journey_id = ojs.journey_id
       AND ojs.step_no = oj.current_step_no
       AND ojs.process_code = 'ANN'
       AND oj.status = 'ACTIVE'
       AND ojs.status IN ('ACTIVE', 'PENDING')
       AND NOT (oj.coil_no = ANY($1::text[]))`,
    [[...onCharge]],
  );

  const annCharge = await seedAnnCharge(client, planDate, shiftCode, queue);
  const pendingCount = await client.query(`
    SELECT COUNT(*)::int AS n
    FROM planning.order_journey oj
    JOIN planning.order_journey_step ojs ON ojs.journey_id = oj.journey_id AND ojs.step_no = oj.current_step_no
    WHERE ojs.process_code = 'ANN' AND ojs.status = 'PENDING' AND oj.status = 'ACTIVE'
  `);

  return {
    planDate,
    shiftCode,
    annCharge,
    queuePending: pendingCount.rows[0]?.n ?? 0,
    queueReset: pendingReset.rowCount ?? 0,
  };
}


async function ensureAnnSpecMasters(client) {
  await client.query(`
    INSERT INTO master.ann_base (base_no, capacity_max_coils, capacity_max_wt_mt, soak_time_adj_hr, is_active)
    SELECT v.base_no, 12, 40, v.adj, true
    FROM (VALUES
      ('AB01', 1), ('AB02', 0), ('AB03', 0), ('AB04', 0),
      ('AB05', 0), ('AB06', 1), ('AB07', 0), ('AB08', 0),
      ('AB09', 0), ('AB10', 0), ('AB11', 0), ('AB12', 0),
      ('AB13', 0), ('AB14', 0), ('AB15', 0), ('AB16', 0)
    ) AS v(base_no, adj)
    ON CONFLICT (base_no) DO UPDATE SET
      capacity_max_coils = EXCLUDED.capacity_max_coils,
      capacity_max_wt_mt = EXCLUDED.capacity_max_wt_mt,
      soak_time_adj_hr = EXCLUDED.soak_time_adj_hr,
      is_active = true
  `);
  await client.query(`
    INSERT INTO master.ann_spec_limit (param_key, scope, min_val, max_val, unit, is_active) VALUES
      ('soak_temp', 'RR', 650, 710, 'C', true),
      ('soak_time', 'RR', 8, 12, 'hr', true),
      ('soak_temp', 'D', 610, 670, 'C', true),
      ('soak_time', 'D', 4, 8, 'hr', true),
      ('furnace_cool_min_hr', 'ALL', 2, NULL, 'hr', true),
      ('rapid_cool_start_max', 'ALL', NULL, 450, 'C', true),
      ('water_cool_start_max', 'ALL', NULL, 375, 'C', true),
      ('purge_o2_max', 'ALL', NULL, 0.5, '%', true),
      ('tightness_drop_max', 'ALL', NULL, 50, 'mmWC', true),
      ('clubbing_soak_spread', 'ALL', 10, 30, 'C', true)
    ON CONFLICT (param_key, scope) DO UPDATE SET
      min_val = EXCLUDED.min_val,
      max_val = EXCLUDED.max_val,
      unit = EXCLUDED.unit,
      is_active = true
  `);
  await client.query(`
    ALTER TABLE master.ann_stage ADD COLUMN IF NOT EXISTS default_active BOOLEAN NOT NULL DEFAULT true;
    INSERT INTO master.ann_stage (stage_code, seq, label, is_skippable, default_active, is_active) VALUES
      ('LOADING', 1, 'Loading', false, true, true),
      ('PURGING', 2, 'Purging', false, true, true),
      ('HEATING', 3, 'Heating', false, true, true),
      ('SOAKING', 4, 'Soaking', false, true, true),
      ('FURNACE_COOL', 5, 'Furnace Cool', false, true, true),
      ('NATURAL_COOL', 6, 'Natural Cool', false, true, true),
      ('RAPID_COOL', 7, 'Rapid Cool', true, true, true),
      ('WATER_COOL', 8, 'Water Cool', true, true, true),
      ('POST_PURGING', 9, 'Post Purging', false, true, true),
      ('UNLOADING', 10, 'Unloading', false, true, true)
    ON CONFLICT (stage_code) DO UPDATE SET
      seq = EXCLUDED.seq,
      label = EXCLUDED.label,
      is_skippable = EXCLUDED.is_skippable,
      default_active = EXCLUDED.default_active,
      is_active = true
  `);
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
    { coilNo: 'ANN-SEED-003', customerId: cust.CUST_HONDA?.customer_id, customerName: cust.CUST_HONDA?.customer_name ?? 'Honda Cars India', gradeCode: 'CRCA', widthMm: 1220, thicknessMm: 2.2, weightMt: 20.5 },
    { coilNo: 'ANN-Q-001', customerId: cust.CUST_TATA?.customer_id, customerName: cust.CUST_TATA?.customer_name ?? 'Tata Motors', gradeCode: 'CRCA', widthMm: 1250, thicknessMm: 2.4, weightMt: 18.0 },
    { coilNo: 'ANN-Q-002', customerId: cust.CUST_MARUTI?.customer_id, customerName: cust.CUST_MARUTI?.customer_name ?? 'Maruti Suzuki', gradeCode: 'D513', widthMm: 1480, thicknessMm: 1.9, weightMt: 17.2 },
    { coilNo: 'ANN-Q-003', customerId: cust.CUST_HONDA?.customer_id, customerName: cust.CUST_HONDA?.customer_name ?? 'Honda Cars India', gradeCode: 'CRCA', widthMm: 1200, thicknessMm: 2.1, weightMt: 16.5 },
    { coilNo: 'ANN-Q-004', customerId: cust.CUST_TATA?.customer_id, customerName: cust.CUST_TATA?.customer_name ?? 'Tata Motors', gradeCode: 'D513', widthMm: 1300, thicknessMm: 2.0, weightMt: 15.8 },
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
    { processCode: 'ANN', activeRouteCode: 'F', coilNo: 'ANN-SEED-002', stepStatus: 'ACTIVE', batchNumber: 'SEED-ANN-002' },
    { processCode: 'ANN', activeRouteCode: 'F', coilNo: 'ANN-SEED-003', stepStatus: 'ACTIVE', batchNumber: 'SEED-ANN-003' },
    { processCode: 'ANN', activeRouteCode: 'F', coilNo: 'ANN-Q-001', stepStatus: 'PENDING', batchNumber: 'SEED-ANN-Q-001' },
    { processCode: 'ANN', activeRouteCode: 'F', coilNo: 'ANN-Q-002', stepStatus: 'PENDING', batchNumber: 'SEED-ANN-Q-002' },
    { processCode: 'ANN', activeRouteCode: 'F', coilNo: 'ANN-Q-003', stepStatus: 'PENDING', batchNumber: 'SEED-ANN-Q-003' },
    { processCode: 'ANN', activeRouteCode: 'F', coilNo: 'ANN-Q-004', stepStatus: 'PENDING', batchNumber: 'SEED-ANN-Q-004' },
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
  const annOnly = process.argv.includes('--ann-only');
  const planDateArg = process.argv.find((a) => a.startsWith('--date='));
  const shiftArg = process.argv.find((a) => a.startsWith('--shift='));
  const planDate = planDateArg?.slice(7) ?? new Date().toISOString().slice(0, 10);
  const shiftCode = shiftArg?.slice(8)?.toUpperCase() ?? 'A';

  const client = new pg.Client({ connectionString: DEFAULT_URL });
  await client.connect();
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [TENANT_ID]);
  try {
    await client.query('BEGIN');
    if (annOnly) {
      const summary = await seedAnnOnly(client, { planDate, shiftCode });
      await client.query('COMMIT');
      console.log(`ANN seed (${summary.planDate} shift ${summary.shiftCode}):`);
      console.log(`  batching queue PENDING=${summary.queuePending} (reset ${summary.queueReset} coils)`);
      if (summary.annCharge?.chargeNo) {
        console.log(
          '  ANN charge ' + summary.annCharge.chargeNo +
          ' batch=' + summary.annCharge.annealingBatchNo +
          ' base=' + summary.annCharge.baseNo +
          ' (' + summary.annCharge.rosterCount + ' coils across charges)',
        );
        for (const c of summary.annCharge.charges ?? []) {
          console.log('    · ' + c.chargeNo + ' base=' + c.baseNo + ' stage=' + c.stage + ' coils=' + c.rosterCount);
        }
      }
      return;
    }

    const summary = await seedProcessQueues(client, { planDate, shiftCode });
    await client.query('COMMIT');
    console.log('Process queue seed (' + summary.planDate + ' shift ' + summary.shiftCode + '):');
    console.log('  journeys created=' + summary.created + ' skipped=' + summary.skipped);
    if (summary.annCharge?.chargeNo) {
      console.log(
        '  ANN charge ' + summary.annCharge.chargeNo +
        ' batch=' + summary.annCharge.annealingBatchNo +
        ' base=' + summary.annCharge.baseNo +
        ' (' + summary.annCharge.rosterCount + ' coils across charges)',
      );
      for (const c of summary.annCharge.charges ?? []) {
        console.log('    · ' + c.chargeNo + ' base=' + c.baseNo + ' stage=' + c.stage + ' coils=' + c.rosterCount);
      }
    }
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


