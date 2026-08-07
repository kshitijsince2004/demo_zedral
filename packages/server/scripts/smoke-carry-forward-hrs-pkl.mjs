#!/usr/bin/env node
/**
 * Smoke: reparentOpenWork moves open HRS/PKL rows across shift logs without
 * hitting missing *_entry tables.
 *
 * Usage: node --env-file=../../.env scripts/smoke-carry-forward-hrs-pkl.mjs
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { reparentOpenWork } from '../dist/services/handover/carryForward.js';

const databaseUrl =
  process.env.DATABASE_URL || 'postgres://m1_user:m1_password@localhost:5432/m1_db';
const tenantId = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000001';
const tag = `SMOKE-CF-${Date.now()}`;

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = new Kysely({ dialect: new PostgresDialect({ pool }) });

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exitCode = 1;
}

async function ensureShiftLog(processId, shiftCode, prodDate) {
  const existing = await db
    .selectFrom('txn.shift_log')
    .select('shift_log_id')
    .where('process_id', '=', processId)
    .where('shift_code', '=', shiftCode)
    .where('prod_date', '=', prodDate)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (existing) return String(existing.shift_log_id);

  const inserted = await db
    .insertInto('txn.shift_log')
    .values({
      process_id: processId,
      shift_code: shiftCode,
      prod_date: prodDate,
      state: 'DRAFT',
      tenant_id: tenantId,
    })
    .returning('shift_log_id')
    .executeTakeFirstOrThrow();
  return String(inserted.shift_log_id);
}

async function main() {
  console.log(`[smoke] DB ${databaseUrl.replace(/:[^:@]+@/, ':***@')} tenant=${tenantId}`);

  await sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`.execute(db);

  const prodDate = '2099-01-01';
  const outHrs = await ensureShiftLog(1, 'A', prodDate);
  const inHrs = await ensureShiftLog(1, 'B', prodDate);
  const outPkl = await ensureShiftLog(2, 'A', prodDate);
  const inPkl = await ensureShiftLog(2, 'B', prodDate);

  const hrsCoil = `${tag}-HRS`;
  const pklCoil = `${tag}-PKL`;

  // Minimal coil rows if FK requires them
  await sql`
    INSERT INTO coil.coil (coil_no, status, tenant_id)
    VALUES (${hrsCoil}, 'IN_PROCESS', ${tenantId}::uuid), (${pklCoil}, 'IN_PROCESS', ${tenantId}::uuid)
    ON CONFLICT (coil_no) DO NOTHING
  `.execute(db);

  const hrs = await db
    .insertInto('txn.prod_hrs')
    .values({
      shift_log_id: outHrs,
      coil_no: hrsCoil,
      status: 'IN_PROGRESS',
      tenant_id: tenantId,
      prod_date: prodDate,
      shift_code: 'A',
    })
    .returning('entry_id')
    .executeTakeFirstOrThrow();

  const pkl = await db
    .insertInto('txn.prod_pkl')
    .values({
      shift_log_id: outPkl,
      coil_no: pklCoil,
      status: 'IN_PROGRESS',
      tenant_id: tenantId,
      prod_date: prodDate,
      shift_code: 'A',
    })
    .returning('entry_id')
    .executeTakeFirstOrThrow();

  console.log(`[seed] HRS entry=${hrs.entry_id} out=${outHrs} → in=${inHrs}`);
  console.log(`[seed] PKL entry=${pkl.entry_id} out=${outPkl} → in=${inPkl}`);

  await db.transaction().execute(async (trx) => {
    await reparentOpenWork(trx, {
      machineCode: 'HRS1',
      processId: 1,
      outgoingShiftLogId: outHrs,
      incomingShiftLogId: inHrs,
      incomingShiftCode: 'B',
      incomingProdDate: prodDate,
    });
    await reparentOpenWork(trx, {
      machineCode: 'PKL1',
      processId: 2,
      outgoingShiftLogId: outPkl,
      incomingShiftLogId: inPkl,
      incomingShiftCode: 'B',
      incomingProdDate: prodDate,
    });
  });

  const hrsAfter = await db
    .selectFrom('txn.prod_hrs')
    .select(['entry_id', 'shift_log_id', 'status'])
    .where('entry_id', '=', hrs.entry_id)
    .executeTakeFirstOrThrow();
  const pklAfter = await db
    .selectFrom('txn.prod_pkl')
    .select(['entry_id', 'shift_log_id', 'status'])
    .where('entry_id', '=', pkl.entry_id)
    .executeTakeFirstOrThrow();

  if (String(hrsAfter.shift_log_id) !== inHrs) {
    fail(`HRS not reparented: got shift_log_id=${hrsAfter.shift_log_id}, want ${inHrs}`);
  } else {
    console.log(`[PASS] HRS reparented to shift_log_id=${hrsAfter.shift_log_id}`);
  }

  if (String(pklAfter.shift_log_id) !== inPkl) {
    fail(`PKL not reparented: got shift_log_id=${pklAfter.shift_log_id}, want ${inPkl}`);
  } else {
    console.log(`[PASS] PKL reparented to shift_log_id=${pklAfter.shift_log_id}`);
  }

  // Cleanup smoke rows
  await db.deleteFrom('txn.prod_hrs').where('entry_id', '=', hrs.entry_id).execute();
  await db.deleteFrom('txn.prod_pkl').where('entry_id', '=', pkl.entry_id).execute();
  await sql`DELETE FROM coil.coil WHERE coil_no IN (${hrsCoil}, ${pklCoil})`.execute(db);
  console.log('[cleanup] smoke HRS/PKL rows removed');
}

main()
  .catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
  })
  .finally(async () => {
    await db.destroy();
  });
