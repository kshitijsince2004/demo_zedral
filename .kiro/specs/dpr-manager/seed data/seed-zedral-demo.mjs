#!/usr/bin/env node
/**
 * seed-zedral-demo.mjs — Populates the Zedral / FORGE backend with a realistic,
 * historically-backdated dataset so the platform looks actively used end-to-end.
 *
 *  DATA PROVENANCE
 *  ───────────────
 *  REAL (extracted verbatim from the user's own operational files):
 *    • planning.ppc_batch     — every rolling + skin-pass plan row, June 1-10 2026
 *    • coil.coil              — distinct mother coils from those plans
 *    • master.customer/grade/surface_finish — distinct values seen in the plans
 *    • txn.shift_log totals   — daily/shift production tonnage from the DPR
 *    • txn.stoppage_entry     — real delay reasons/durations from the DPR DELAY sheet
 *
 *  SYNTHETIC (generated, and DELIBERATELY MARKED so it is never mistaken for real):
 *    • master.operator        — names carry a " (SIM)" suffix, emp_code prefix "SIM9"
 *    • crm6 order execution timers / statuses          — timing is generated
 *    • txn.machine_state_event — reason text is prefixed with the SEED_TAG "[SEED]"
 *    • shift_log.handover_notes for live SMED logs      — prefixed with SEED_TAG
 *    • crew assignments        — reference the marked synthetic operators
 *  Every synthetic facet is auditable: grep the DB for "SIM" / "[SEED]".
 *
 *  Idempotent — safe to re-run (ON CONFLICT upserts + select-first shift logs).
 *
 *  Usage:  node seed-zedral-demo.mjs [DATABASE_URL] [path/to/extracted_data.json]
 */
import pg from 'pg';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_URL =
  process.env.DATABASE_URL || 'postgres://m1_user:m1_password@localhost:5432/m1_db';
const TENANT_ID = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000001';
const SEED_TAG = '[SEED]';
const LIVE_DATE = '2026-06-10';        // most recent plan day → shown as "in progress"

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── deterministic PRNG so re-runs produce identical synthetic values ──
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260610);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const between = (lo, hi) => lo + rng() * (hi - lo);

const SHIFT_START = { A: 6, B: 14, C: 22 }; // hour-of-day for each shift

// build an IST timestamptz literal `date` + (hour:00 + plusMin), rolling into later days
function tsAt(date, hour, plusMin) {
  let total = hour * 60 + plusMin;
  const addDays = Math.floor(total / 1440); total -= addDays * 1440;
  const hh = Math.floor(total / 60), mm = total % 60;
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + addDays);
  const iso = d.toISOString().slice(0, 10);
  return `${iso} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`;
}
const OP_NAMES = [
  'Gurpreet Singh', 'Harjinder Kaur', 'Baljit Singh', 'Manpreet Singh',
  'Sukhwinder Kaur', 'Rajinder Singh', 'Amarjit Singh', 'Davinder Singh',
  'Jaspal Singh', 'Kuldeep Singh', 'Surinder Kaur', 'Balwinder Singh',
  'Harpreet Kaur', 'Tarsem Lal', 'Ravinder Singh',
];

// Stable, collision-free customer_code from the sorted-name index (deterministic across runs).
function customerCode(index) {
  return 'CUST' + String(index + 1).padStart(4, '0');
}

