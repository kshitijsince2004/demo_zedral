import type { EventEnvelope } from '@zedral/platform';
import { getEventBus } from '@zedral/platform';
import type { Kysely } from 'kysely';
import {
  calculateScrapPct,
  resolveSlitThkMm,
  resolveSlitWeightMt,
} from '@m1/shared-validation';
import { db, type Database } from '../../../db';
import {
  ProcessRouteService,
  parseRouteString,
  type CompletionPayload,
} from '../../../services/ProcessRouteService';
import { derivedChildCoilNo } from '../../../utils/childCoil';
import { resolveCrsSlitPreferredRoute } from '../../../utils/crsSlitRoute';

type DbConn = Kysely<Database>;

const ADVANCE_PROCESSES = new Set(['HRS', 'PKL', 'RWD', 'CRS', 'CTL']);
const SLIT_PROCESSES = new Set(['HRS', 'CRS']);

type CapturedPayload = {
  processCode: string;
  shiftLogId: string;
  entryId: string;
  coilNo: string;
};

interface SlitSlotRow {
  slot: string | null;
  width_mm: number | string | null;
  thk_mm?: number | string | null;
  child_coil_no: string | null;
  hold_flag?: boolean | null;
  for_ctl_flag?: boolean | null;
  route_code?: string | null;
  route_raw?: string | null;
  output_wt_mt?: number | string | null;
  actual_weight_mt?: number | string | null;
  planned_weight_mt?: number | string | null;
  planned_thk_mm?: number | string | null;
  actual_thk_front_mm?: number | string | null;
  thk_id_mm?: number | string | null;
  thk_latest_mm?: number | string | null;
}

const RETRY_DELAYS_MS = [1000, 5000, 15000];
const pendingRetries = new Map<string, number>();

function routeAfterStep(routeRaw: string, processCode: string): string {
  const steps = parseRouteString(routeRaw);
  const idx = steps.findIndex((s) => s.processCode === processCode);
  if (idx < 0) return routeRaw;
  const remaining = steps.slice(idx + 1).map((s) => s.routeCode);
  return remaining.join('-') || 'PKG';
}

function routeAfterStepPreferred(routeRaw: string, processCode: string, preferredFirstRouteCode: string): string {
  const steps = parseRouteString(routeRaw);
  const idx = steps.findIndex((s) => s.processCode === processCode);
  if (idx < 0) return routeRaw;
  const remaining = steps.slice(idx + 1).map((s) => s.routeCode);
  const preferredIdx = remaining.findIndex((c) => c === preferredFirstRouteCode);
  const chosen = preferredIdx >= 0 ? remaining.slice(preferredIdx) : remaining;
  return chosen.join('-') || preferredFirstRouteCode;
}

async function isStepCompleted(coilNo: string, processCode: string, conn: DbConn = db): Promise<boolean> {
  const journey = await conn.selectFrom('planning.order_journey')
    .select(['journey_id', 'current_step_no'])
    .where('coil_no', '=', coilNo)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();
  if (!journey) return false;

  const step = await conn.selectFrom('planning.order_journey_step')
    .select('status')
    .where('journey_id', '=', String(journey.journey_id))
    .where('process_code', '=', processCode)
    .orderBy('step_no', 'desc')
    .executeTakeFirst();

  return step?.status === 'COMPLETED';
}

async function loadHrsSlits(entryId: string, conn: DbConn = db): Promise<SlitSlotRow[]> {
  return conn.selectFrom('txn.prod_hrs_slit')
    .select([
      'slot',
      'width_mm',
      'thk_mm',
      'child_coil_no',
      'hold_flag',
      'for_ctl_flag',
      'route_raw',
      'actual_weight_mt',
      'planned_weight_mt',
      'planned_thk_mm',
      'thk_latest_mm',
      'thk_id_mm',
    ])
    .where('entry_id', '=', entryId)
    .execute();
}

