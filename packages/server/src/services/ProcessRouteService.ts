import type { OrderJourneyView, ProcessRouteStepView } from '@m1/shared-validation';
import type { Kysely } from 'kysely';
import { db } from '../db';
import type { Database } from '../db';
import { parseRouteForJourney } from '../utils/PpcRouteTranslator';

type DbConn = Kysely<Database>;

export interface ParsedRouteStep {
  routeCode: string;
  displayLabel: string;
  processCode: string | null;
  machineCode: string | null;
  subProcess: string | null;
}

export interface CompletionPayload {
  outputThkMm?: number;
  actualWeightMt?: number;
  destination?: string;
  gradeCode?: string;
  widthMm?: number;
  customerName?: string;
  shiftCode?: string;
}

const ROUTE_CODE_PATTERN = /^(LE|PKG|[SP46RFXYZC])$/;

/** Parse raw route string (dash-separated or PPC concatenated) into steps. Packaging always appended. */
export function parseRouteString(routeRaw: string): ParsedRouteStep[] {
  const normalized = parseRouteForJourney(routeRaw);
  const tokens = normalized
    .split('-')
    .map((t) => t.trim())
    .filter(Boolean);

  const codes: string[] = [];
  for (const token of tokens) {
    if (token === 'PACKAGING' || token === 'PKG') continue;
    if (ROUTE_CODE_PATTERN.test(token)) codes.push(token);
  }
  if (!codes.includes('PKG')) codes.push('PKG');

  return codes.map((code) => {
    const meta = ROUTE_META[code];
    if (!meta) throw new Error(`Unknown route code: ${code}`);
    return { routeCode: code, ...meta };
  });
}

const ROUTE_META: Record<string, Omit<ParsedRouteStep, 'routeCode'>> = {
  S: { displayLabel: 'HR Slitting', processCode: 'HRS', machineCode: 'HRS', subProcess: null },
  P: { displayLabel: 'Pickling', processCode: 'PKL', machineCode: 'PKL', subProcess: null },
  '4': { displayLabel: 'Rolling', processCode: 'CRM', machineCode: null, subProcess: 'ROLLING' },
  '6': { displayLabel: '6HI Rolling', processCode: 'CRM', machineCode: '6HI', subProcess: 'ROLLING' },
  R: { displayLabel: 'Rewinding', processCode: 'RWD', machineCode: 'RWD', subProcess: null },
  F: { displayLabel: 'Annealing', processCode: 'ANN', machineCode: 'ANN', subProcess: null },
  X: { displayLabel: 'Skin Pass', processCode: 'CRM', machineCode: null, subProcess: 'SKIN_PASS' },
  Y: { displayLabel: '4HI Skin Pass', processCode: 'CRM', machineCode: '4HI', subProcess: 'SKIN_PASS' },
  Z: { displayLabel: '6HI Skin Pass', processCode: 'CRM', machineCode: '6HI', subProcess: 'SKIN_PASS' },
  C: { displayLabel: 'CR Slitting', processCode: 'CRS', machineCode: 'CRS', subProcess: null },
  LE: { displayLabel: 'CTL', processCode: 'CTL', machineCode: 'CTL', subProcess: null },
  PKG: { displayLabel: 'Packaging', processCode: null, machineCode: null, subProcess: null },
};

/** Derive route code from a PPC batch's machine + sub_process. */
export function routeCodeFromBatch(machineCode: string, subProcess: string): string | null {
  if (subProcess === 'ROLLING' && ['6HI', '4HI'].includes(machineCode)) return '4';
  if (subProcess === 'SKIN_PASS' && ['2HI', '4HI', '6HI'].includes(machineCode)) return 'X';

  const map: Record<string, string> = {
    '6HI:ROLLING': '6',
    '6HI:SKIN_PASS': 'Z',
    '4HI:ROLLING': '4',
    '4HI:SKIN_PASS': 'Y',
    '2HI:SKIN_PASS': 'X',
    '2HI:REWINDING': 'R',
    'HRS:': 'S',
    'PKL:': 'P',
    'ANN:': 'F',
    'RWD:': 'R',
    'RWD:RWD': 'R',
    'CRS:': 'C',
    'CTL:': 'LE',
    'CTL:CTL': 'LE',
  };
  const key = subProcess ? `${machineCode}:${subProcess}` : `${machineCode}:`;
  if (map[key]) return map[key];
  const procMap: Record<string, string> = {
    HRS: 'S', PKL: 'P', ANN: 'F', RWD: 'R', CRS: 'C', CTL: 'LE',
  };
  return procMap[machineCode] ?? null;
}

