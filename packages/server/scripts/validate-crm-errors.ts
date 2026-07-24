/**
 * Negative-path / data-validation & error-handling checks for the shared CRM
 * capture code (applies identically to 4HI and 6HI). Drives the real service
 * validators and asserts they reject invalid input. Self-cleaning.
 *
 * Run:  npx tsx scripts/validate-crm-errors.ts           (default 6HI)
 *       $env:MACHINE='4HI'; npx tsx scripts/validate-crm-errors.ts
 */
import 'dotenv/config';
import { requestContext } from '../src/context';
import { db } from '../src/db';
import { SixHiService } from '../src/services/SixHiService';
import { currentPlantDate } from '../src/utils/dateOnly';

const USER_ID = 3;
const MACHINE = (process.env.MACHINE ?? '6HI').toUpperCase();
const results: Array<{ check: string; pass: boolean; detail: string }> = [];
function ok(check: string, pass: boolean, detail = '') {
  results.push({ check, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${check}${detail ? ` — ${detail}` : ''}`);
}
async function expectThrow(check: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    ok(check, false, 'expected an error but none was thrown');
  } catch (e) {
    ok(check, true, `rejected: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
  }
}

async function main() {
  const stamp = Date.now();
  const batchNumber = `ERRTEST-${stamp}`;
  const coilNo = `ERRCOIL-${stamp}`;
  const PPC_WEIGHT = 15;

  const template = await db.selectFrom('planning.ppc_batch')
    .select(['grade_code', 'customer_name', 'width_mm', 'ppc_thk_mm'])
    .where('machine_code', '=', MACHINE).limit(1).executeTakeFirst()
    ?? await db.selectFrom('planning.ppc_batch')
      .select(['grade_code', 'customer_name', 'width_mm', 'ppc_thk_mm']).limit(1).executeTakeFirst();
  if (!template) throw new Error('No ppc_batch template');

  const thk = Number(template.ppc_thk_mm) || 1;
  let orderId: string | null = null;
  const createdLogs: string[] = [];
  try {
    await db.insertInto('planning.ppc_batch').values({
      batch_number: batchNumber, plan_date: SixHiService.toPlanDate(currentPlantDate()),
      shift_code: 'A', machine_code: MACHINE, machine_allocated: true, sub_process: 'ROLLING',
      coil_no: coilNo, customer_name: template.customer_name, grade_code: template.grade_code,
      width_mm: template.width_mm, ppc_thk_mm: template.ppc_thk_mm, input_thk_mm: template.ppc_thk_mm,
      ppc_weight_mt: PPC_WEIGHT, destination: 'ANNEALING', roll_finish: 'MATT', ppc_reroll_flag: false, queue_seq: 9999,
    } as any).execute();
    orderId = await SixHiService.ensureOrder(batchNumber, USER_ID);

    // Stoppage before production has started must be rejected.
    await expectThrow('Stoppage rejected when order is not running (PENDING)',
      () => SixHiService.addStoppage(batchNumber, '12', undefined, 'x', USER_ID));

    await SixHiService.startProduction(batchNumber, USER_ID);
    const sl = await db.selectFrom('txn.crm_order').select('shift_log_id')
      .where('order_id', '=', orderId).executeTakeFirstOrThrow();
    if (sl.shift_log_id) createdLogs.push(String(sl.shift_log_id));

    // Over-weight rolling capture must be rejected (actual > planned PPC weight).
    await expectThrow('Rolling capture rejected when actual weight exceeds PPC weight',
      () => SixHiService.updateRolling(batchNumber, {
        actualWeightMt: PPC_WEIGHT + 100, destination: 'ANNEALING', destinationOverride: false,
        passes: [{ passNo: 1, thicknessMm: thk }], totalPasses: 1, finalThkMm: thk,
      } as any, USER_ID));

    // A valid capture within the PPC weight is accepted.
    await SixHiService.updateRolling(batchNumber, {
      actualWeightMt: PPC_WEIGHT - 5, destination: 'ANNEALING', destinationOverride: false,
      passes: [{ passNo: 1, thicknessMm: thk }], totalPasses: 1, finalThkMm: thk,
    } as any, USER_ID);
    ok('Valid rolling capture (<= PPC weight) accepted', true, `${PPC_WEIGHT - 5} MT`);

    // Open a stoppage, then a second concurrent open stoppage must be rejected.
    await SixHiService.addStoppage(batchNumber, '12', undefined, 'first', USER_ID);
    await expectThrow('Second concurrent open stoppage rejected',
      () => SixHiService.addStoppage(batchNumber, '12', undefined, 'second', USER_ID));

    const openStop = await db.selectFrom('txn.order_stoppage').select('stoppage_id')
      .where('order_id', '=', orderId).orderBy('stoppage_id', 'desc').executeTakeFirstOrThrow();
    await SixHiService.endStoppage(batchNumber, String(openStop.stoppage_id), USER_ID);
    await SixHiService.endProduction(batchNumber, USER_ID);

    // After completion, a new stoppage must be rejected.
    await expectThrow('Stoppage rejected after order completion',
      () => SixHiService.addStoppage(batchNumber, '12', undefined, 'late', USER_ID));
  } finally {
    if (orderId) {
      for (const t of ['txn.order_shift_attribution', 'txn.order_stoppage', 'txn.crm_rolling_pass',
        'txn.crm_rolling', 'txn.crm_skinpass', 'txn.order_remark', 'txn.order_rejection', 'txn.machine_state_event']) {
        await db.deleteFrom(t as any).where('order_id', '=', orderId).execute().catch(() => {});
      }
      await db.deleteFrom('txn.crm_order').where('order_id', '=', orderId).execute().catch(() => {});
    }
    await db.deleteFrom('coil.coil').where('coil_no', '=', coilNo).execute().catch(() => {});
    await db.deleteFrom('planning.ppc_batch').where('batch_number', '=', batchNumber).execute().catch(() => {});
    for (const logId of createdLogs) {
      const cnt = await db.selectFrom('txn.crm_order').select(db.fn.countAll<number>().as('n'))
        .where('shift_log_id', '=', logId).executeTakeFirst();
      if (Number(cnt?.n ?? 0) === 0) {
        await db.deleteFrom('txn.crm_shift_summary').where('shift_log_id', '=', logId).execute().catch(() => {});
        await db.deleteFrom('txn.shift_log').where('shift_log_id', '=', logId).execute().catch(() => {});
      } else {
        await SixHiService.syncShiftProductionCache(logId).catch(() => {});
      }
    }
    console.log('\nCleanup complete.');
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== CRM ERROR-HANDLING (${MACHINE}) ${failed.length === 0 ? 'PASSED' : 'FAILED'} (${results.length - failed.length}/${results.length}) =====`);
  await db.destroy();
  process.exit(failed.length === 0 ? 0 : 1);
}

requestContext.run(
  {
    tenant_id: '00000000-0000-0000-0000-000000000001',
    correlation_id: `errtest-${Date.now()}`,
    user: { id: USER_ID, username: 'operator', roles: ['OPERATOR'], lineAccess: ['6HI'] },
  },
  () => main().catch(async (e) => { console.error('ERROR:', e); await db.destroy().catch(() => {}); process.exit(1); }),
);