async function loadCrsSlits(entryId: string, conn: DbConn = db): Promise<SlitSlotRow[]> {
  return conn.selectFrom('txn.prod_crs_slit')
    .select([
      'slot',
      'width_mm',
      'child_coil_no',
      'hold_flag',
      'for_ctl_flag',
      'route_code',
      'output_wt_mt',
      'actual_thk_front_mm',
    ])
    .where('entry_id', '=', entryId)
    .execute();
}

async function loadHrsEntry(entryId: string, conn: DbConn = db) {
  return conn.selectFrom('txn.prod_hrs')
    .selectAll()
    .where('entry_id', '=', entryId)
    .executeTakeFirst();
}

async function loadCrsEntry(entryId: string) {
  return db.selectFrom('txn.prod_crs')
    .selectAll()
    .where('entry_id', '=', entryId)
    .executeTakeFirst();
}

async function validateCrsQuality(
  entry: NonNullable<Awaited<ReturnType<typeof loadCrsEntry>>>,
): Promise<{ pass: boolean; failures: string[] }> {
  const coil = await db.selectFrom('coil.coil')
    .select(['grade_code', 'customer_id'])
    .where('coil_no', '=', entry.coil_no)
    .executeTakeFirst();
  if (!coil?.grade_code) return { pass: true, failures: [] };

  const { SpecResolverService } = await import('../../../services/SpecResolverService');
  const resolved = await SpecResolverService.resolve({
    gradeCode: coil.grade_code,
    customerId: coil.customer_id != null ? Number(coil.customer_id) : null,
  });
  if (!resolved) return { pass: true, failures: [] };

  const failures: string[] = [];
  const num = (v: unknown) => (v == null ? null : Number(v));
  const checks: Array<{ code: string; measured: number | null; label: string }> = [
    { code: 'HARDNESS', measured: num(entry.hardness_vpn) ?? num(entry.hardness_hrb), label: 'hardness' },
    { code: 'UTS', measured: num(entry.uts_nmm2), label: 'UTS' },
    { code: 'ELONGATION', measured: num(entry.elongation_pct), label: 'elongation' },
    { code: 'RA_UM', measured: num(entry.ra_um), label: 'Ra' },
    { code: 'RZ', measured: num(entry.rz_um), label: 'Rz' },
  ];

  for (const check of checks) {
    if (check.measured == null) continue;
    const verdict = await SpecResolverService.evaluate({
      versionId: resolved.versionId,
      parameterCode: check.code,
      measuredValue: check.measured,
    });
    // Persist catalog-driven QC row (fail-soft)
    try {
      const { QualitySpecService } = await import('../../../services/QualitySpecService');
      await QualitySpecService.saveQcMeasurement({
        coilNo: entry.coil_no,
        processCode: 'CRS',
        parameterCode: check.code,
        measuredValueNum: check.measured,
        versionId: resolved.versionId,
        verdict,
        entryId: entry.entry_id,
        measuredBy: 'SYSTEM',
      });
    } catch (err) {
      console.error('[validateCrsQuality] qc_measurement write failed safely:', err);
    }
    if (verdict === 'FAIL') failures.push(`${check.label} out of spec`);
  }

  return { pass: failures.length === 0, failures };
}

async function setCoilHold(coilNo: string): Promise<void> {
  await db.updateTable('coil.coil')
    .set({ status: 'HOLD' })
    .where('coil_no', '=', coilNo)
    .execute();

  const journey = await db.selectFrom('planning.order_journey')
    .select('journey_id')
    .where('coil_no', '=', coilNo)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();
  if (journey) {
    await db.updateTable('planning.order_journey')
      .set({ status: 'HOLD', updated_at: new Date() })
      .where('journey_id', '=', String(journey.journey_id))
      .execute();
  }
}

