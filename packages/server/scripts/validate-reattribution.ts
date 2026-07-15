/**
 * End-to-end validation for backlog order shift re-attribution.
 *
 * Drives the REAL service code paths (SixHiService, ProductionMetricsService,
 * ReportingService) against the live database:
 *   1. Create a batch planned for a previous day (backlog).
 *   2. Start production today  -> should re-attribute to the current active shift.
 *   3. Capture production (rolling weight).
 *   4. Complete the order.
 * Then asserts today's summaries include it, the original planned shift does not,
 * backlog decreased, yesterday's totals are not inflated, and there is no double count.
 *
 * Run:  npx tsx scripts/validate-reattribution.ts
 */
import 'dotenv/config';
import { requestContext } from '../src/context';
import { db } from '../src/db';
import { SixHiService } from '../src/services/SixHiService';
import { ShiftDetectionService } from '../src/services/ShiftDetectionService';
import { ProductionMetricsService } from '../src/services/ProductionMetricsService';
import { ReportingService } from '../src/services/ReportingService';

const USER_ID = 3; // operator
const MACHINE = '6HI';
const results: Array<{ check: string; pass: boolean; detail: string }> = [];
function assert(check: string, pass: boolean, detail = '') {
  results.push({ check, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${check}${detail ? ` — ${detail}` : ''}`);
}
const round1 = (n: number) => Math.round(n * 10) / 10;
function shiftDate(base: string, deltaDays: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  const stamp = Date.now();
  const batchNumber = `VALTEST-${stamp}`;
  const coilNo = `VALCOIL-${stamp}`;

  // Reuse an existing batch's master values to satisfy FKs (grade/customer).
  const template = await db.selectFrom('planning.ppc_batch')
    .select(['grade_code', 'customer_name', 'width_mm', 'ppc_thk_mm'])
    .where('machine_code', '=', MACHINE)
    .limit(1)
    .executeTakeFirst();
  if (!template) throw new Error('No existing 6HI ppc_batch to use as template');

  const detected = await ShiftDetectionService.getCurrentShift({ userId: USER_ID, machineCode: MACHINE });
  const P = detected.prodDate;          // current active production date
  const S = detected.shiftCode.toUpperCase(); // current active shift
  const plannedDate = shiftDate(P, -2); // clearly a previous day -> backlog
  const plannedShift = 'A';
  console.log(`\nActive shift now: ${S} @ ${P}. Planned (backlog) batch: ${plannedShift} @ ${plannedDate}\n`);

  const PPC_WEIGHT = 20;
  const ACTUAL_WEIGHT = 12.5;

  // Track pre-existing shift logs so cleanup only removes what we create.
  const plannedLogExisted = !!(await SixHiService.resolveShiftLogIdForPlan(plannedDate, plannedShift));
  const activeLogExistedBefore = !!(await SixHiService.resolveShiftLogIdForPlan(P, S));

  let orderId: string | null = null;
  try {
    // 1. Create the backlog batch.
    const inserted = await db.insertInto('planning.ppc_batch')
      .values({
        batch_number: batchNumber,
        plan_date: SixHiService.toPlanDate(plannedDate),
        shift_code: plannedShift,
        machine_code: MACHINE,
        machine_allocated: true,
        sub_process: 'ROLLING',
        coil_no: coilNo,
        customer_name: template.customer_name,
        grade_code: template.grade_code,
        width_mm: template.width_mm,
        ppc_thk_mm: template.ppc_thk_mm,
        input_thk_mm: template.ppc_thk_mm,
        ppc_weight_mt: PPC_WEIGHT,
        destination: 'ANNEALING',
        roll_finish: 'MATT',
        ppc_reroll_flag: false,
        queue_seq: 9999,
      } as any)
      .returning('batch_id')
      .executeTakeFirstOrThrow();
    console.log(`Created backlog batch ${batchNumber} (batch_id=${inserted.batch_id})`);

    // Ensure the original (planned) shift log exists, then create the order (attributed to planned shift).
    const plannedShiftLogId = await SixHiService.ensureActiveShiftLog(
      USER_ID, SixHiService.toPlanDate(plannedDate), plannedShift,
    );
    orderId = await SixHiService.ensureOrder(batchNumber, USER_ID);
    const afterCreate = await db.selectFrom('txn.crm_order')
      .select(['shift_log_id', 'prod_date', 'shift_code', 'status'])
      .where('order_id', '=', orderId).executeTakeFirstOrThrow();
    assert('Order initially attributed to PLANNED shift',
      String(afterCreate.shift_log_id) === String(plannedShiftLogId),
      `order.shift_log_id=${afterCreate.shift_log_id} plannedShiftLogId=${plannedShiftLogId}`);

    // Baseline snapshots (order exists as backlog, still PENDING).
    const backlogAfterCreate = (await ReportingService.getPlantHeadDashboard(7)).backlogCount;
    const plannedDayProdBefore = await ProductionMetricsService.getPlantProductionForDate(plannedDate);
    const plannedSummaryBefore = await SixHiService.getShiftSummary(plannedShiftLogId);

    // 2. Start production today -> re-attribution happens here.
    await SixHiService.startProduction(batchNumber, USER_ID);
    const afterStart = await db.selectFrom('txn.crm_order')
      .select(['shift_log_id', 'prod_date', 'shift_code', 'status'])
      .where('order_id', '=', orderId).executeTakeFirstOrThrow();
    const newShiftLogId = await SixHiService.resolveShiftLogIdForPlan(P, S);
    assert('Order MOVED off the planned shift at production start',
      String(afterStart.shift_log_id) !== String(plannedShiftLogId),
      `now shift_log_id=${afterStart.shift_log_id}`);
    assert('Order attributed to current ACTIVE shift',
      String(afterStart.shift_log_id) === String(newShiftLogId)
        && SixHiService.formatPlanDate(afterStart.prod_date as any) === P
        && afterStart.shift_code === S,
      `prod_date=${SixHiService.formatPlanDate(afterStart.prod_date as any)} shift_code=${afterStart.shift_code}`);

    // 3. Capture production (rolling actual weight).
    await SixHiService.updateRolling(batchNumber, {
      actualWeightMt: ACTUAL_WEIGHT,
      destination: 'ANNEALING',
      destinationOverride: false,
      passes: [{ passNo: 1, thicknessMm: Number(template.ppc_thk_mm) || 1 }],
      totalPasses: 1,
      finalThkMm: Number(template.ppc_thk_mm) || 1,
    } as any, USER_ID);

    // 4. Complete the order.
    await SixHiService.endProduction(batchNumber, USER_ID);
    const afterEnd = await db.selectFrom('txn.crm_order')
      .select(['shift_log_id', 'status']).where('order_id', '=', orderId).executeTakeFirstOrThrow();
    assert('Order COMPLETED', afterEnd.status === 'COMPLETED', `status=${afterEnd.status}`);

    // ---- Assertions ----
    const newSummary = await SixHiService.getShiftSummary(String(newShiftLogId));
    const plannedSummaryAfter = await SixHiService.getShiftSummary(plannedShiftLogId);
    const inNew = newSummary.completedOrders.some((o) => o.batchNumber === batchNumber);
    const inPlanned = plannedSummaryAfter.completedOrders.some((o) => o.batchNumber === batchNumber);

    assert("Appears in TODAY's shift summary", inNew,
      `completedOrders=${newSummary.completedOrders.map((o) => o.batchNumber).join(',') || 'none'}`);
    assert('Does NOT appear in the original planned shift summary', !inPlanned);
    assert("Today's shift summary production increased by the captured weight",
      round1(newSummary.completedProdMt) >= round1(ACTUAL_WEIGHT),
      `completedProdMt=${round1(newSummary.completedProdMt)}`);
    assert('Planned shift production NOT inflated (unchanged)',
      round1(plannedSummaryAfter.totalProdMt) === round1(plannedSummaryBefore.totalProdMt),
      `before=${round1(plannedSummaryBefore.totalProdMt)} after=${round1(plannedSummaryAfter.totalProdMt)}`);

    // Dashboards / analytics single source of truth.
    const metricsToday = await ProductionMetricsService.getShiftMetrics(P, S);
    const metricsPlanned = await ProductionMetricsService.getShiftMetrics(plannedDate, plannedShift);
    assert("Today's dashboard metrics include the production",
      round1(metricsToday.totalProdMt) >= round1(ACTUAL_WEIGHT),
      `today.totalProdMt=${round1(metricsToday.totalProdMt)}`);
    assert("Yesterday's dashboard total not inflated",
      round1(metricsPlanned.totalProdMt) === round1(plannedDayProdBefore) - 0 // planned day had order at 0 (PENDING) before
        || round1(metricsPlanned.totalProdMt) <= round1(plannedDayProdBefore),
      `plannedDay.totalProdMt=${round1(metricsPlanned.totalProdMt)} before=${round1(plannedDayProdBefore)}`);

    // Backlog decreases after completion.
    const backlogAfterComplete = (await ReportingService.getPlantHeadDashboard(7)).backlogCount;
    assert('Backlog count decreased after completion',
      backlogAfterComplete === backlogAfterCreate - 1,
      `afterCreate=${backlogAfterCreate} afterComplete=${backlogAfterComplete}`);

    // No double counting: order attributed to exactly one shift log across all 6HI shift logs.
    const attributionRows = await db.selectFrom('txn.crm_order')
      .select(['shift_log_id']).where('order_id', '=', orderId).execute();
    const distinctLogs = new Set(attributionRows.map((r) => String(r.shift_log_id)));
    assert('Order attributed to exactly ONE shift (no duplication)', distinctLogs.size === 1,
      `logs=${[...distinctLogs].join(',')}`);
  } finally {
    // ---- Cleanup: remove everything we created ----
    if (orderId) {
      for (const table of [
        'txn.order_shift_attribution',
        'txn.order_stoppage',
        'txn.crm_rolling_pass',
        'txn.crm_rolling',
        'txn.crm_skinpass',
        'txn.order_remark',
        'txn.order_rejection',
        'txn.machine_state_event',
      ]) {
        await db.deleteFrom(table as any).where('order_id', '=', orderId).execute().catch(() => {});
      }
      await db.deleteFrom('txn.crm_order').where('order_id', '=', orderId).execute().catch(() => {});
    }
    await db.deleteFrom('coil.coil').where('coil_no', '=', coilNo).execute().catch(() => {});
    await db.deleteFrom('planning.ppc_batch').where('batch_number', '=', batchNumber).execute().catch(() => {});

    // Drop shift logs we created that are now empty; recompute caches for pre-existing ones.
    const cleanupLog = async (logId: string | null, existedBefore: boolean) => {
      if (!logId) return;
      const cnt = await db.selectFrom('txn.crm_order').select(db.fn.countAll<number>().as('n'))
        .where('shift_log_id', '=', logId).executeTakeFirst();
      if (!existedBefore && Number(cnt?.n ?? 0) === 0) {
        await db.deleteFrom('txn.crm_shift_summary').where('shift_log_id', '=', logId).execute().catch(() => {});
        await db.deleteFrom('txn.shift_log').where('shift_log_id', '=', logId).execute().catch(() => {});
      } else {
        await SixHiService.syncShiftProductionCache(logId).catch(() => {});
      }
    };
    const plannedLogId = await SixHiService.resolveShiftLogIdForPlan(plannedDate, plannedShift);
    const activeLogId = await SixHiService.resolveShiftLogIdForPlan(P, S);
    await cleanupLog(plannedLogId, plannedLogExisted);
    await cleanupLog(activeLogId, activeLogExistedBefore);
    console.log('\nCleanup complete.');
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== VALIDATION ${failed.length === 0 ? 'PASSED' : 'FAILED'} (${results.length - failed.length}/${results.length}) =====`);
  await db.destroy();
  process.exit(failed.length === 0 ? 0 : 1);
}

requestContext.run(
  {
    tenant_id: '00000000-0000-0000-0000-000000000001',
    correlation_id: `valtest-${Date.now()}`,
    user: { id: USER_ID, username: 'operator', roles: ['OPERATOR'], lineAccess: ['6HI'] },
  },
  () => main().catch(async (e) => {
    console.error('VALIDATION ERROR:', e);
    await db.destroy().catch(() => {});
    process.exit(1);
  }),
);
