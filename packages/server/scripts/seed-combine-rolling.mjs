#!/usr/bin/env node
/**
 * Seed 5 combine-compatible ROLLING orders on 6HI for Manual Re-Roll / SixHi combine smoke.
 * Same mother coil + slit + finish family + subprocess → auto-combine pool.
 *
 * Usage (from packages/server):
 *   node --env-file=../../.env scripts/seed-combine-rolling.mjs
 *   node --env-file=../../.env scripts/seed-combine-rolling.mjs --machine=4HI
 */
import pg from 'pg';

const machine = (process.argv.find((a) => a.startsWith('--machine='))?.split('=')[1] || '6HI')
  .toUpperCase();
if (!['6HI', '4HI', '2HI'].includes(machine)) {
  console.error('machine must be 6HI, 4HI, or 2HI');
  process.exit(1);
}

const url =
  process.env.DATABASE_URL ||
  `postgres://${encodeURIComponent(process.env.DB_USER || 'm1_user')}:${encodeURIComponent(process.env.DB_PASSWORD || 'm1_password')}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'm1_db'}`;

const plantToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const MOTHER = 'COMBINE-MOTHER-001';
const SLIT = 'A';
const FINISH = 'MATT';
const SUB = 'ROLLING';
const TAG = 'COMBINE_SEED';

