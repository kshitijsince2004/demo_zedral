/**
 * Journey hand-off: require non-draft capture before HRS/PKL end,
 * idempotent re-emit of production.captured, stranded-coil reconcile.
 */
import { buildEventEnvelope, getEventBus } from '@zedral/platform';
import { sql } from 'kysely';
import { db } from '../db';
import { getTenantId } from '../context';
import { logger } from '../utils/logger';
import { ProcessRouteService } from './ProcessRouteService';
import { QueueTransferService, type BatchRow } from './QueueTransferService';
import { recordHandoffSelfHeal } from './handoffMetrics';

const ADVANCE_PROCESSES = ['HRS', 'PKL', 'RWD', 'CRS', 'CTL'] as const;
type AdvanceProcess = (typeof ADVANCE_PROCESSES)[number];

const PROD_TABLE: Partial<Record<AdvanceProcess, 'txn.prod_hrs' | 'txn.prod_pkl' | 'txn.prod_rwd' | 'txn.prod_crs' | 'txn.prod_ctl'>> = {
  HRS: 'txn.prod_hrs',
  PKL: 'txn.prod_pkl',
  RWD: 'txn.prod_rwd',
  CRS: 'txn.prod_crs',
  CTL: 'txn.prod_ctl',
};

function tenantIdOrDefault(): string {
  return getTenantId() ?? '00000000-0000-0000-0000-000000000001';
}

export async function emitProductionCaptured(
  processCode: string,
  shiftLogId: string,
  entryId: string,
  coilNo: string,
): Promise<void> {
  const tenantId = tenantIdOrDefault();
  await getEventBus().publish(
    buildEventEnvelope({
      type: 'production.captured',
      tenantId,
      key: `${tenantId}:production.captured:${processCode}:${entryId}`,
      lineageRef: `${processCode.toLowerCase()}:${entryId}`,
      payload: { processCode, shiftLogId, entryId, coilNo },
    }),
  );
}

type CompletedProd = { entryId: string; shiftLogId: string };

/** Latest COMPLETED prod_* for HRS/PKL (drafts are IN_PROGRESS). */
export async function findCompletedHrsPklProd(
  processCode: 'HRS' | 'PKL',
  coilNo: string,
  shiftLogId?: string | number | null,
): Promise<CompletedProd | null> {
  const table = PROD_TABLE[processCode]!;
  let q = db
    .selectFrom(table)
    .select(['entry_id', 'shift_log_id'])
    .where('coil_no', '=', coilNo)
    .where('status', '=', 'COMPLETED');
  if (shiftLogId != null && String(shiftLogId).trim() !== '') {
    q = q.where('shift_log_id', '=', shiftLogId as never);
  }
  const row = await q.orderBy('entry_id', 'desc').executeTakeFirst();
  if (!row) return null;
  return { entryId: String(row.entry_id), shiftLogId: String(row.shift_log_id) };
}

/** Fix 1: block end without a non-draft capture. */
export async function assertCompletedHrsPklProd(
  processCode: 'HRS' | 'PKL',
  coilNo: string,
  shiftLogId?: string | number | null,
): Promise<CompletedProd> {
  let prod = await findCompletedHrsPklProd(processCode, coilNo, shiftLogId);
  let usedShiftFallback = false;
  // Order shift_log_id is set at enqueue; capture uses the active shift — mismatch strands end.
  if (!prod && shiftLogId != null && String(shiftLogId).trim() !== '') {
    prod = await findCompletedHrsPklProd(processCode, coilNo, null);
    usedShiftFallback = !!prod;
  }
  // #region agent log
  fetch('http://127.0.0.1:7577/ingest/58d95c05-b61c-4a37-a3ee-d40d653006c8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'beb2a9' },
    body: JSON.stringify({
      sessionId: 'beb2a9',
      location: 'journeyHandoff.ts:assertCompletedHrsPklProd',
      message: 'HRS/PKL completed prod lookup',
      data: {
        processCode,
        coilNo,
        orderShiftLogId: shiftLogId ?? null,
        found: !!prod,
        usedShiftFallback,
        prodShiftLogId: prod?.shiftLogId ?? null,
      },
      timestamp: Date.now(),
      runId: 'post-fix',
      hypothesisId: 'D',
    }),
  }).catch(() => undefined);
  // #endregion
  if (!prod) {
    throw new Error('Save production data before ending order');
  }
  return prod;
}