async function completeMotherStep(coilNo: string, processCode: string, conn: DbConn = db): Promise<void> {
  const journey = await conn.selectFrom('planning.order_journey')
    .select(['journey_id', 'current_step_no'])
    .where('coil_no', '=', coilNo)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();
  if (!journey) return;

  const now = new Date();
  await conn.updateTable('planning.order_journey_step')
    .set({ status: 'COMPLETED', completed_at: now })
    .where('journey_id', '=', String(journey.journey_id))
    .where('process_code', '=', processCode)
    .where('status', 'in', ['ACTIVE', 'PENDING'])
    .execute();

  const nextStep = await conn.selectFrom('planning.order_journey_step')
    .select('step_no')
    .where('journey_id', '=', String(journey.journey_id))
    .where('step_no', '>', journey.current_step_no)
    .where('status', '!=', 'SKIPPED')
    .orderBy('step_no', 'asc')
    .executeTakeFirst();

  if (nextStep) {
    await conn.updateTable('planning.order_journey')
      .set({ current_step_no: nextStep.step_no, updated_at: now })
      .where('journey_id', '=', String(journey.journey_id))
      .execute();
  } else {
    await conn.updateTable('planning.order_journey')
      .set({ status: 'COMPLETED', updated_at: now })
      .where('journey_id', '=', String(journey.journey_id))
      .execute();
  }
}

async function spawnChildCoils(
  motherCoilNo: string,
  processCode: string,
  slits: SlitSlotRow[],
  preferredNextRouteCode?: string,
  conn: DbConn = db,
): Promise<void> {
  const mother = await conn.selectFrom('coil.coil')
    .selectAll()
    .where('coil_no', '=', motherCoilNo)
    .executeTakeFirst();
  if (!mother) return;

  const journey = await conn.selectFrom('planning.order_journey')
    .select(['route_raw', 'journey_id'])
    .where('coil_no', '=', motherCoilNo)
    .where('status', 'in', ['ACTIVE', 'COMPLETED'])
    .orderBy('journey_id', 'desc')
    .executeTakeFirst();
  const routeRaw = journey?.route_raw ?? 'S-P-4-R-F-C-LE-PKG';

  const seen = new Set<string>();
  for (const slit of slits) {
    const label = (slit.slot ?? '').toUpperCase();
    if (!label) continue;
    const derived = derivedChildCoilNo(motherCoilNo, label);
    const stored = slit.child_coil_no?.trim() || '';
    const coilNo = derived; // Child coil number must be derived — never free-typed.
    if (stored && stored !== derived) {
      console.warn(`[JourneyAdvanceConsumer] stored child coil ${stored} != expected ${derived} (ignored)`);
    }
    const key = `${motherCoilNo}:${label}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate slit slot ${label} for coil ${motherCoilNo}`);
    }
    seen.add(key);

    const existing = await conn.selectFrom('coil.coil')
      .select('coil_no')
      .where('coil_no', '=', coilNo)
      .executeTakeFirst();

    const thk = resolveSlitThkMm(slit, mother.coil_thk_mm);
    const wt = resolveSlitWeightMt(slit, mother.weight_mt, slits);

    if (!existing) {
      await conn.insertInto('coil.coil')
        .values({
          coil_no: coilNo,
          grade_code: mother.grade_code,
          customer_id: mother.customer_id,
          parent_coil_no: motherCoilNo,
          nominal_width_mm: slit.width_mm ?? mother.nominal_width_mm,
          coil_width_mm: slit.width_mm ?? mother.coil_width_mm,
          coil_thk_mm: thk ?? mother.coil_thk_mm,
          weight_mt: wt,
          status: slit.hold_flag ? 'HOLD' : 'PLANNED',
        })
        .onConflict((oc) => oc.column('coil_no').doNothing())
        .execute();
    }

    // ponytail: HRS HOLD mints but does not spawn journey (plan §13)
    if (slit.hold_flag) continue;

    const lineRoute = (slit.route_raw?.trim() || routeRaw);
    let childRoute: string;
    if (processCode === 'HRS') {
      // Birth point: next step is usually P — never jump to LE/PKG preference
      childRoute = routeAfterStep(lineRoute, processCode);
    } else {
      const linePreferred =
        resolveCrsSlitPreferredRoute({
          holdFlag: false,
          forCtlFlag: slit.for_ctl_flag,
          routeCode: slit.route_code,
        }) ?? preferredNextRouteCode;
      childRoute = linePreferred
        ? routeAfterStepPreferred(lineRoute, processCode, linePreferred)
        : routeAfterStep(lineRoute, processCode);
    }

    await ProcessRouteService.createJourney(coilNo, childRoute, undefined, undefined, undefined, conn);
  }
}