// ── shift-log upsert that is idempotent even when mill_type IS NULL ──
async function upsertShiftLog(c, { prod_date, shift_code, process_id, mill_type = null,
                                   target_mt = null, total_prod_mt = null, state = 'APPROVED',
                                   shift_manager_id = null, handover_notes = null }) {
  const found = await c.query(
    `SELECT shift_log_id FROM txn.shift_log
       WHERE prod_date = $1::date AND shift_code = $2 AND process_id = $3
         AND mill_type IS NOT DISTINCT FROM $4`,
    [prod_date, shift_code, process_id, mill_type]);
  if (found.rows.length) {
    const id = found.rows[0].shift_log_id;
    await c.query(
      `UPDATE txn.shift_log SET target_mt = COALESCE($2,target_mt),
         total_prod_mt = COALESCE($3,total_prod_mt), state = $4,
         shift_manager_id = COALESCE($5,shift_manager_id),
         handover_notes = COALESCE($6,handover_notes)
       WHERE shift_log_id = $1`,
      [id, target_mt, total_prod_mt, state, shift_manager_id, handover_notes]);
    return id;
  }
  const submittedAt = (state === 'SUBMITTED' || state === 'APPROVED') ? `${prod_date} 23:30:00+05:30` : null;
  const approvedAt = state === 'APPROVED' ? `${prod_date} 23:55:00+05:30` : null;
  const ins = await c.query(
    `INSERT INTO txn.shift_log (prod_date, shift_code, process_id, mill_type,
        target_mt, total_prod_mt, state, shift_manager_id, handover_notes,
        submitted_at, approved_at)
     VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz)
     RETURNING shift_log_id`,
    [prod_date, shift_code, process_id, mill_type, target_mt, total_prod_mt,
     state, shift_manager_id, handover_notes, submittedAt, approvedAt]);
  return ins.rows[0].shift_log_id;
}