/** Pick the journey step route token to link for a CRM batch import. */
export function resolveLinkRouteCode(
  machineCode: string,
  subProcess: string,
  routeRaw: string,
): string | null {
  const preferred = routeCodeFromBatch(machineCode, subProcess);
  const steps = parseRouteString(routeRaw);
  const codes = steps.map((s) => s.routeCode);
  if (preferred && codes.includes(preferred)) return preferred;
  if (subProcess === 'ROLLING') {
    if (codes.includes('4')) return '4';
    if (codes.includes('6')) return '6';
  }
  if (subProcess === 'SKIN_PASS') {
    if (codes.includes('X')) return 'X';
    if (codes.includes('Z')) return 'Z';
    if (codes.includes('Y')) return 'Y';
  }
  return preferred;
}

export class ProcessRouteService {
  static async createJourney(
    coilNo: string,
    routeRaw: string,
    batchId?: number,
    machineCode?: string,
    subProcess?: string,
    conn: DbConn = db,
  ): Promise<number> {
    // Race-safe: partial unique on (coil_no) WHERE status='ACTIVE' + upsert.
    const inserted = await conn.insertInto('planning.order_journey')
      .values({ coil_no: coilNo, route_raw: routeRaw.toUpperCase(), current_step_no: 1, status: 'ACTIVE' })
      .onConflict((oc) => oc
        .column('coil_no')
        .where('status', '=', 'ACTIVE')
        .doNothing())
      .returning('journey_id')
      .executeTakeFirst();

    if (!inserted) {
      const existing = await conn.selectFrom('planning.order_journey')
        .select('journey_id')
        .where('coil_no', '=', coilNo)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirstOrThrow();
      return Number(existing.journey_id);
    }

    const journeyId = Number(inserted.journey_id);
    const steps = parseRouteString(routeRaw);
    let activeStepNo = 1;

    if (batchId && machineCode) {
      const code = resolveLinkRouteCode(machineCode, subProcess ?? '', routeRaw);
      const idx = code ? steps.findIndex((s) => s.routeCode === code) : -1;
      if (idx >= 0) activeStepNo = idx + 1;
    }

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const stepNo = i + 1;
      const isActive = stepNo === activeStepNo;
      const stepMachine = s.routeCode === '4' || s.routeCode === 'X' ? null : s.machineCode;
      await conn.insertInto('planning.order_journey_step')
        .values({
          journey_id: journeyId,
          step_no: stepNo,
          route_code: s.routeCode,
          display_label: s.displayLabel,
          process_code: s.processCode,
          machine_code: stepMachine,
          sub_process: s.subProcess,
          status: isActive ? 'ACTIVE' : 'PENDING',
          started_at: isActive ? new Date() : null,
          queue_batch_id: isActive && batchId ? batchId : null,
        })
        .execute();
    }

    await conn.updateTable('planning.order_journey')
      .set({ current_step_no: activeStepNo, updated_at: new Date() })
      .where('journey_id', '=', String(journeyId))
      .execute();

