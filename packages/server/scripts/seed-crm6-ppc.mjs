#!/usr/bin/env node
/**
 * Seeds 6HI PPC test batches (planning.ppc_batch) plus supporting coils,
 * skin-pass production demos, and an active SixHi shift log. Idempotent — safe to re-run.
 *
 * Usage: npm run seed:crm6-ppc
 */
import pg from 'pg';
import { fileURLToPath } from 'url';

const DEFAULT_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Create PENDING crm6_order rows for allocated PPC batches (rolling + skin pass).
 * @param {pg.Client} client
 * @param {{ planDate: string, shiftCode: string, operatorUserId?: number | null, subProcess: 'ROLLING' | 'SKIN_PASS', limit?: number }} ctx
 */
async function seedPendingQueueOrders(client, ctx) {
  const shiftLog = await client.query(
    `SELECT shift_log_id FROM txn.shift_log
     WHERE process_id = 31 AND prod_date = $1::date AND shift_code = $2 AND mill_type IS NULL`,
    [ctx.planDate, ctx.shiftCode],
  );
  const shiftLogId = shiftLog.rows[0]?.shift_log_id;
  if (!shiftLogId) return { demoOrders: 0 };

  let operatorUserId = ctx.operatorUserId ?? null;
  if (!operatorUserId) {
    const u = await client.query(
      `SELECT user_id FROM security.app_user WHERE emp_code = '3000' LIMIT 1`,
    );
    operatorUserId = u.rows[0]?.user_id ?? null;
  }

  const batches = await client.query(
    `SELECT batch_id, batch_number, coil_no, slit_id, customer_name, grade_code,
            width_mm, input_thk_mm, ppc_thk_mm, ppc_weight_mt, sub_process
     FROM planning.ppc_batch
     WHERE plan_date = $1::date AND shift_code = $2
       AND machine_code = '6HI' AND sub_process = $3 AND machine_allocated = TRUE
     ORDER BY queue_seq
     LIMIT $4`,
    [ctx.planDate, ctx.shiftCode, ctx.subProcess, ctx.limit ?? 8],
  );

  let demoOrders = 0;
  for (const b of batches.rows) {
    const inputThk = Number(b.input_thk_mm ?? b.ppc_thk_mm);
    const orderRes = await client.query(
      `INSERT INTO txn.crm6_order (
         shift_log_id, batch_id, batch_number, coil_no, slit_id, customer_name, grade_code,
         width_mm, input_thk_mm, ppc_thk_mm, ppc_weight_mt, sub_process, status,
         logged_in_user_id, production_day
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDING', $13, $14::date
       )
       ON CONFLICT (batch_id) DO UPDATE SET
         status = 'PENDING',
         prod_start_at = NULL,
         prod_end_at = NULL,
         prod_duration_min = NULL,
         shift_log_id = EXCLUDED.shift_log_id
       RETURNING order_id`,
      [
        shiftLogId,
        b.batch_id,
        b.batch_number,
        b.coil_no,
        b.slit_id,
        b.customer_name,
        b.grade_code,
        b.width_mm,
        inputThk,
        b.ppc_thk_mm,
        b.ppc_weight_mt,
        b.sub_process,
        operatorUserId,
        ctx.planDate,
      ],
    );
    const orderId = orderRes.rows[0].order_id;

    if (b.sub_process === 'SKIN_PASS') {
      await client.query(
        `INSERT INTO txn.crm6_skinpass (order_id, output_thk_mm)
         VALUES ($1, $2)
         ON CONFLICT (order_id) DO UPDATE SET output_thk_mm = EXCLUDED.output_thk_mm`,
        [orderId, b.ppc_thk_mm],
      );
    } else {
      await client.query(
        `INSERT INTO txn.crm6_rolling (order_id, total_passes)
         VALUES ($1, 0)
         ON CONFLICT (order_id) DO NOTHING`,
        [orderId],
      );
    }
    demoOrders++;
  }

  return { demoOrders };
}

/**
 * @param {pg.Client} client — must be connected; runs inside caller transaction if provided
 * @param {{ planDate?: string, shiftCode?: string, importedByUserId?: number }} opts
 */