export async function seedDemo(c, data) {
  const summary = {};
  // The default tenant + tenant_config rows are created by the migrations; we rely on them.

  // ===== TIER 0 : process / machine / sub-process (mirror seed-machines) =====
  await c.query(`INSERT INTO master.process (process_id, code, name, seq_no, has_mill_type)
    VALUES (31,'6HI','6HI',31,FALSE) ON CONFLICT (process_id) DO NOTHING;`);
  await c.query(`INSERT INTO master.machine (machine_code, process_id, name, process_code) VALUES
      ('6HI',31,'6HI Mill','6HI'),('4HI',NULL,'CRM 4HI','6HI'),('2HI',NULL,'CRM 2HI','6HI')
    ON CONFLICT (machine_code) DO NOTHING;`);
  await c.query(`INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
      ('ROLLING','Rolling','6HI'),('SKIN_PASS','Skin Pass','6HI')
    ON CONFLICT (sub_process_code) DO NOTHING;`);

  // Shift master rows (cleared by clear:data; required by ppc_batch + shift_log FKs)
  await c.query(`INSERT INTO master.shift (shift_code, name, start_time, end_time) VALUES
      ('A', 'Morning Shift', '06:00', '14:00'),
      ('B', 'Afternoon Shift', '14:00', '22:00'),
      ('C', 'Night Shift', '22:00', '06:00')
    ON CONFLICT (shift_code) DO NOTHING;`);

  // ===== TIER 0b : roles + demo login users (PIN 1234) =====
  await c.query(`INSERT INTO security.role (role_id, role_name, description) VALUES
      (1,'OPERATOR','Line Operator'),(2,'SUPERVISOR','Shift Supervisor'),
      (3,'PLANT_HEAD','Plant Head'),(4,'ADMIN','System Administrator'),
      (5,'MACHINE_HEAD','Machine Head') ON CONFLICT (role_id) DO NOTHING;`);
  const PIN_HASH = await makePinHash('1234');
  const loginUsers = [
    ['admin', '1000', 'Plant Admin', 4], ['supervisor', '2000', 'Line Supervisor', 2],
    ['operator', '3000', 'Shift Operator', 1], ['machinehead', '4000', 'Machine Head', 5],
    ['planthead', '5000', 'Plant Head', 3],
  ];
  const userId = {};
  for (const [username, emp, full, role] of loginUsers) {
    const ex = await c.query(`SELECT user_id FROM security.app_user WHERE emp_code=$1`, [emp]);
    let uid;
    if (ex.rows.length) {
      uid = ex.rows[0].user_id;
      await c.query(`UPDATE security.app_user SET pin_hash=$1,status='ACTIVE',
        pin_failed_attempts=0,pin_locked_until=NULL WHERE user_id=$2`, [PIN_HASH, uid]);
    } else {
      uid = (await c.query(
        `INSERT INTO security.app_user (username,full_name,emp_code,status,pin_hash)
         VALUES ($1,$2,$3,'ACTIVE',$4) RETURNING user_id`,
        [username, full, emp, PIN_HASH])).rows[0].user_id;
    }
    await c.query(`INSERT INTO security.user_role (user_id,role_id) VALUES ($1,$2)
      ON CONFLICT DO NOTHING`, [uid, role]);
    userId[username] = uid;
  }
  // line + machine access for the operating roles
  for (const code of ['HRS', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL', '6HI']) {
    const p = await c.query(`SELECT process_id FROM master.process WHERE code=$1`, [code]);
    if (!p.rows.length) continue;
    for (const u of ['supervisor', 'operator', 'machinehead', 'planthead'])
      await c.query(`INSERT INTO security.line_access (user_id,process_id,access_level)
        VALUES ($1,$2,'WRITE') ON CONFLICT DO NOTHING`, [userId[u], p.rows[0].process_id]);
  }
  for (const m of ['6HI', '4HI', '2HI'])
    for (const u of ['supervisor', 'machinehead'])
      await c.query(`INSERT INTO security.machine_access (user_id,machine_code)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId[u], m]);
  summary.login_users = loginUsers.length;

  // ===== TIER 1 : masters derived from REAL plan data =====
  const customers = [...new Set(data.ppc.map((b) => b.customer_name))].sort();
  const custId = {};
  for (let ci = 0; ci < customers.length; ci++) {
    const name = customers[ci];
    const code = customerCode(ci);
    const r = await c.query(
      `INSERT INTO master.customer (customer_code, customer_name) VALUES ($1,$2)
       ON CONFLICT (customer_code) DO UPDATE SET customer_name=EXCLUDED.customer_name
       RETURNING customer_id`, [code, name]);
    custId[name] = r.rows[0].customer_id;
  }
  summary.customers = customers.length;

  const grades = [...new Set(data.ppc.map((b) => b.grade_code))].sort();
  for (const g of grades)
    await c.query(`INSERT INTO master.grade (grade_code, description) VALUES ($1,$2)
      ON CONFLICT (grade_code) DO NOTHING`, [g, `Grade ${g}`]);
  summary.grades = grades.length;

  const finishes = [...new Set(data.ppc.map((b) => b.roll_finish).filter(Boolean))];
  for (const f of finishes)
    await c.query(`INSERT INTO master.surface_finish (surface_finish, description) VALUES ($1,$2)
      ON CONFLICT (surface_finish) DO NOTHING`, [f, f]);
  summary.finishes = finishes.length;

  // ===== TIER 1b : stoppage codes (small master, mapped to DPR categories) =====
  const STOPPAGE_CODES = [
    ['SD-SET', 'Setting / Setup Change', 'OPERATIONAL', 'OPERATIONAL', 'OP'],
    ['SD-WRC', 'Work Roll Change', 'OPERATIONAL', 'OPERATIONAL', 'OP'],
    ['SD-RMS', 'Raw Material Shortage', 'MATERIAL', 'RM_SHORTAGE', 'OP'],
    ['SD-MECH', 'Mechanical Breakdown', 'MECHANICAL', 'MECHANICAL', 'MECH'],
    ['SD-EL', 'Electrical Fault', 'ELECTRICAL', 'ELECTRICAL', 'EL'],
    ['SD-PWR', 'Power Failure', 'POWER', 'POWER_FAILURE', 'EL'],
    ['SD-OPN', 'Operational Delay', 'OPERATIONAL', 'OPERATIONAL', 'OP'],
    ['SD-PM', 'Preventive Maintenance', 'PLANNED', 'PREVENTIVE_MAINTENANCE', 'MECH'],
  ];
  for (const [code, desc, cat, dpr, ag] of STOPPAGE_CODES)
    await c.query(
      `INSERT INTO master.stoppage_code (stoppage_code,description,category,dpr_category,agency_code,is_planned)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (stoppage_code) DO NOTHING`,
      [code, desc, cat, dpr, ag, code === 'SD-PM']);
  function reasonToCode(reason, agency) {
    const r = (reason || '').toUpperCase();
    if (/W\/?R|ROLL CHANG/.test(r)) return 'SD-WRC';
    if (/SETTING|SET /.test(r)) return 'SD-SET';
    if (/RMS|MATERIAL|R\/M/.test(r)) return 'SD-RMS';
    if (/POWER|P\/F/.test(r)) return 'SD-PWR';
    if (agency === 'MECH') return 'SD-MECH';
    if (agency === 'EL') return 'SD-EL';
    return 'SD-OPN';
  }

  // ===== TIER 1c : synthetic operators (clearly marked) =====
  const operatorIds = [];
  for (let i = 0; i < OP_NAMES.length; i++) {
    const emp = 'SIM9' + String(i + 1).padStart(3, '0');
    const r = await c.query(
      `INSERT INTO master.operator (emp_code, full_name) VALUES ($1,$2)
       ON CONFLICT (emp_code) DO UPDATE SET full_name=EXCLUDED.full_name
       RETURNING operator_id`, [emp, `${OP_NAMES[i]} (SIM)`]);
    operatorIds.push(r.rows[0].operator_id);
  }
  summary.operators = operatorIds.length;

  // ===== TIER 2 : import batches + coils + ppc_batch (REAL) =====
  const importBatchId = {};
  for (const file of [...new Set(data.ppc.map((b) => b.source_file))]) {
    const ex = await c.query(
      `SELECT import_batch_id FROM planning.import_batch WHERE file_name=$1 ORDER BY import_batch_id DESC LIMIT 1`,
      [file]);
    const rows = data.ppc.filter((b) => b.source_file === file).length;
    if (ex.rows.length) {
      importBatchId[file] = ex.rows[0].import_batch_id;
      await c.query(`UPDATE planning.import_batch SET row_count=$1,status='LOADED',error_count=0
        WHERE import_batch_id=$2`, [rows, importBatchId[file]]);
    } else {
      importBatchId[file] = (await c.query(
        `INSERT INTO planning.import_batch (source,file_name,row_count,status,imported_by,error_count)
         VALUES ('XLSX',$1,$2,'LOADED',$3,0) RETURNING import_batch_id`,
        [file, rows, userId.admin])).rows[0].import_batch_id;
    }
  }
  summary.import_batches = Object.keys(importBatchId).length;

  for (const co of data.coils) {
    await c.query(
      `INSERT INTO coil.coil (coil_no, customer_id, grade_code, nominal_width_mm, coil_thk_mm, weight_mt, status)
       VALUES ($1,$2,$3,$4,$5,$6,'PLANNED')
       ON CONFLICT (coil_no) DO UPDATE SET grade_code=EXCLUDED.grade_code,
         nominal_width_mm=EXCLUDED.nominal_width_mm, coil_thk_mm=EXCLUDED.coil_thk_mm,
         weight_mt=EXCLUDED.weight_mt`,
      [co.coil_no, custId[co.customer_name] ?? null, co.grade_code,
       co.nominal_width_mm, co.coil_thk_mm, co.weight_mt]);
  }
  summary.coils = data.coils.length;

  // assign each plan day's rows to shifts A/B/C (contiguous thirds) + queue_seq
  const byDate = {};
  for (const b of data.ppc) (byDate[b.plan_date] = byDate[b.plan_date] || []).push(b);
  const seenBatch = new Map();
  const seqCounter = {};
  let ppcCount = 0;
  for (const date of Object.keys(byDate).sort()) {
    const rows = byDate[date];
    const third = Math.ceil(rows.length / 3);
    rows.forEach((b, idx) => {
      b._shift = idx < third ? 'A' : idx < 2 * third ? 'B' : 'C';
      const sk = `${date}|${b._shift}|${b.machine_code}|${b.sub_process}`;
      seqCounter[sk] = (seqCounter[sk] || 0) + 1;
      b._seq = seqCounter[sk];
      // unique batch_number (real numbers repeat across days/shifts)
      let bn = b.batch_number;
      const n = (seenBatch.get(bn) || 0) + 1;
      seenBatch.set(bn, n);
      b._batch_uid = n === 1 ? bn : `${bn}-${n}`.slice(0, 30);
    });
  }
  for (const b of data.ppc) {
    const raw = { ...b, _provenance: 'REAL_PPC_PLAN' };
    await c.query(
      `INSERT INTO planning.ppc_batch
        (batch_number, plan_date, shift_code, machine_code, sub_process, coil_no, slit_id,
         customer_name, grade_code, width_mm, input_thk_mm, ppc_thk_mm, finish_thk_mm,
         ppc_weight_mt, roll_finish, queue_seq, sap_order_no, item_no, process_route_raw,
         from_work_center, to_work_center, import_batch_id, machine_allocated, raw_row_json)
       VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,TRUE,$23::jsonb)
       ON CONFLICT (batch_number) DO UPDATE SET
         plan_date=EXCLUDED.plan_date, shift_code=EXCLUDED.shift_code,
         queue_seq=EXCLUDED.queue_seq, ppc_weight_mt=EXCLUDED.ppc_weight_mt,
         import_batch_id=EXCLUDED.import_batch_id, raw_row_json=EXCLUDED.raw_row_json`,
      [b._batch_uid, b.plan_date, b._shift, b.machine_code, b.sub_process, b.coil_no, b.slit_id,
       b.customer_name, b.grade_code, b.width_mm, b.input_thk_mm, b.ppc_thk_mm, b.finish_thk_mm,
       b.ppc_weight_mt, b.roll_finish, b._seq, b.sap_order_no, b.item_no, b.process_route_raw,
       b.from_work_center, b.to_work_center, importBatchId[b.source_file], JSON.stringify(raw)]);
    ppcCount++;
  }
  summary.ppc_batches = ppcCount;

  // ===== TIER 3 : 6HI/CRM execution (real batch refs, synthetic timing) =====
  // idempotency: clear prior synthetic crew rows (no natural unique key on crew_entry)
  await c.query(`DELETE FROM txn.crew_entry WHERE operator_id IN
     (SELECT operator_id FROM master.operator WHERE emp_code LIKE 'SIM9%')`);
  // process-31 shift log per (date,shift) carrying the SMED queue
  const planDates = Object.keys(byDate).sort();
  let orders = 0, completed = 0, inprog = 0, pending = 0;
  for (const date of planDates) {
    const isLive = date === LIVE_DATE;
    for (const shift of ['A', 'B', 'C']) {
      const batches = byDate[date].filter((b) => b._shift === shift);
      if (!batches.length) continue;
      const target = batches.reduce((s, b) => s + Number(b.ppc_weight_mt), 0);
      const liveC = isLive && shift === 'C';
      const state = liveC ? 'DRAFT' : 'APPROVED';
      const slId = await upsertShiftLog(c, {
        prod_date: date, shift_code: shift, process_id: 31, mill_type: null,
        target_mt: Math.round(target * 10) / 10,
        total_prod_mt: liveC ? null : Math.round(target * between(0.9, 1.02) * 10) / 10,
        state, shift_manager_id: userId.supervisor,
        handover_notes: `${SEED_TAG} synthetic SMED shift summary (${batches.length} coils planned)`,
      });
      // crew (synthetic operators) on the live SMED line
      const crew = [pick(operatorIds), pick(operatorIds)];
      for (let k = 0; k < crew.length; k++)
        await c.query(`INSERT INTO txn.crew_entry (shift_log_id,operator_id,role_code)
          VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [slId, crew[k], k === 0 ? 'OPERATOR' : 'ASST']);

      const shiftStartHr = SHIFT_START[shift];
      let cursorMin = Math.round(between(5, 20));
      batches.forEach((b, i) => { b._ord = i; });
      for (const b of batches) {
        // status logic: past → COMPLETED; live C shift → a few done, 1 in-progress, rest pending
        let status = 'COMPLETED';
        if (liveC) status = b._ord < 3 ? 'COMPLETED' : b._ord === 3 ? 'IN_PROGRESS' : 'PENDING';
        const dur = Math.round(between(22, 52));
        let startAt = null, endAt = null, durMin = null;
        if (status === 'COMPLETED' || status === 'IN_PROGRESS') {
          startAt = tsAt(date, shiftStartHr, cursorMin);
          if (status === 'COMPLETED') { endAt = tsAt(date, shiftStartHr, cursorMin + dur); durMin = dur; }
          cursorMin += dur + Math.round(between(3, 9));
        }
        const oRes = await c.query(
          `INSERT INTO txn.crm6_order
             (shift_log_id, batch_id, batch_number, coil_no, slit_id, customer_name, grade_code,
              width_mm, input_thk_mm, ppc_thk_mm, ppc_weight_mt, sub_process, status,
              prod_start_at, prod_end_at, prod_duration_min, logged_in_user_id, production_day,
              shift_code, prod_date)
           SELECT $2, pb.batch_id, pb.batch_number, pb.coil_no, pb.slit_id, pb.customer_name,
              pb.grade_code, pb.width_mm, pb.input_thk_mm, pb.ppc_thk_mm, pb.ppc_weight_mt,
              pb.sub_process, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8::date, $9, $8::date
           FROM planning.ppc_batch pb WHERE pb.batch_number = $1
           ON CONFLICT (batch_id) DO UPDATE SET status=EXCLUDED.status,
              shift_log_id=EXCLUDED.shift_log_id, prod_start_at=EXCLUDED.prod_start_at,
              prod_end_at=EXCLUDED.prod_end_at, prod_duration_min=EXCLUDED.prod_duration_min,
              updated_at=now()
           RETURNING order_id, sub_process, ppc_weight_mt, ppc_thk_mm, input_thk_mm`,
          [b._batch_uid, slId, status, startAt, endAt, durMin, userId.operator, date, shift]);
        await attachChild(c, oRes.rows[0], status === 'PENDING');
        orders++;
        if (status === 'COMPLETED') completed++;
        else if (status === 'IN_PROGRESS') inprog++;
        else pending++;
      }
    }
  }
  summary.crm6_orders = orders;
  summary.crm6_completed = completed;
  summary.crm6_in_progress = inprog;
  summary.crm6_pending = pending;

  // ===== TIER 4 : machine_state_events (synthetic, tagged) =====
  // idempotency: clear prior seed events (table has no natural unique key)
  await c.query(`DELETE FROM txn.machine_state_event WHERE reason LIKE '${SEED_TAG}%'`);
  const STATES = ['RUNNING', 'SETUP', 'IDLE', 'RUNNING', 'STOPPAGE', 'RUNNING'];
  let events = 0;
  for (const date of ['2026-06-08', '2026-06-09', '2026-06-10']) {
    for (const machine of ['6HI', '4HI', '2HI']) {
      let cursor = 6 * 60; // minutes from midnight, start of shift A
      for (let i = 0; i < 8; i++) {
        const evt = STATES[i % STATES.length];
        const dur = Math.round(between(20, 75));
        const hr = Math.floor(cursor / 60);
        if (hr >= 24) break;
        const occurredAt = tsAt(date, 0, cursor);
        const endedAt = tsAt(date, 0, cursor + dur);
        await c.query(
          `INSERT INTO txn.machine_state_event
             (machine_code, event_type, occurred_at, ended_at, duration_min, operator_id, shift_code, reason)
           VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6,$7,$8)`,
          [machine, evt, occurredAt, endedAt, dur, pick(operatorIds),
           hr < 14 ? 'A' : hr < 22 ? 'B' : 'C',
           `${SEED_TAG} ${evt === 'SETUP' ? 'changeover / roll change' : evt === 'STOPPAGE' ? 'minor stoppage' : evt.toLowerCase()} on ${machine}`]);
        cursor += dur;
        events++;
      }
    }
  }
  summary.machine_state_events = events;

  // ===== TIER 5 : 8-stage production shift logs from DPR (REAL tonnage) =====
  // aggregate DPR daily areas into (date, process_id, mill_type) buckets
  const PROC_ID = { HRS: 1, PKL: 2, '6HI': 31, ANN: 4, SKP: 5, RWD: 6, CRS: 7, CTL: 8 };
  const MILL_OF = (area) => area.startsWith('4HI') ? '4HI' : area.startsWith('6HI') ? '6HI'
    : area.startsWith('2HI') ? '2HI' : null;
  const bucket = {}; // key date|proc|mill -> {a,b,c,tgt}
  for (const d of data.dpr_daily) {
    const proc = PROC_ID[d.process_code];
    if (!proc) continue;
    const mill = proc === 31 ? MILL_OF(d.area_code) : null;
    const key = `${d.date}|${proc}|${mill ?? ''}`;
    const o = bucket[key] || (bucket[key] = { date: d.date, proc, mill, a: 0, b: 0, c: 0, tgt: 0 });
    o.a += d.a_mt; o.b += d.b_mt; o.c += d.c_mt; o.tgt += (d.target_mt || 0);
  }
  let dprLogs = 0;
  const dprLogIds = {}; // (date|proc|mill|shift) -> shift_log_id  (for stoppage attach)
  for (const k of Object.keys(bucket)) {
    const o = bucket[k];
    for (const shift of ['A', 'B', 'C']) {
      const prod = shift === 'A' ? o.a : shift === 'B' ? o.b : o.c;
      if (!(prod > 0)) continue;
      const id = await upsertShiftLog(c, {
        prod_date: o.date, shift_code: shift, process_id: o.proc, mill_type: o.mill,
        target_mt: o.tgt ? Math.round((o.tgt / 3) * 10) / 10 : null,
        total_prod_mt: Math.round(prod * 100) / 100, state: 'APPROVED',
        shift_manager_id: userId.supervisor,
      });
      dprLogIds[`${o.date}|${o.proc}|${o.mill ?? ''}|${shift}`] = id;
      dprLogs++;
    }
  }
  summary.dpr_shift_logs = dprLogs;

  // ===== TIER 6 : stoppage_entry from DPR delays (REAL reasons) =====
  // idempotency: clear prior seed stoppages (all use SD-* codes)
  await c.query(`DELETE FROM txn.stoppage_entry WHERE stoppage_code LIKE 'SD-%'`);
  const PROCID_BY_CODE = PROC_ID;
  let stoppages = 0;
  for (const d of data.dpr_delay) {
    const proc = PROCID_BY_CODE[d.process_code];
    if (!proc) continue;
    const mill = proc === 31 ? MILL_OF(d.area_code) : null;
    let slId = dprLogIds[`${d.date}|${proc}|${mill ?? ''}|${d.shift_code}`];
    if (!slId) {
      // delay on a line/shift with no logged tonnage → create a zero-prod APPROVED log
      slId = await upsertShiftLog(c, {
        prod_date: d.date, shift_code: d.shift_code, process_id: proc, mill_type: mill,
        total_prod_mt: 0, state: 'APPROVED', shift_manager_id: userId.supervisor });
      dprLogIds[`${d.date}|${proc}|${mill ?? ''}|${d.shift_code}`] = slId;
    }
    const startHr = SHIFT_START[d.shift_code];
    const offset = Math.round(between(30, 180));
    const code = reasonToCode(d.reason, d.agency_code);
    const hhmm = (mins) => {
      const m = Math.min(mins, 23 * 60 + 59);
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
    };
    const fromMin = startHr * 60 + offset;
    const timeFrom = hhmm(fromMin);
    const timeTo = hhmm(fromMin + d.duration_min);
    await c.query(
      `INSERT INTO txn.stoppage_entry (shift_log_id, stoppage_code, time_from, time_to, duration_min, remarks, shift_code, prod_date)
       VALUES ($1,$2,$3::time,$4::time,$5,$6,$7,$8::date)`,
      [slId, code, timeFrom, timeTo, d.duration_min, d.reason, d.shift_code, d.date]);
    stoppages++;
  }
  summary.stoppage_entries = stoppages;

  return summary;
}