async function handleSlittingAdvance(
  coilNo: string,
  processCode: string,
  entryId: string,
  conn: DbConn = db,
): Promise<void> {
  const slits = processCode === 'HRS'
    ? await loadHrsSlits(entryId, conn)
    : await loadCrsSlits(entryId, conn);

  const activeSlits = slits.filter((s) => s.width_mm != null || s.child_coil_no);
  if (activeSlits.length === 0) {
    await ProcessRouteService.advanceJourneyByCoil(coilNo, {});
    return;
  }

  await spawnChildCoils(coilNo, processCode, activeSlits, undefined, conn);
  await completeMotherStep(coilNo, processCode, conn);
}

async function handleCrsAdvance(coilNo: string, entryId: string): Promise<void> {
  const entry = await loadCrsEntry(entryId);
  if (!entry) {
    await ProcessRouteService.advanceJourneyByCoil(coilNo, {});
    return;
  }

  const quality = await validateCrsQuality(entry);
  if (!quality.pass) {
    console.warn(`[JourneyAdvanceConsumer] CRS quality gate failed for ${coilNo}:`, quality.failures);
  }

  const slits = await loadCrsSlits(entryId);
  const hasSlits = slits.some((s) => s.width_mm != null || s.child_coil_no);

  // Pass-level HOLD only when there is no fan-out; with slits, hold is per-line.
  if (!quality.pass && !hasSlits) {
    await setCoilHold(coilNo);
    return;
  }

  if (hasSlits) {
    const forCtlMt = entry.for_ctl_mt != null ? Number(entry.for_ctl_mt) : 0;
    const preferredNext = forCtlMt > 0 ? 'LE' : 'PKG';

    const journey = await db.selectFrom('planning.order_journey')
      .select(['journey_id', 'route_raw'])
      .where('coil_no', '=', coilNo)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (journey) {
      const steps = parseRouteString(journey.route_raw);
      const pkgIdx = steps.findIndex((s) => s.routeCode === 'PKG');
      const leIdx = steps.findIndex((s) => s.routeCode === 'LE');
      if (pkgIdx >= 0 && leIdx >= 0) {
        if (forCtlMt > 0) {
          if (pkgIdx < leIdx) {
            await db.updateTable('planning.order_journey_step')
              .set({ status: 'SKIPPED' })
              .where('journey_id', '=', String(journey.journey_id))
              .where('route_code', '=', 'PKG')
              .execute();
          }
        } else if (leIdx < pkgIdx) {
          await db.updateTable('planning.order_journey_step')
            .set({ status: 'SKIPPED' })
            .where('journey_id', '=', String(journey.journey_id))
            .where('route_code', '=', 'LE')
            .execute();
        }
      }
    }

    await db.transaction().execute(async (trx) => {
      await spawnChildCoils(coilNo, 'CRS', slits, preferredNext, trx);
      await completeMotherStep(coilNo, 'CRS', trx);
    });
    return;
  }

  const payload: CompletionPayload = {
    actualWeightMt: entry.output_wt_mt != null ? Number(entry.output_wt_mt) : undefined,
  };

  // For-CTL routing: block the undesired next route by marking it SKIPPED.
  // ProcessRouteService/completeMotherStep both skip SKIPPED steps when choosing next.
  const forCtlMt = entry.for_ctl_mt != null ? Number(entry.for_ctl_mt) : 0;
  const journey = await db.selectFrom('planning.order_journey')
    .select(['journey_id', 'route_raw'])
    .where('coil_no', '=', coilNo)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();
  if (journey) {
    const steps = parseRouteString(journey.route_raw);
    const pkgIdx = steps.findIndex((s) => s.routeCode === 'PKG');
    const leIdx = steps.findIndex((s) => s.routeCode === 'LE');
    if (pkgIdx >= 0 && leIdx >= 0) {
      if (forCtlMt > 0) {
        if (pkgIdx < leIdx) {
          await db.updateTable('planning.order_journey_step')
            .set({ status: 'SKIPPED' })
            .where('journey_id', '=', String(journey.journey_id))
            .where('route_code', '=', 'PKG')
            .execute();
        }
      } else {
        if (leIdx < pkgIdx) {
          await db.updateTable('planning.order_journey_step')
            .set({ status: 'SKIPPED' })
            .where('journey_id', '=', String(journey.journey_id))
            .where('route_code', '=', 'LE')
            .execute();
        }
      }
    }
  }

  await ProcessRouteService.advanceJourneyByCoil(coilNo, payload);
}