export type StrandedHandoff = {
  coilNo: string;
  journeyId: string;
  currentStepNo: number;
  stuckProcess: string;
};

export type Inv1Violation = {
  coilNo: string;
  journeyId: string;
  stepNo: number;
  processCode: string;
};

const QUEUE_BACKED_PROCESSES = ['HRS', 'PKL', 'RWD', 'CRS', 'CTL', 'CRM'] as const;

/** INV-1: ACTIVE queue-backed step with null queue_batch_id. */
export async function findInv1Violations(): Promise<Inv1Violation[]> {
  const rows = await sql<{
    coil_no: string;
    journey_id: string;
    step_no: number;
    process_code: string;
  }>`
    SELECT oj.coil_no, oj.journey_id::text AS journey_id, cur.step_no, cur.process_code
    FROM planning.order_journey oj
    JOIN planning.order_journey_step cur
      ON cur.journey_id = oj.journey_id AND cur.step_no = oj.current_step_no
    WHERE oj.status = 'ACTIVE'
      AND cur.process_code IN ('HRS', 'PKL', 'RWD', 'CRS', 'CTL', 'CRM')
      AND cur.machine_code IS NOT NULL
      AND cur.queue_batch_id IS NULL
  `.execute(db);

  return rows.rows.map((r) => ({
    coilNo: r.coil_no,
    journeyId: r.journey_id,
    stepNo: Number(r.step_no),
    processCode: r.process_code,
  }));
}

/** Build a minimal source batch from coil (+ optional ppc_batch) for enqueueActiveStep. */
export async function buildSourceBatchForCoil(coilNo: string): Promise<BatchRow | null> {
  const coil = await db
    .selectFrom('coil.coil')
    .selectAll()
    .where('coil_no', '=', coilNo)
    .executeTakeFirst();
  if (!coil) return null;

  const batch = await db
    .selectFrom('planning.ppc_batch')
    .selectAll()
    .where('coil_no', '=', coilNo)
    .orderBy('batch_number', 'desc')
    .executeTakeFirst();

  return {
    batch_id: batch?.batch_id ?? 0,
    batch_number: batch?.batch_number ? String(batch.batch_number) : '',
    coil_no: coilNo,
    plan_date: batch?.plan_date ?? new Date(),
    shift_code: batch?.shift_code ? String(batch.shift_code) : '',
    customer_name: batch?.customer_name ? String(batch.customer_name) : '',
    grade_code: batch?.grade_code ? String(batch.grade_code) : (coil.grade_code ? String(coil.grade_code) : ''),
    width_mm: batch?.width_mm ?? coil.coil_width_mm ?? coil.nominal_width_mm ?? 0,
    ppc_thk_mm: batch?.ppc_thk_mm ?? batch?.input_thk_mm ?? coil.coil_thk_mm ?? 0,
    ppc_weight_mt: batch?.ppc_weight_mt ?? coil.weight_mt ?? 0,
    destination: batch?.destination ? String(batch.destination) : null,
    roll_finish: batch?.roll_finish ? String(batch.roll_finish) : null,
    slit_id: batch?.slit_id ? String(batch.slit_id) : null,
    sap_order_no: batch?.sap_order_no ? String(batch.sap_order_no) : null,
  };
}

/** Phase 5: enqueue missing batch for one INV-1 violation (idempotent). */
export async function healInv1Violation(v: Inv1Violation): Promise<boolean> {
  if (!QUEUE_BACKED_PROCESSES.includes(v.processCode as (typeof QUEUE_BACKED_PROCESSES)[number])) {
    return false;
  }
  const source = await buildSourceBatchForCoil(v.coilNo);
  if (!source) return false;
  const batchId = await QueueTransferService.enqueueActiveStep(Number(v.journeyId), source, {});
  if (batchId) {
    recordHandoffSelfHeal('enqueue_active_step');
    return true;
  }
  return false;
}