// rolling/skinpass child rows for an order
async function attachChild(c, row, pendingOnly = false) {
  if (row.sub_process === 'SKIN_PASS') {
    await c.query(
      `INSERT INTO txn.crm6_skinpass (order_id, output_thk_mm, actual_weight_mt)
       VALUES ($1,$2,$3) ON CONFLICT (order_id) DO UPDATE SET
         output_thk_mm=EXCLUDED.output_thk_mm, actual_weight_mt=EXCLUDED.actual_weight_mt`,
      [row.order_id, row.ppc_thk_mm, pendingOnly ? null : Number(row.ppc_weight_mt)]);
  } else {
    const passes = 2 + Math.floor(rng() * 2); // 2-3 passes
    await c.query(
      `INSERT INTO txn.crm6_rolling (order_id, total_passes, final_thk_mm, actual_weight_mt)
       VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO UPDATE SET
         total_passes=EXCLUDED.total_passes, final_thk_mm=EXCLUDED.final_thk_mm,
         actual_weight_mt=EXCLUDED.actual_weight_mt`,
      [row.order_id, passes, row.ppc_thk_mm, pendingOnly ? null : Number(row.ppc_weight_mt)]);
    if (!pendingOnly) {
      await c.query(`DELETE FROM txn.crm6_rolling_pass WHERE order_id=$1`, [row.order_id]);
      const inThk = Number(row.input_thk_mm), outThk = Number(row.ppc_thk_mm);
      for (let p = 1; p <= passes; p++) {
        const thk = Math.round((inThk - ((inThk - outThk) * p) / passes) * 1000) / 1000;
        await c.query(`INSERT INTO txn.crm6_rolling_pass (order_id, pass_no, thickness_mm)
          VALUES ($1,$2,$3)`, [row.order_id, p, thk]);
      }
    }
  }
}

// PIN hash matching pinService.ts (scrypt$salt$hash)
async function makePinHash(pin) {
  const { scryptSync, randomBytes } = await import('node:crypto');
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function seedDemoStandalone(databaseUrl = DEFAULT_URL, dataPath) {
  const file = dataPath || path.join(__dirname, 'extracted_data.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  try {
    await client.query('BEGIN');
    const s = await seedDemo(client, data);
    await client.query('COMMIT');
    return s;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const url = process.argv[2] || DEFAULT_URL;
  const dataPath = process.argv[3];
  console.log(`Seeding Zedral demo data → ${url.replace(/:[^:@]+@/, ':***@')}`);
  seedDemoStandalone(url, dataPath)
    .then((s) => { console.log('Seed complete:'); console.log(JSON.stringify(s, null, 2)); })
    .catch((e) => { console.error(e); process.exit(1); });
}