const batches = [1, 2, 3, 4, 5].map((i) => ({
  batchNumber: `COMBINE-${machine}-${String(i).padStart(2, '0')}`,
  weight: 8 + i * 0.5,
  thk: 1.2 + i * 0.05, // thickness differs — combine key ignores it
  width: 1250,
  seq: 900 + i,
}));

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO master.process (process_id, code, name, seq_no, has_mill_type)
      VALUES (31, 'ROLLING', 'Rolling', 31, FALSE)
      ON CONFLICT (process_id) DO NOTHING
    `);
    await client.query(`
      INSERT INTO master.machine (machine_code, process_id, name)
      VALUES ($1, 31, $1)
      ON CONFLICT (machine_code) DO NOTHING
    `, [machine]);

    const gradeRes = await client.query(
      `SELECT grade_code FROM master.grade ORDER BY grade_code LIMIT 1`,
    );
    const gradeCode = gradeRes.rows[0]?.grade_code;
    if (!gradeCode) throw new Error('No master.grade rows — seed grades first');

    const cust = await client.query(
      `SELECT customer_id, customer_name FROM master.customer ORDER BY customer_id LIMIT 1`,
    );
    const customerId = cust.rows[0]?.customer_id ?? null;
    const customerName = cust.rows[0]?.customer_name ?? 'Combine Seed Customer';

    await client.query(
      `INSERT INTO coil.coil (coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, status)
       VALUES ($1, $2, $3, 1250, 2.0, 45.0, 'PLANNED')
       ON CONFLICT (coil_no) DO UPDATE SET status = 'PLANNED', weight_mt = EXCLUDED.weight_mt, grade_code = EXCLUDED.grade_code`,
      [MOTHER, customerId, gradeCode],
    );

    const user = await client.query(
      `SELECT user_id FROM security.app_user WHERE emp_code IN ('3000','1000','EMP001') ORDER BY user_id LIMIT 1`,
    );
    const userId = user.rows[0]?.user_id ?? null;

    const shiftRes = await client.query(
      `INSERT INTO txn.shift_log (process_id, prod_date, shift_code, mill_type, target_mt, state)
       VALUES (31, $1::date, 'A', NULL, 50.0, 'DRAFT')
       ON CONFLICT (prod_date, shift_code, process_id, mill_type)
       DO UPDATE SET state = 'DRAFT', target_mt = EXCLUDED.target_mt
       RETURNING shift_log_id`,
      [plantToday],
    );
    const shiftLogId = shiftRes.rows[0].shift_log_id;

    const seeded = [];
    for (const b of batches) {
      const ppc = await client.query(
        `INSERT INTO planning.ppc_batch (
           batch_number, plan_date, shift_code, machine_code, sub_process, coil_no, slit_id,
           customer_name, grade_code, width_mm, input_thk_mm, ppc_thk_mm, finish_thk_mm,
           ppc_weight_mt, roll_finish, queue_seq, destination, machine_allocated,
           ppc_remarks, raw_row_json
         ) VALUES (
           $1, $2::date, 'A', $3, $4, $5, $6,
           $7, $15, $8, $9, $9, $9,
           $10, $11, $12, 'ANNEALING', TRUE,
           $13, $14::jsonb
         )
         ON CONFLICT (batch_number) DO UPDATE SET
           plan_date = EXCLUDED.plan_date,
           shift_code = EXCLUDED.shift_code,
           machine_code = EXCLUDED.machine_code,
           sub_process = EXCLUDED.sub_process,
           coil_no = EXCLUDED.coil_no,
           slit_id = EXCLUDED.slit_id,
           roll_finish = EXCLUDED.roll_finish,
           grade_code = EXCLUDED.grade_code,
           ppc_weight_mt = EXCLUDED.ppc_weight_mt,
           machine_allocated = TRUE,
           queue_seq = EXCLUDED.queue_seq,
           ppc_remarks = EXCLUDED.ppc_remarks
         RETURNING batch_id, batch_number`,
        [
          b.batchNumber,
          plantToday,
          machine,
          SUB,
          MOTHER,
          SLIT,
          customerName,
          b.width,
          b.thk,
          b.weight,
          FINISH,
          b.seq,
          `${TAG} combine smoke`,
          JSON.stringify({ tag: TAG, mother: MOTHER, slit: SLIT, finish: FINISH }),
          gradeCode,
        ],
      );
      const batchId = ppc.rows[0].batch_id;

      const order = await client.query(
        `INSERT INTO txn.crm_order (
           shift_log_id, batch_id, batch_number, coil_no, slit_id, customer_name, grade_code,
           width_mm, input_thk_mm, ppc_thk_mm, ppc_weight_mt, sub_process, status,
           logged_in_user_id, production_day, shift_code, prod_date
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $13,
           $7, $8, $8, $9, $10, 'PENDING',
           $11, $12::date, 'A', $12::date
         )
         ON CONFLICT (batch_id) DO UPDATE SET
           status = 'PENDING',
           batch_number = EXCLUDED.batch_number,
           coil_no = EXCLUDED.coil_no,
           slit_id = EXCLUDED.slit_id,
           grade_code = EXCLUDED.grade_code,
           ppc_weight_mt = EXCLUDED.ppc_weight_mt,
           shift_log_id = EXCLUDED.shift_log_id,
           prod_start_at = NULL,
           prod_end_at = NULL,
           prod_duration_min = NULL,
           combined_group_id = NULL,
           updated_at = now()
         RETURNING order_id, batch_number, status`,
        [
          shiftLogId,
          batchId,
          b.batchNumber,
          MOTHER,
          SLIT,
          customerName,
          b.width,
          b.thk,
          b.weight,
          SUB,
          userId,
          plantToday,
          gradeCode,
        ],
      );

      await client.query(
        `INSERT INTO txn.crm_rolling (order_id, destination, roll_finish, rerolling, total_passes, shift_code, prod_date)
         VALUES ($1, 'ANNEALING', $2, FALSE, 0, 'A', $3::date)
         ON CONFLICT (order_id) DO UPDATE SET
           roll_finish = EXCLUDED.roll_finish,
           destination = EXCLUDED.destination`,
        [order.rows[0].order_id, FINISH, plantToday],
      );

      seeded.push({
        batchNumber: order.rows[0].batch_number,
        orderId: String(order.rows[0].order_id),
        status: order.rows[0].status,
        weightMt: b.weight,
      });
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      ok: true,
      machine,
      planDate: plantToday,
      combineKey: `${MOTHER}|${SLIT}|${FINISH}`,
      subProcess: SUB,
      orders: seeded,
      hint: `Open ${machine} → Rolling or Manual Re-Roll. Select COMBINE-${machine}-01 — all 5 should auto-tick.`,
    }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