async function handleCaptured(payload: CapturedPayload): Promise<void> {
  const { processCode, entryId, coilNo } = payload;
  const code = processCode.toUpperCase();

  if (!ADVANCE_PROCESSES.has(code)) return;

  if (await isStepCompleted(coilNo, code)) {
    console.info(`[JourneyAdvanceConsumer] skip idempotent ${code} ${coilNo}`);
    return;
  }

  if (code === 'HRS') {
    await db.transaction().execute(async (trx) => {
      const entry = await loadHrsEntry(entryId, trx);
      if (entry?.scrap_mt != null) {
        const denom = Number(entry.mother_coil_weight_mt ?? entry.weight_mt);
        if (Number.isFinite(denom) && denom > 0) {
          const derived = calculateScrapPct(Number(entry.scrap_mt), denom);
          await trx.updateTable('txn.prod_hrs')
            .set({ scrap_pct: derived })
            .where('entry_id', '=', entryId)
            .execute();
        }
      }
      await handleSlittingAdvance(coilNo, 'HRS', entryId, trx);
    });
    return;
  }

  if (code === 'CRS') {
    await handleCrsAdvance(coilNo, entryId);
    return;
  }

  await ProcessRouteService.advanceJourneyByCoil(coilNo, {});
}

function scheduleRetry(key: string, payload: CapturedPayload): void {
  const attempt = pendingRetries.get(key) ?? 0;
  if (attempt >= RETRY_DELAYS_MS.length) {
    console.error(`[JourneyAdvanceConsumer] exhausted retries for ${key}`);
    pendingRetries.delete(key);
    return;
  }
  pendingRetries.set(key, attempt + 1);
  const delay = RETRY_DELAYS_MS[attempt];
  setTimeout(() => {
    void handleCaptured(payload).catch((err) => {
      console.error(`[JourneyAdvanceConsumer] retry failed for ${key}:`, err);
      scheduleRetry(key, payload);
    });
  }, delay).unref?.();
}

async function onProductionCaptured(envelope: EventEnvelope<CapturedPayload>): Promise<void> {
  const payload = envelope.payload;
  const key = envelope.key ?? `${payload.processCode}:${payload.entryId}`;

  try {
    await handleCaptured(payload);
    pendingRetries.delete(key);
  } catch (err) {
    console.error('[JourneyAdvanceConsumer] advance failed:', err);
    scheduleRetry(key, payload);
  }
}

let unsubscribe: (() => void) | null = null;

export function registerJourneyAdvanceConsumer(): () => void {
  if (unsubscribe) return unsubscribe;

  unsubscribe = getEventBus().subscribe('production.captured', (envelope) =>
    onProductionCaptured(envelope as EventEnvelope<CapturedPayload>),
  );

  console.info('[JourneyAdvanceConsumer] subscribed to production.captured');
  return unsubscribe;
}
