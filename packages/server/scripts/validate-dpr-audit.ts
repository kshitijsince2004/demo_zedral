/**
 * DPR export production-readiness validation against the live database.
 *
 * Drives the REAL DPR read/aggregate/inject code paths through a full 6HI
 * backlog lifecycle:
 *   1. Create a batch planned for a previous day (backlog).
 *   2. Start production today   -> re-attributes to the current active shift.
 *   3. Record an order stoppage in the current shift (with a known duration).
 *   4. Capture rolling production, then complete the order.
 *
 * Then it exercises ExportReadRepository.fetchRuns / fetchStoppages,
 * DprAggregator.aggregate and injectDprTemplate for the current month and asserts:
 *   - today's completed backlog production appears in TODAY's DPR (runs),
 *   - the order stoppage is attributed to the ACTUAL shift (not hardcoded 'A'),
 *   - the stoppage minutes land in the correct shift column of the aggregated block,
 *   - the official template injects to a non-empty workbook (fail-closed happy path).
 *
 * Run:  npx tsx scripts/validate-dpr-audit.ts
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { requestContext } from '../src/context';
import { db } from '../src/db';
import { SixHiService } from '../src/services/SixHiService';
import { ShiftDetectionService } from '../src/services/ShiftDetectionService';
import { ExportReadRepository, scopeFromMonth } from '../src/export/read/ExportReadRepository';
import { DprAggregator } from '../src/export/aggregation/DprAggregator';
import { injectDprTemplate, blankMasterPath } from '../src/export/dpr/DprTemplateInjector';
import { titleRow } from '../src/dpr/geometry/blockGeometry';
import { AREA_TITLE_OFFSET } from '../src/export/dpr/areaGeometry';

const PROD_COL: Record<string, number> = { A: 3, B: 4, C: 5 };
const DATE_COL = 13;
const DAYNUM_COL = 60;
const FORMULA_COLS = [6, 7, 8, 15, 16]; // F total, G cum, H avg, O util tdy, P util cum
function isFormulaCell(cell: ExcelJS.Cell): boolean {
  return cell.type === ExcelJS.ValueType.Formula || !!(cell.value as any)?.formula;
}

const USER_ID = 3;
const MACHINE = (process.env.MACHINE ?? '6HI').toUpperCase();
const results: Array<{ check: string; pass: boolean; detail: string }> = [];
function assert(check: string, pass: boolean, detail = '') {
  results.push({ check, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${check}${detail ? ` — ${detail}` : ''}`);
}
const round1 = (n: number) => Math.round(n * 10) / 10;
function shiftDate(base: string, deltaDays: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const stamp = Date.now();
  const batchNumber = `DPRTEST-${stamp}`;
  const coilNo = `DPRCOIL-${stamp}`;
  const STOPPAGE_MIN = 30;

  const template = await db.selectFrom('planning.ppc_batch')
    .select(['grade_code', 'customer_name', 'width_mm', 'ppc_thk_mm'])
    .where('machine_code', '=', MACHINE).limit(1).executeTakeFirst()
    ?? await db.selectFrom('planning.ppc_batch')
      .select(['grade_code', 'customer_name', 'width_mm', 'ppc_thk_mm'])
      .limit(1).executeTakeFirst();
  if (!template) throw new Error('No existing ppc_batch to use as template');

  // Pick a real stoppage category with a known DPR category so we can assert bucketing.
  const cat = await db.selectFrom('master.stoppage_category')
    .select(['category_code', 'dpr_category', 'label'])
    .where('dpr_category', 'in', ['ELECTRICAL', 'MECHANICAL', 'OPERATIONAL'])
    .orderBy('category_code')
    .limit(1).executeTakeFirst();
  if (!cat) throw new Error('No stoppage category with a DPR category found');
  const dprBucket = String(cat.dpr_category).toLowerCase() as 'electrical' | 'mechanical' | 'operational';

  const detected = await ShiftDetectionService.getCurrentShift({ userId: USER_ID, machineCode: MACHINE });
  const P = detected.prodDate;
  const S = detected.shiftCode.toUpperCase() as 'A' | 'B' | 'C';
  const month = P.slice(0, 7);
  const plannedDate = shiftDate(P, -2);
  console.log(`\nActive shift now: ${S} @ ${P} (month ${month}). Backlog planned: A @ ${plannedDate}. Stoppage cat ${cat.category_code}/${cat.dpr_category} ${STOPPAGE_MIN}min\n`);
  console.log(`[info] active shift=${S}${S === 'A' ? " (fix is a correct no-op this run; run during shift B/C to see the distinction)" : ' (stoppage-shift fix is observable)'}`);

  const plannedLogExisted = !!(await SixHiService.resolveShiftLogIdForPlan(plannedDate, 'A'));
  const activeLogExistedBefore = !!(await SixHiService.resolveShiftLogIdForPlan(P, S));

  let orderId: string | null = null;
  try {
    await db.insertInto('planning.ppc_batch').values({
      batch_number: batchNumber,
      plan_date: SixHiService.toPlanDate(plannedDate),
      shift_code: 'A',
      machine_code: MACHINE,
      machine_allocated: true,
      sub_process: 'ROLLING',
      coil_no: coilNo,
      customer_name: template.customer_name,
      grade_code: template.grade_code,
      width_mm: template.width_mm,
      ppc_thk_mm: template.ppc_thk_mm,
      input_thk_mm: template.ppc_thk_mm,
      ppc_weight_mt: 20,
      destination: 'ANNEALING',
      roll_finish: 'MATT',
      ppc_reroll_flag: false,
      queue_seq: 9999,
    } as any).execute();

    await SixHiService.ensureActiveShiftLog(USER_ID, SixHiService.toPlanDate(plannedDate), 'A');
    orderId = await SixHiService.ensureOrder(batchNumber, USER_ID);

    // 2. Start production today -> re-attributes to the active shift (P, S).
    await SixHiService.startProduction(batchNumber, USER_ID);

    // 3. Record + end an order stoppage; force a deterministic duration.
    await SixHiService.addStoppage(batchNumber, String(cat.category_code), undefined, 'dpr-audit', USER_ID);
    const openStop = await db.selectFrom('txn.order_stoppage')
      .select(['stoppage_id']).where('order_id', '=', orderId)
      .orderBy('stoppage_id', 'desc').executeTakeFirstOrThrow();
    await SixHiService.endStoppage(batchNumber, String(openStop.stoppage_id), USER_ID);
    await db.updateTable('txn.order_stoppage')
      .set({ duration_min: STOPPAGE_MIN } as any)
      .where('stoppage_id', '=', openStop.stoppage_id).execute();

    // 4. Capture rolling + complete.
    await SixHiService.updateRolling(batchNumber, {
      actualWeightMt: 12.5,
      destination: 'ANNEALING',
      destinationOverride: false,
      passes: [{ passNo: 1, thicknessMm: Number(template.ppc_thk_mm) || 1 }],
      totalPasses: 1,
      finalThkMm: Number(template.ppc_thk_mm) || 1,
    } as any, USER_ID);
    await SixHiService.endProduction(batchNumber, USER_ID);

    // ---- DPR read layer ----
    const scope = scopeFromMonth(month);
    const runs = await ExportReadRepository.fetchRuns(scope);
    const stoppages = await ExportReadRepository.fetchStoppages(scope);
    const dispositions = await ExportReadRepository.fetchDisposition(scope);
    const targets = await ExportReadRepository.fetchTargets(month);

    const myRun = runs.find((r) => r.coilNo === coilNo);
    assert('Completed backlog production is in TODAY\'s DPR runs', !!myRun,
      myRun ? `area=${myRun.areaCode} date=${myRun.prodDate} shift=${myRun.shiftCode} wt=${myRun.outputWeightMt}` : 'run not found');
    assert('DPR run attributed to TODAY (not the planned backlog day)',
      !!myRun && myRun.prodDate === P, `runDate=${myRun?.prodDate} expected=${P}`);
    assert('DPR run attributed to the ACTUAL shift', !!myRun && myRun.shiftCode === S,
      `runShift=${myRun?.shiftCode} expected=${S}`);

    const myStop = stoppages.find((e) => e.eventId === `order:${openStop.stoppage_id}`);
    assert('Order stoppage present in DPR stoppages', !!myStop,
      myStop ? `date=${myStop.prodDate} shift=${myStop.shiftCode} min=${myStop.minutes} cat=${myStop.dprCategory}` : 'not found');
    assert('FIX: order stoppage attributed to ACTUAL shift (not hardcoded A)',
      !!myStop && myStop.shiftCode === S,
      `stopShift=${myStop?.shiftCode} expected=${S} (pre-fix would be 'A')`);
    assert('Order stoppage attributed to TODAY', !!myStop && myStop.prodDate === P,
      `stopDate=${myStop?.prodDate} expected=${P}`);

    // ---- Aggregation: minutes must land in the S column, zero in A ----
    const rdm = DprAggregator.aggregate({ month, runs, stoppages, dispositions, targets });
    const day = rdm.days.find((d) => {
      const dayStr = `${month}-${String(d.dayIndex).padStart(2, '0')}`;
      return dayStr === P;
    });
    const area = day?.areas.find((a) => a.areaCode === (myRun?.areaCode ?? '6HI_R'));
    assert('Aggregated block exists for today / area', !!area,
      area ? `prodA=${area.prod.A} prodB=${area.prod.B} prodC=${area.prod.C}` : 'no area');
    if (area) {
      const bucket = area.stoppageMin[dprBucket] as { A: number; B: number; C: number };
      assert(`Stoppage minutes land in shift ${S} ${dprBucket} column`,
        round1(bucket[S]) >= STOPPAGE_MIN, `${dprBucket}.${S}=${bucket[S]} (A=${bucket.A} B=${bucket.B} C=${bucket.C})`);
      if (S !== 'A') {
        // The specific 30-min slice we added must not be mis-booked into A.
        assert(`Stoppage minutes NOT mis-booked into shift A ${dprBucket} column`,
          round1(bucket.A) < STOPPAGE_MIN || round1(bucket.A) < round1(bucket[S]),
          `A=${bucket.A} ${S}=${bucket[S]}`);
      }
      assert(`Production booked in shift ${S} column`,
        round1((area.prod as any)[S]) >= 12.5, `prod.${S}=${(area.prod as any)[S]}`);
    }

    // ---- Template injection (fail-closed happy path) ----
    const injected = await injectDprTemplate(rdm, {});
    assert('Official template injects to a non-empty workbook',
      injected.buffer.length > 5000, `bytes=${injected.buffer.length} file=${injected.filename}`);

    // ---- Cell-level export-format fidelity: reopen the injected workbook ----
    const tmp = path.join(os.tmpdir(), `dpr-inspect-${stamp}.xlsx`);
    fs.writeFileSync(tmp, injected.buffer);
    try {
      const outWb = new ExcelJS.Workbook();
      await outWb.xlsx.readFile(tmp);
      const tplWb = new ExcelJS.Workbook();
      await tplWb.xlsx.readFile(blankMasterPath());

      const outMain = outWb.worksheets[0];
      const tplMain = tplWb.worksheets[0];
      const dayIndex = Number(P.slice(8, 10));
      const areaCode = myRun?.areaCode ?? (MACHINE === '4HI' ? '4HI_R' : '6HI_R');
      const base = titleRow(dayIndex);
      const machineRow = base + AREA_TITLE_OFFSET[areaCode];

      assert('Workbook preserves the template sheet set (main + DELAY)',
        outWb.worksheets.length === tplWb.worksheets.length && !!outWb.getWorksheet('DELAY'),
        `out=${outWb.worksheets.map((s) => s.name).join('/')} tpl=${tplWb.worksheets.length} sheets`);

      const outMerges = (outMain.model as any)?.merges?.length ?? -1;
      const tplMerges = (tplMain.model as any)?.merges?.length ?? -1;
      assert('Merged-cell structure preserved (no merges lost/added)',
        outMerges === tplMerges && outMerges > 0, `outMerges=${outMerges} tplMerges=${tplMerges}`);

      const prodCell = outMain.getCell(machineRow, PROD_COL[S]);
      const rdmProd = Number((area?.prod as any)?.[S] ?? NaN);
      assert(`Production input cell populated with aggregated value (row ${machineRow}, shift ${S})`,
        Math.abs(Number(prodCell.value) - rdmProd) < 0.011,
        `cell=${JSON.stringify(prodCell.value)} rdm=${rdmProd}`);
      assert('Production input cell is a number (no required field left blank)',
        typeof prodCell.value === 'number', `type=${typeof prodCell.value}`);

      const dateCell = String(outMain.getCell(base, DATE_COL).value ?? '');
      assert('Date cell populated in dd.mm.yyyy on the day title row',
        /^\d{2}\.\d{2}\.\d{4}$/.test(dateCell) && dateCell.startsWith(String(dayIndex).padStart(2, '0')),
        `date="${dateCell}"`);
      assert('Day-number cell populated on the title row',
        Number(outMain.getCell(base, DAYNUM_COL).value) === dayIndex,
        `dayNum=${outMain.getCell(base, DAYNUM_COL).value} expected=${dayIndex}`);

      // Formula preservation: any derived column that is a formula in the template
      // must remain a formula in the output (injector must never overwrite formulas).
      const tplFormulaCols = FORMULA_COLS.filter((c) => isFormulaCell(tplMain.getCell(machineRow, c)));
      const preserved = tplFormulaCols.filter((c) => isFormulaCell(outMain.getCell(machineRow, c)));
      assert('Derived/calculated cells remain Excel formulas (not overwritten)',
        tplFormulaCols.length > 0 && preserved.length === tplFormulaCols.length,
        `templateFormulaCols=[${tplFormulaCols}] preserved=[${preserved}]`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } finally {
    if (orderId) {
      for (const t of [
        'txn.order_shift_attribution', 'txn.order_stoppage', 'txn.crm_rolling_pass',
        'txn.crm_rolling', 'txn.crm_skinpass', 'txn.order_remark',
        'txn.order_rejection', 'txn.machine_state_event',
      ]) {
        await db.deleteFrom(t as any).where('order_id', '=', orderId).execute().catch(() => {});
      }
      await db.deleteFrom('txn.crm_order').where('order_id', '=', orderId).execute().catch(() => {});
    }
    await db.deleteFrom('coil.coil').where('coil_no', '=', coilNo).execute().catch(() => {});
    await db.deleteFrom('planning.ppc_batch').where('batch_number', '=', batchNumber).execute().catch(() => {});

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
    await cleanupLog(await SixHiService.resolveShiftLogIdForPlan(plannedDate, 'A'), plannedLogExisted);
    await cleanupLog(await SixHiService.resolveShiftLogIdForPlan(P, S), activeLogExistedBefore);
    console.log('\nCleanup complete.');
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== DPR VALIDATION ${failed.length === 0 ? 'PASSED' : 'FAILED'} (${results.length - failed.length}/${results.length}) =====`);
  await db.destroy();
  process.exit(failed.length === 0 ? 0 : 1);
}

requestContext.run(
  {
    tenant_id: '00000000-0000-0000-0000-000000000001',
    correlation_id: `dprtest-${Date.now()}`,
    user: { id: USER_ID, username: 'operator', roles: ['OPERATOR'], lineAccess: ['6HI'] },
  },
  () => main().catch(async (e) => {
    console.error('DPR VALIDATION ERROR:', e);
    await db.destroy().catch(() => {});
    process.exit(1);
  }),
);