export async function seedSixHiPpc(client, opts = {}) {
  const today = opts.planDate ?? new Date().toISOString().slice(0, 10);
  const shiftCode = opts.shiftCode ?? 'B';
  const importedByUserId = opts.importedByUserId ?? null;

  // SixHi process + machine (migration should have created these)
  await client.query(`
    INSERT INTO master.process (process_id, code, name, seq_no, has_mill_type)
    VALUES (31, '6HI', '6HI', 31, FALSE)
    ON CONFLICT (process_id) DO NOTHING;
  `);

  await client.query(`
    INSERT INTO master.machine (machine_code, process_id, name) VALUES
      ('6HI', 31, '6HI'),
      ('4HI', NULL, 'CRM 4HI'),
      ('2HI', NULL, 'CRM 2HI')
    ON CONFLICT (machine_code) DO NOTHING;
  `);

  await client.query(`
    INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
      ('ROLLING', 'Rolling', '6HI'),
      ('SKIN_PASS', 'Skin Pass', '6HI')
    ON CONFLICT (sub_process_code) DO NOTHING;
  `);

  const cust = await client.query(
    `SELECT customer_id, customer_code, customer_name FROM master.customer
     WHERE customer_code IN ('CUST_TATA', 'CUST_MARUTI', 'CUST_HONDA')`,
  );
  const custByCode = Object.fromEntries(cust.rows.map((r) => [r.customer_code, r]));

  const coils = [
    ['PKL-COIL-001', 'PKL-COIL-001', custByCode.CUST_TATA?.customer_id, 'CRCA', 1250, 3.8, 23.0, 2, '6HI', 'PLANNED'],
    ['PKL-COIL-002', 'PKL-COIL-002', custByCode.CUST_MARUTI?.customer_id, 'D513', 1500, 3.2, 26.5, 2, '6HI', 'PLANNED'],
    ['CRM-COIL-001', 'PKL-COIL-001', custByCode.CUST_TATA?.customer_id, 'CRCA', 1250, 2.5, 21.0, 3, 'ANN', 'PLANNED'],
    ['CRM-COIL-002', 'PKL-COIL-002', custByCode.CUST_MARUTI?.customer_id, 'D513', 1500, 2.0, 24.0, 3, 'ANN', 'PLANNED'],
    ['MC6-88421', 'PKL-COIL-001', custByCode.CUST_TATA?.customer_id, 'CRCA', 1250, 3.8, 18.2, 2, '6HI', 'PLANNED'],
    ['MC6-88422', 'PKL-COIL-002', custByCode.CUST_MARUTI?.customer_id, 'D513', 1500, 3.2, 20.0, 2, '6HI', 'PLANNED'],
    ['MC6-88423', 'PKL-COIL-002', custByCode.CUST_MARUTI?.customer_id, 'D513', 1480, 2.8, 12.8, 2, '6HI', 'PLANNED'],
    ['MC6-88501', 'CRM-COIL-001', custByCode.CUST_TATA?.customer_id, 'CRCA', 1250, 2.5, 18.2, 3, 'SKP', 'PLANNED'],
    ['MC6-88502', 'CRM-COIL-002', custByCode.CUST_MARUTI?.customer_id, 'D513', 1500, 2.0, 16.0, 3, 'SKP', 'PLANNED'],
    ['MC6-88424', 'PKL-COIL-001', custByCode.CUST_TATA?.customer_id, 'CRCA', 1250, 2.0, 17.5, 2, '6HI', 'PLANNED'],
    ['MC6-88425', 'PKL-COIL-002', custByCode.CUST_HONDA?.customer_id, 'HROP', 1500, 1.9, 19.0, 2, '6HI', 'PLANNED'],
    ['MC6-88426', 'PKL-COIL-002', custByCode.CUST_MARUTI?.customer_id, 'D513', 1480, 1.5, 14.2, 2, '6HI', 'PLANNED'],
    ['MC6-88503', 'CRM-COIL-001', custByCode.CUST_TATA?.customer_id, 'CRCA', 1250, 0.68, 17.8, 3, 'SKP', 'PLANNED'],
    ['MC6-88504', 'CRM-COIL-002', custByCode.CUST_HONDA?.customer_id, 'HROP', 1500, 0.62, 15.5, 3, 'SKP', 'PLANNED'],
  ];

  for (const c of coils) {
    await client.query(
      `INSERT INTO coil.coil (coil_no, parent_coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, current_process_id, next_dest, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (coil_no) DO UPDATE SET
         grade_code = EXCLUDED.grade_code,
         nominal_width_mm = EXCLUDED.nominal_width_mm,
         coil_thk_mm = EXCLUDED.coil_thk_mm,
         weight_mt = EXCLUDED.weight_mt,
         status = EXCLUDED.status`,
      c,
    );
  }

  const operators = await client.query(
    `SELECT operator_id FROM master.operator WHERE emp_code = 'EMP001' LIMIT 1`,
  );
  const shiftManagerId = operators.rows[0]?.operator_id ?? null;

  // Active SixHi shift log (DRAFT) for queue context
  await client.query(
    `INSERT INTO txn.shift_log (process_id, prod_date, shift_code, mill_type, target_mt, state, shift_manager_id)
     VALUES (31, $1::date, $2, NULL, 42.0, 'DRAFT', $3)
     ON CONFLICT (prod_date, shift_code, process_id, mill_type)
     DO UPDATE SET target_mt = EXCLUDED.target_mt, state = 'DRAFT'`,
    [today, shiftCode, shiftManagerId],
  );

  const dateTag = today.replace(/-/g, '');
  const customers = [
    { name: custByCode.CUST_TATA?.customer_name ?? 'Tata Motors', code: 'CUST_TATA' },
    { name: custByCode.CUST_MARUTI?.customer_name ?? 'Maruti Suzuki', code: 'CUST_MARUTI' },
    { name: custByCode.CUST_HONDA?.customer_name ?? 'Honda Cars India', code: 'CUST_HONDA' },
  ];
  const rollingGrades = ['CRCA', 'D513', 'HROP'];
  const skinGrades = ['CRCA', 'D513'];
  const finishes = ['MATT', 'BRIGHT', 'LOW_MATT'];
  const slits = [null, 'A', 'B', 'C'];
  const widths = [1000, 1250, 1480, 1500];

  const rollingBatches = [];
  for (let i = 1; i <= 20; i++) {
    const cust = customers[i % customers.length];
    const grade = rollingGrades[i % rollingGrades.length];
    const target = Math.round((0.9 + (i % 16) * 0.1) * 10) / 10;
    const input = Math.round((target + 0.8 + (i % 5) * 0.2) * 100) / 100;
    const coil = `MC6-R${String(i).padStart(3, '0')}`;
    rollingBatches.push({
      batch: `B-${dateTag}-R${String(i).padStart(3, '0')}`,
      coil,
      slit: slits[i % slits.length],
      customer: cust.name,
      grade,
      width: widths[i % widths.length],
      inputThk: input,
      thk: target,
      wt: Math.round((12 + (i % 12) * 1.1) * 10) / 10,
      dest: i % 5 === 0 ? 'REWINDING' : 'ANNEALING',
      finish: finishes[i % finishes.length],
      rr: i % 7 === 0,
      seq: i,
    });
    await client.query(
      `INSERT INTO coil.coil (coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, status)
       SELECT $1, c.customer_id, $2, $3, $4, $5, 'PLANNED'
       FROM master.customer c WHERE c.customer_code = $6
       ON CONFLICT (coil_no) DO UPDATE SET coil_thk_mm = EXCLUDED.coil_thk_mm, weight_mt = EXCLUDED.weight_mt`,
      [coil, grade, widths[i % widths.length], input, rollingBatches[i - 1].wt, cust.code],
    );
  }

  const skinPassBatches = [];
  for (let i = 1; i <= 20; i++) {
    const cust = customers[(i + 1) % customers.length];
    const grade = skinGrades[i % skinGrades.length];
    const target = Math.round((0.55 + (i % 8) * 0.04) * 100) / 100;
    const input = Math.round((target + 0.12 + (i % 3) * 0.03) * 100) / 100;
    const coil = `MC6-SP${String(i).padStart(3, '0')}`;
    skinPassBatches.push({
      batch: `B-${dateTag}-SP${String(i).padStart(3, '0')}`,
      coil,
      slit: null,
      customer: cust.name,
      grade,
      width: widths[(i + 1) % widths.length],
      inputThk: input,
      thk: target,
      wt: Math.round((14 + (i % 10) * 0.9) * 10) / 10,
      finish: finishes[i % finishes.length],
      seq: i,
    });
    await client.query(
      `INSERT INTO coil.coil (coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, status)
       SELECT $1, c.customer_id, $2, $3, $4, $5, 'PLANNED'
       FROM master.customer c WHERE c.customer_code = $6
       ON CONFLICT (coil_no) DO UPDATE SET coil_thk_mm = EXCLUDED.coil_thk_mm, weight_mt = EXCLUDED.weight_mt`,
      [coil, grade, widths[(i + 1) % widths.length], input, skinPassBatches[i - 1].wt, cust.code],
    );
  }

  let importBatchId = null;
  const totalRows = rollingBatches.length + skinPassBatches.length;
  if (importedByUserId) {
    const existingBatch = await client.query(
      `SELECT import_batch_id FROM planning.import_batch
       WHERE file_name = 'SixHi-ppc-admin-seed.csv' AND imported_by = $1
       ORDER BY import_batch_id DESC LIMIT 1`,
      [importedByUserId],
    );
    if (existingBatch.rows.length > 0) {
      importBatchId = existingBatch.rows[0].import_batch_id;
      await client.query(
        `UPDATE planning.import_batch SET row_count = $1, status = 'LOADED', error_count = 0
         WHERE import_batch_id = $2`,
        [totalRows, importBatchId],
      );
    } else {
      const batchRes = await client.query(
        `INSERT INTO planning.import_batch (source, file_name, row_count, status, imported_by, error_count)
         VALUES ('CSV', 'SixHi-ppc-admin-seed.csv', $1, 'LOADED', $2, 0)
         RETURNING import_batch_id`,
        [totalRows, importedByUserId],
      );
      importBatchId = batchRes.rows[0].import_batch_id;
    }
  }

  let rollingCount = 0;
  let skinPassCount = 0;

  for (const b of rollingBatches) {
    const rawRow = {
      batch_number: b.batch,
      plan_date: today,
      shift_code: shiftCode,
      machine_code: '6HI',
      sub_process: 'ROLLING',
      coil_no: b.coil,
      slit_id: b.slit,
      customer_name: b.customer,
      grade_code: b.grade,
      width_mm: b.width,
      input_thk_mm: b.inputThk,
      ppc_thk_mm: b.thk,
      ppc_weight_mt: b.wt,
      destination: b.dest,
      roll_finish: b.finish,
      ppc_reroll_flag: b.rr,
      queue_seq: b.seq,
      sap_order_no: 'SAP-SixHi-PILOT',
    };
    await client.query(
      `INSERT INTO planning.ppc_batch (
         batch_number, plan_date, shift_code, machine_code, sub_process,
         coil_no, slit_id, customer_name, grade_code, width_mm, input_thk_mm, ppc_thk_mm, ppc_weight_mt,
         destination, roll_finish, ppc_reroll_flag, queue_seq, sap_order_no,
         import_batch_id, raw_row_json
       ) VALUES ($1,$2::date,$3,'6HI','ROLLING',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
       ON CONFLICT (batch_number) DO UPDATE SET
         plan_date = EXCLUDED.plan_date,
         shift_code = EXCLUDED.shift_code,
         queue_seq = EXCLUDED.queue_seq,
         input_thk_mm = EXCLUDED.input_thk_mm,
         ppc_weight_mt = EXCLUDED.ppc_weight_mt,
         import_batch_id = EXCLUDED.import_batch_id,
         raw_row_json = EXCLUDED.raw_row_json`,
      [
        b.batch,
        today,
        shiftCode,
        b.coil,
        b.slit,
        b.customer,
        b.grade,
        b.width,
        b.inputThk,
        b.thk,
        b.wt,
        b.dest,
        b.finish,
        b.rr,
        b.seq,
        'SAP-SixHi-PILOT',
        importBatchId,
        JSON.stringify(rawRow),
      ],
    );
    rollingCount++;
  }

  for (const b of skinPassBatches) {
    const rawRow = {
      batch_number: b.batch,
      plan_date: today,
      shift_code: shiftCode,
      machine_code: '6HI',
      sub_process: 'SKIN_PASS',
      coil_no: b.coil,
      slit_id: b.slit,
      customer_name: b.customer,
      grade_code: b.grade,
      width_mm: b.width,
      input_thk_mm: b.inputThk,
      ppc_thk_mm: b.thk,
      finish_thk_mm: b.thk,
      ppc_weight_mt: b.wt,
      roll_finish: b.finish,
      queue_seq: b.seq,
      sap_order_no: 'SAP-SixHi-PILOT',
    };
    await client.query(
      `INSERT INTO planning.ppc_batch (
         batch_number, plan_date, shift_code, machine_code, sub_process,
         coil_no, slit_id, customer_name, grade_code, width_mm, input_thk_mm, ppc_thk_mm, finish_thk_mm,
         ppc_weight_mt, roll_finish, queue_seq, sap_order_no, import_batch_id, raw_row_json
       ) VALUES ($1,$2::date,$3,'6HI','SKIN_PASS',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
       ON CONFLICT (batch_number) DO UPDATE SET
         plan_date = EXCLUDED.plan_date,
         shift_code = EXCLUDED.shift_code,
         queue_seq = EXCLUDED.queue_seq,
         input_thk_mm = EXCLUDED.input_thk_mm,
         finish_thk_mm = EXCLUDED.finish_thk_mm,
         roll_finish = EXCLUDED.roll_finish,
         import_batch_id = EXCLUDED.import_batch_id,
         raw_row_json = EXCLUDED.raw_row_json`,
      [
        b.batch,
        today,
        shiftCode,
        b.coil,
        b.slit,
        b.customer,
        b.grade,
        b.width,
        b.inputThk,
        b.thk,
        b.thk,
        b.wt,
        b.finish,
        b.seq,
        'SAP-SixHi-PILOT',
        importBatchId,
        JSON.stringify(rawRow),
      ],
    );
    skinPassCount++;
  }

  // Grant SixHi line access from CRM (idempotent)
  await client.query(`
    INSERT INTO security.line_access (user_id, process_id, access_level)
    SELECT la.user_id, 31, la.access_level
    FROM security.line_access la
    INNER JOIN master.process p ON la.process_id = p.process_id
    WHERE p.code = 'CRM'
    ON CONFLICT DO NOTHING;
  `);

  // Explicit SixHi access for pilot operator (badge 3000)
  await client.query(`
    INSERT INTO security.line_access (user_id, process_id, access_level)
    SELECT u.user_id, 31, 'WRITE'
    FROM security.app_user u
    WHERE u.emp_code = '3000'
    ON CONFLICT DO NOTHING;
  `);

  // Reset production orders for this plan window (cascade removes skinpass / rolling children)
  const cleared = await client.query(
    `DELETE FROM txn.crm6_order
     WHERE batch_id IN (
       SELECT batch_id FROM planning.ppc_batch
       WHERE plan_date = $1::date AND shift_code = $2 AND machine_code = '6HI'
     )
     RETURNING order_id`,
    [today, shiftCode],
  );

  const rollingOrders = await seedPendingQueueOrders(client, {
    planDate: today,
    shiftCode,
    operatorUserId: importedByUserId,
    subProcess: 'ROLLING',
    limit: 8,
  });
  const skinPassOrders = await seedPendingQueueOrders(client, {
    planDate: today,
    shiftCode,
    operatorUserId: importedByUserId,
    subProcess: 'SKIN_PASS',
    limit: 8,
  });

  return {
    planDate: today,
    shiftCode,
    rollingBatches: rollingCount,
    skinPassBatches: skinPassCount,
    rollingPendingOrders: rollingOrders.demoOrders,
    skinPassPendingOrders: skinPassOrders.demoOrders,
    queueOrders: rollingCount + skinPassCount,
    clearedOrders: cleared.rowCount,
    batchPrefix: `B-${today.replace(/-/g, '')}`,
    importBatchId: importBatchId ? String(importBatchId) : null,
  };
}

export async function seedSixHiPpcStandalone(databaseUrl = DEFAULT_URL) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);

  try {
    await client.query('BEGIN');
    const result = await seedSixHiPpc(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const url = process.argv[2] || DEFAULT_URL;
  console.log(`Seeding SixHi PPC test data → ${url.replace(/:[^:@]+@/, ':***@')}`);
  seedSixHiPpcStandalone(url)
    .then((r) => {
      console.log(`  plan_date=${r.planDate} shift=${r.shiftCode}`);
      console.log(`  rolling_batches=${r.rollingBatches} skin_pass_batches=${r.skinPassBatches}`);
      console.log(`  pending_orders rolling=${r.rollingPendingOrders} skin_pass=${r.skinPassPendingOrders} cleared=${r.clearedOrders}`);
      console.log(`  example rolling: ${r.batchPrefix}-R001  skin pass: ${r.batchPrefix}-SP001`);
      console.log('SixHi PPC seed complete.');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