    return journeyId;
  }

  static async linkBatchToJourney(
    batchId: number,
    coilNo: string,
    routeRaw: string,
    machineCode: string,
    subProcess: string,
    conn: DbConn = db,
  ) {
    const code = resolveLinkRouteCode(machineCode, subProcess, routeRaw);
    if (!code) return;

    let journey = await conn.selectFrom('planning.order_journey')
      .select(['journey_id', 'current_step_no'])
      .where('coil_no', '=', coilNo)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();

    if (!journey) {
      await this.createJourney(coilNo, routeRaw, batchId, machineCode, subProcess, conn);
      return;
    }

    const journeyId = Number(journey.journey_id);
    const currentStepNo = Number(journey.current_step_no);
    const step = await conn.selectFrom('planning.order_journey_step')
      .select(['step_id', 'step_no', 'status', 'queue_batch_id', 'started_at'])
      .where('journey_id', '=', String(journeyId))
      .where('route_code', '=', code)
      .executeTakeFirst();

    if (!step) return;

    // Never move the pointer backward or re-activate finished steps.
    if (Number(step.step_no) < currentStepNo) return;
    if (step.status === 'COMPLETED' || step.status === 'SKIPPED') return;

    // Activate only a PENDING step with no live queue yet (fail-safe inject / first link).
    if (step.status === 'PENDING' && step.queue_batch_id == null) {
      await conn.updateTable('planning.order_journey_step')
        .set({
          status: 'ACTIVE',
          started_at: new Date(),
          queue_batch_id: batchId,
        })
        .where('step_id', '=', step.step_id)
        .execute();

      await conn.updateTable('planning.order_journey')
        .set({ current_step_no: step.step_no, updated_at: new Date() })
        .where('journey_id', '=', String(journeyId))
        .execute();
      return;
    }

    // Already live — attach batch idempotently; do not reset started_at or move pointer.
    if (step.queue_batch_id == null) {
      await conn.updateTable('planning.order_journey_step')
        .set({ queue_batch_id: batchId })
        .where('step_id', '=', step.step_id)
        .execute();
    }
  }

  private static mapSteps(steps: any[]): ProcessRouteStepView[] {
    return steps.map((s): ProcessRouteStepView => ({
      stepNo: s.step_no,
      label: s.display_label,
      status: s.status as ProcessRouteStepView['status'],
      processCode: s.process_code ?? undefined,
      machineCode: s.machine_code ?? undefined,
      subProcess: s.sub_process ?? undefined,
      completedAt: s.completed_at ? new Date(s.completed_at).toISOString() : undefined,
      startedAt: s.started_at ? new Date(s.started_at).toISOString() : undefined,
    }));
  }

  private static buildView(
    journey: { journey_id: string | number | bigint; coil_no: string; status: string; current_step_no: number },
    steps: any[],
  ): OrderJourneyView {
    return {
      journeyId: String(journey.journey_id),
      coilNo: journey.coil_no,
      status: journey.status as OrderJourneyView['status'],
      currentStepNo: journey.current_step_no,
      steps: this.mapSteps(steps),
    };
  }

  /** Batch-fetch latest journey per coil (2 queries regardless of coil count). */
  static async getJourneysByCoils(coilNos: string[]): Promise<Map<string, OrderJourneyView>> {
    const unique = [...new Set(coilNos.filter(Boolean))];
    const result = new Map<string, OrderJourneyView>();
    if (unique.length === 0) return result;

    const journeys = await db.selectFrom('planning.order_journey')
      .selectAll()
      .where('coil_no', 'in', unique)
      .orderBy('coil_no', 'asc')
      .orderBy('journey_id', 'desc')
      .execute();

    const latestByCoil = new Map<string, typeof journeys[0]>();
    for (const journey of journeys) {
      if (!latestByCoil.has(journey.coil_no)) {
        latestByCoil.set(journey.coil_no, journey);
      }
    }

    const journeyIds = [...latestByCoil.values()].map((j) => String(j.journey_id));
    if (journeyIds.length === 0) return result;

    const steps = await db.selectFrom('planning.order_journey_step')
      .selectAll()
      .where('journey_id', 'in', journeyIds)
      .orderBy('step_no', 'asc')
      .execute();

    const stepsByJourney = new Map<string, typeof steps>();
    for (const step of steps) {
      const journeyId = String(step.journey_id);
      const bucket = stepsByJourney.get(journeyId);
      if (bucket) bucket.push(step);
      else stepsByJourney.set(journeyId, [step]);
    }

    for (const [coilNo, journey] of latestByCoil) {
      const journeyId = String(journey.journey_id);
      result.set(coilNo, this.buildView(journey, stepsByJourney.get(journeyId) ?? []));
    }
    return result;
  }

  static async getJourneyByCoil(coilNo: string): Promise<OrderJourneyView | null> {
    const journeys = await this.getJourneysByCoils([coilNo]);
    return journeys.get(coilNo) ?? null;
  }

  static async getJourneyByBatch(batchNumber: string): Promise<OrderJourneyView | null> {
    const batch = await db.selectFrom('planning.ppc_batch')
      .select(['coil_no', 'process_route_raw'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) return null;
    return this.getJourneyByCoil(batch.coil_no);
  }

  static async toView(journeyId: number): Promise<OrderJourneyView> {
    const journey = await db.selectFrom('planning.order_journey')
      .selectAll()
      .where('journey_id', '=', String(journeyId))
      .executeTakeFirstOrThrow();

    const steps = await db.selectFrom('planning.order_journey_step')
      .selectAll()
      .where('journey_id', '=', String(journeyId))
      .orderBy('step_no', 'asc')
      .execute();

    return this.buildView(journey, steps);
  }

  static async advanceJourneyByCoil(coilNo: string, payload: CompletionPayload): Promise<OrderJourneyView | null> {
    const journey = await db.selectFrom('planning.order_journey')
      .selectAll()
      .where('coil_no', '=', coilNo)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!journey) return null;

    const currentStep = await db.selectFrom('planning.order_journey_step')
      .select('queue_batch_id')
      .where('journey_id', '=', String(journey.journey_id))
      .where('step_no', '=', journey.current_step_no)
      .executeTakeFirst();

    if (!currentStep?.queue_batch_id) return null;

    const batch = await db.selectFrom('planning.ppc_batch')
      .select('batch_number')
      .where('batch_id', '=', String(currentStep.queue_batch_id))
      .executeTakeFirst();
      
    if (!batch) return null;

    return this.advanceJourney(batch.batch_number, payload);
  }

  static async advanceJourney(batchNumber: string, payload: CompletionPayload): Promise<OrderJourneyView | null> {
    const batch = await db.selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) return null;

    const journey = await db.selectFrom('planning.order_journey')
      .selectAll()
      .where('coil_no', '=', batch.coil_no)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!journey) return null;

    const journeyId = Number(journey.journey_id);
    const currentStep = await db.selectFrom('planning.order_journey_step')
      .selectAll()
      .where('journey_id', '=', String(journeyId))
      .where('step_no', '=', journey.current_step_no)
      .executeTakeFirst();
    if (!currentStep) return null;

    const now = new Date();

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('planning.order_journey_step')
        .set({ status: 'COMPLETED', completed_at: now })
        .where('step_id', '=', currentStep.step_id)
        .execute();

      // Advance to the next non-skipped step (e.g. CRS For-CTL sets PKG/LE to SKIPPED).
      const nextStep = await trx.selectFrom('planning.order_journey_step')
        .selectAll()
        .where('journey_id', '=', String(journeyId))
        .where('step_no', '>', journey.current_step_no)
        .where('status', '!=', 'SKIPPED')
        .orderBy('step_no', 'asc')
        .executeTakeFirst();

      if (!nextStep) {
        await trx.updateTable('planning.order_journey')
          .set({ status: 'COMPLETED', updated_at: now })
          .where('journey_id', '=', String(journeyId))
          .execute();
        return;
      }

      const { QueueTransferService } = await import('./QueueTransferService');
      const newBatchId = await QueueTransferService.enqueueNextStep(
        journeyId,
        Number(currentStep.step_id),
        nextStep,
        batch,
        payload,
        trx,
      );

      await trx.updateTable('planning.order_journey_step')
        .set({
          status: 'PENDING',
          queue_batch_id: newBatchId ?? nextStep.queue_batch_id,
        })
        .where('step_id', '=', nextStep.step_id)
        .execute();

      await trx.updateTable('planning.order_journey')
        .set({ current_step_no: nextStep.step_no, updated_at: now })
        .where('journey_id', '=', String(journeyId))
        .execute();

      if (nextStep.process_code) {
        await trx.updateTable('coil.coil')
          .set({
            next_dest: nextStep.process_code,
            current_process_id: null,
          })
          .where('coil_no', '=', batch.coil_no)
          .execute();
      }
    });

    return this.toView(journeyId);
  }
}