export async function backfillInv1Violations(): Promise<number> {
  const violations = await findInv1Violations();
  let healed = 0;
  for (const v of violations) {
    try {
      if (await healInv1Violation(v)) healed += 1;
    } catch (err) {
      logger.error(
        JSON.stringify({
          msg: 'journey_handoff_backfill_failed',
          coilNo: v.coilNo,
          processCode: v.processCode,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return healed;
}

export async function getHandoffHealthSnapshot(): Promise<{
  strandedCount: number;
  inv1ViolationCount: number;
  metrics: Record<string, number>;
}> {
  const [stranded, inv1] = await Promise.all([findStrandedHandoffs(), findInv1Violations()]);
  const { getHandoffMetricsSnapshot } = await import('./handoffMetrics');
  return {
    strandedCount: stranded.length,
    inv1ViolationCount: inv1.length,
    metrics: getHandoffMetricsSnapshot(),
  };
}

/** Coils with COMPLETED line order / DONE coil but next journey step never enqueued. */
export async function findStrandedHandoffs(): Promise<StrandedHandoff[]> {
  // ponytail: coil DONE covers CRS/CTL (no line-order tables); HRS/PKL/RWD also match COMPLETED orders
  const rows = await sql<{
    coil_no: string;
    journey_id: string;
    current_step_no: number;
    stuck_process: string;
  }>`
    SELECT DISTINCT ON (oj.journey_id)
      oj.coil_no,
      oj.journey_id::text AS journey_id,
      oj.current_step_no,
      cur.process_code AS stuck_process
    FROM planning.order_journey oj
    JOIN planning.order_journey_step cur
      ON cur.journey_id = oj.journey_id AND cur.step_no = oj.current_step_no
    JOIN planning.order_journey_step nxt
      ON nxt.journey_id = oj.journey_id
     AND nxt.step_no > oj.current_step_no
     AND nxt.status <> 'SKIPPED'
    JOIN coil.coil c ON c.coil_no = oj.coil_no
    WHERE oj.status = 'ACTIVE'
      AND cur.process_code IN ('HRS', 'PKL', 'RWD', 'CRS', 'CTL')
      AND nxt.queue_batch_id IS NULL
      AND (
        c.status = 'DONE'
        OR (cur.process_code = 'HRS' AND EXISTS (
          SELECT 1 FROM txn.hrs_order h WHERE h.coil_no = oj.coil_no AND h.status = 'COMPLETED'))
        OR (cur.process_code = 'PKL' AND EXISTS (
          SELECT 1 FROM txn.pkl_order p WHERE p.coil_no = oj.coil_no AND p.status = 'COMPLETED'))
        OR (cur.process_code = 'RWD' AND EXISTS (
          SELECT 1 FROM txn.rwd_order r WHERE r.coil_no = oj.coil_no AND r.status = 'COMPLETED'))
        OR (cur.process_code = 'CRS' AND EXISTS (
          SELECT 1 FROM txn.prod_crs ph WHERE ph.coil_no = oj.coil_no))
        OR (cur.process_code = 'CTL' AND EXISTS (
          SELECT 1 FROM txn.prod_ctl pt WHERE pt.coil_no = oj.coil_no))
      )
    ORDER BY oj.journey_id, nxt.step_no
  `.execute(db);

  return rows.rows.map((r) => ({
    coilNo: r.coil_no,
    journeyId: r.journey_id,
    currentStepNo: Number(r.current_step_no),
    stuckProcess: r.stuck_process,
  }));
}

async function findAnyCompletedProd(
  processCode: AdvanceProcess,
  coilNo: string,
): Promise<CompletedProd | null> {
  if (processCode === 'HRS' || processCode === 'PKL') {
    return findCompletedHrsPklProd(processCode, coilNo);
  }
  const table = PROD_TABLE[processCode];
  if (!table) return null;
  // RWD/CRS/CTL: no draft status gate — any latest row
  const row = await db
    .selectFrom(table)
    .select(['entry_id', 'shift_log_id'])
    .where('coil_no', '=', coilNo)
    .orderBy('entry_id', 'desc')
    .executeTakeFirst();
  if (!row) return null;
  return { entryId: String(row.entry_id), shiftLogId: String(row.shift_log_id) };
}

/** Fix 3: re-drive one stranded coil. Returns true if an action was taken. */
export async function reconcileOneStranded(s: StrandedHandoff): Promise<boolean> {
  const code = s.stuckProcess as AdvanceProcess;
  if (!ADVANCE_PROCESSES.includes(code)) return false;

  const prod = await findAnyCompletedProd(code, s.coilNo);
  if (prod) {
    await emitProductionCaptured(code, prod.shiftLogId, prod.entryId, s.coilNo);
    return true;
  }
  await ProcessRouteService.advanceJourneyByCoil(s.coilNo, {});
  return true;
}

const STARTED_ORDER = new Set(['IN_PROGRESS', 'STOPPAGE', 'COMPLETED']);

/** True when the next line already has real work — block HRS/PKL completed rewind/delete. */
export function nextLineBlocksRewind(nextStepStatus: string, nextOrderStatus?: string | null): boolean {
  const step = nextStepStatus.toUpperCase();
  if (step === 'ACTIVE' || step === 'COMPLETED') return true;
  return Boolean(nextOrderStatus && STARTED_ORDER.has(nextOrderStatus.toUpperCase()));
}

async function orderStatusForProcess(coilNo: string, processCode: string): Promise<string | null> {
  if (processCode === 'PKL') {
    const o = await db.selectFrom('txn.pkl_order').select('status').where('coil_no', '=', coilNo).executeTakeFirst();
    return o?.status ?? null;
  }
  if (processCode === 'HRS') {
    const o = await db.selectFrom('txn.hrs_order').select('status').where('coil_no', '=', coilNo).executeTakeFirst();
    return o?.status ?? null;
  }
  if (processCode === 'RWD') {
    const o = await db.selectFrom('txn.rwd_order').select('status').where('coil_no', '=', coilNo).executeTakeFirst();
    return o?.status ?? null;
  }
  if (processCode === 'CRM' || processCode === '6HI' || processCode === '4HI' || processCode === '2HI') {
    const o = await db.selectFrom('txn.crm_order').select('status').where('coil_no', '=', coilNo).executeTakeFirst();
    return o?.status ?? null;
  }
  return null;
}

/**
 * If journey already left this line, rewind only when the next line has not started.
 * No-op when current step is still `processCode`.
 */
export async function rewindCompletedLineIfNextIdle(
  coilNo: string,
  processCode: 'HRS' | 'PKL',
): Promise<void> {
  const journey = await db
    .selectFrom('planning.order_journey')
    .select(['journey_id', 'current_step_no', 'status'])
    .where('coil_no', '=', coilNo)
    .where('status', 'in', ['ACTIVE', 'COMPLETED'])
    .executeTakeFirst();
  if (!journey) return;

  const steps = await db
    .selectFrom('planning.order_journey_step')
    .select(['step_id', 'step_no', 'process_code', 'status'])
    .where('journey_id', '=', String(journey.journey_id))
    .orderBy('step_no', 'asc')
    .execute();

  const thisStep = steps.find((s) => s.process_code === processCode);
  if (!thisStep) return;

  const current = steps.find((s) => s.step_no === journey.current_step_no);
  if (!current || current.process_code === processCode) return;

  const nextStatus = await orderStatusForProcess(coilNo, String(current.process_code));
  if (nextLineBlocksRewind(String(current.status), nextStatus)) {
    throw new Error(
      `Cannot change completed ${processCode} order — ${current.process_code} has already started`,
    );
  }

  const now = new Date();
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('planning.order_journey_step')
      .set({ status: 'ACTIVE', completed_at: null })
      .where('step_id', '=', thisStep.step_id)
      .execute();
    await trx
      .updateTable('planning.order_journey_step')
      .set({ status: 'PENDING', queue_batch_id: null })
      .where('step_id', '=', current.step_id)
      .execute();
    await trx
      .updateTable('planning.order_journey')
      .set({ current_step_no: thisStep.step_no, status: 'ACTIVE', updated_at: now })
      .where('journey_id', '=', String(journey.journey_id))
      .execute();
  });
}

export async function reconcileStrandedHandoffs(): Promise<number> {
  const inv1Healed = await backfillInv1Violations();
  const stranded = await findStrandedHandoffs();
  let healed = inv1Healed;
  for (const s of stranded) {
    try {
      if (await reconcileOneStranded(s)) healed += 1;
    } catch (err) {
      logger.error(
        JSON.stringify({
          msg: 'journey_handoff_reconcile_failed',
          coilNo: s.coilNo,
          stuckProcess: s.stuckProcess,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return healed;
}
