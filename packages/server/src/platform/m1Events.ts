import { canonicalWriteback, buildEventEnvelope, getEventBus } from '@zedral/platform';
import { db } from '../db';
import { getTenantId } from '../context';
import { findEquipmentAssetIdByProcessCode, findFirstEquipmentAssetId } from './canonicalRead';

const PROCESS_ASSET_MAP: Record<string, string> = {
  '6HI': '101',
  '4HI': '102',
  '2HI': '103',
  CRM: '101',
};

function requireTenantId(): string {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error('Tenant context is required for M1 event publication');
  }
  return tenantId;
}

function dateAtClockTime(prodDate: Date, time: string): Date {
  const [hourRaw, minuteRaw] = time.slice(0, 5).split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return new Date(prodDate.getFullYear(), prodDate.getMonth(), prodDate.getDate(), hour, minute, 0, 0);
}

async function resolveProcessCode(processId: number): Promise<string | null> {
  const row = await db
    .selectFrom('master.process')
    .select('code')
    .where('process_id', '=', processId)
    .executeTakeFirst();
  return row?.code ?? null;
}

export async function resolveAssetIdForShiftLog(shiftLogId: string): Promise<string> {
  const log = await db
    .selectFrom('txn.shift_log as sl')
    .innerJoin('master.process as p', 'p.process_id', 'sl.process_id')
    .select(['p.code'])
    .where('sl.shift_log_id', '=', shiftLogId)
    .executeTakeFirst();

  const processCode = log?.code;
  if (processCode && PROCESS_ASSET_MAP[processCode]) {
    return PROCESS_ASSET_MAP[processCode];
  }

  if (processCode) {
    const assetId = await findEquipmentAssetIdByProcessCode(processCode);
    if (assetId) return assetId;
  }

  const fallback = await findFirstEquipmentAssetId();
  if (!fallback) {
    throw new Error('No canonical equipment node is available for M1 write-back');
  }
  return fallback;
}

export async function resolveStoppageCategory(
  stoppageCode: string,
): Promise<'MECH' | 'ELECT' | 'UTILITY'> {
  const row = await db
    .selectFrom('master.stoppage_code')
    .select('category')
    .where('stoppage_code', '=', stoppageCode)
    .executeTakeFirst();

  const raw = row?.category?.toUpperCase() ?? stoppageCode.toUpperCase();
  if (raw.includes('ELECT') || raw.startsWith('EL')) return 'ELECT';
  if (raw.includes('UTILITY') || raw.startsWith('UT')) return 'UTILITY';
  return 'MECH';
}

export async function publishProductionCounted(input: {
  shiftLogId?: string;
  assetId: string;
  quantity: number;
  uom?: string;
  countedAt?: Date;
}): Promise<void> {
  const tenantId = requireTenantId();
  const countedAt = input.countedAt ?? new Date();
  const lineageRef = input.shiftLogId ? `shift_log:${input.shiftLogId}` : `asset:${input.assetId}`;
  const count = await canonicalWriteback.createProductionCount(tenantId, {
    assetId: input.assetId,
    quantity: input.quantity,
    uom: input.uom ?? 'MT',
    countedAt: countedAt.toISOString(),
    lineageRef,
    shiftLogId: input.shiftLogId,
  });

  await getEventBus().publish(
    buildEventEnvelope({
      type: 'production.counted',
      tenantId,
      key: `${tenantId}:production.counted:${count.countId}`,
      lineageRef,
      occurredAt: countedAt,
      payload: {
        countId: count.countId,
        shiftLogId: input.shiftLogId,
        assetId: input.assetId,
        quantity: input.quantity,
        uom: input.uom ?? 'MT',
        countedAt: countedAt.toISOString(),
        lineageRef,
      },
    }),
  );
}

export async function publishShiftClosed(input: {
  shiftLogId: string;
  processId: number;
  totalProdMt: number;
  closedAt?: Date;
}): Promise<void> {
  const tenantId = requireTenantId();
  const closedAt = input.closedAt ?? new Date();
  await getEventBus().publish(
    buildEventEnvelope({
      type: 'shift.closed',
      tenantId,
      key: `${tenantId}:shift.closed:${input.shiftLogId}`,
      lineageRef: `shift_log:${input.shiftLogId}`,
      occurredAt: closedAt,
      payload: {
        shiftLogId: input.shiftLogId,
        processId: input.processId,
        totalProdMt: input.totalProdMt,
        closedAt: closedAt.toISOString(),
      },
    }),
  );

  if (input.totalProdMt > 0) {
    await publishProductionCounted({
      shiftLogId: input.shiftLogId,
      assetId: await resolveAssetIdForShiftLog(input.shiftLogId),
      quantity: input.totalProdMt,
      countedAt: closedAt,
    });
  }
}

export async function publishDowntimeLogged(input: {
  stoppageId: string;
  shiftLogId: string;
  stoppageCode: string;
  fromTime: string;
  toTime: string;
  durationMin: number;
  prodDate: Date;
}): Promise<void> {
  const tenantId = requireTenantId();
  const category = await resolveStoppageCategory(input.stoppageCode);
  const assetId = await resolveAssetIdForShiftLog(input.shiftLogId);
  const startedAt = dateAtClockTime(input.prodDate, input.fromTime);
  let endedAt = dateAtClockTime(input.prodDate, input.toTime);
  if (endedAt.getTime() <= startedAt.getTime()) {
    endedAt = new Date(endedAt.getTime() + 24 * 60 * 60 * 1000);
  }
  const lineageRef = `stoppage:${input.stoppageId}`;

  await canonicalWriteback.createDowntimeEvent(tenantId, {
    assetId,
    category,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMin: input.durationMin,
    lineageRef,
    payload: {
      stoppageId: input.stoppageId,
      shiftLogId: input.shiftLogId,
      stoppageCode: input.stoppageCode,
    },
  });

  await getEventBus().publish(
    buildEventEnvelope({
      type: 'downtime.logged',
      tenantId,
      key: `${tenantId}:downtime.logged:${input.stoppageId}`,
      lineageRef,
      occurredAt: startedAt,
      payload: {
        stoppageId: input.stoppageId,
        shiftLogId: input.shiftLogId,
        stoppageCode: input.stoppageCode,
        category,
        fromTime: input.fromTime,
        toTime: input.toTime,
        durationMin: input.durationMin,
        prodDate: input.prodDate.toISOString().slice(0, 10),
        lineageRef,
      },
    }),
  );
}

export async function publishDefectLogged(input: {
  defectId: string;
  processId: number;
  entryId: string;
  coilNo?: string;
  defectCode: string;
  quantityMt?: number;
}): Promise<void> {
  const tenantId = requireTenantId();
  const processCode = await resolveProcessCode(input.processId);
  await getEventBus().publish(
    buildEventEnvelope({
      type: 'defect.logged',
      tenantId,
      key: `${tenantId}:defect.logged:${input.defectId}`,
      lineageRef: `defect:${input.defectId}`,
      payload: {
        defectId: input.defectId,
        processId: input.processId,
        processCode,
        entryId: input.entryId,
        coilNo: input.coilNo,
        defectCode: input.defectCode,
        quantityMt: input.quantityMt,
      },
    }),
  );
}
