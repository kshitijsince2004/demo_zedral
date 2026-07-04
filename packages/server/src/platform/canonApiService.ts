import type { CanonicalEvent, CanonicalProductionCount } from '@zedral/platform';
import { db } from '../db';
import type { Json } from '../db-types';

export interface ProductionCountRequest {
  assetId: string;
  quantity: number;
  uom: string;
  countedAt: string;
  lineageRef: string;
  shiftLogId?: string;
  isScrap?: boolean;
}

export interface DowntimeEventRequest {
  assetId?: string;
  category: string;
  startedAt: string;
  endedAt?: string;
  durationMin?: number;
  lineageRef: string;
  payload: Readonly<Record<string, unknown>>;
}

function assertIsoDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid date-time`);
  }
  return date;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJson(value: Readonly<Record<string, unknown>>): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export function parseProductionCountRequest(body: unknown): ProductionCountRequest {
  if (!isObject(body)) throw new Error('Request body must be an object');

  const assetId = body.assetId;
  const quantity = body.quantity;
  const uom = body.uom ?? 'MT';
  const countedAt = body.countedAt;
  const lineageRef = body.lineageRef;
  const shiftLogId = body.shiftLogId;
  const isScrap = body.isScrap;

  if (typeof assetId !== 'string' || !assetId.trim()) throw new Error('assetId is required');
  if (typeof quantity !== 'number' || quantity <= 0) throw new Error('quantity must be greater than zero');
  if (typeof uom !== 'string' || !uom.trim()) throw new Error('uom is required');
  if (typeof countedAt !== 'string') throw new Error('countedAt is required');
  if (typeof lineageRef !== 'string' || !lineageRef.trim()) throw new Error('lineageRef is required');
  if (shiftLogId !== undefined && typeof shiftLogId !== 'string') throw new Error('shiftLogId must be a string');
  if (isScrap !== undefined && typeof isScrap !== 'boolean') throw new Error('isScrap must be boolean');
  assertIsoDate(countedAt, 'countedAt');

  return {
    assetId: assetId.trim(),
    quantity,
    uom: uom.trim(),
    countedAt,
    lineageRef: lineageRef.trim(),
    shiftLogId,
    isScrap,
  };
}

export function parseDowntimeEventRequest(body: unknown): DowntimeEventRequest {
  if (!isObject(body)) throw new Error('Request body must be an object');

  const assetId = body.assetId;
  const category = body.category;
  const startedAt = body.startedAt;
  const endedAt = body.endedAt;
  const durationMin = body.durationMin;
  const lineageRef = body.lineageRef;
  const payload = body.payload;

  if (assetId !== undefined && typeof assetId !== 'string') throw new Error('assetId must be a string');
  if (typeof category !== 'string' || !category.trim()) throw new Error('category is required');
  if (typeof startedAt !== 'string') throw new Error('startedAt is required');
  if (endedAt !== undefined && typeof endedAt !== 'string') throw new Error('endedAt must be a date-time string');
  if (durationMin !== undefined && (typeof durationMin !== 'number' || durationMin < 0)) {
    throw new Error('durationMin must be a non-negative number');
  }
  if (typeof lineageRef !== 'string' || !lineageRef.trim()) throw new Error('lineageRef is required');
  if (!isObject(payload)) throw new Error('payload must be an object');
  assertIsoDate(startedAt, 'startedAt');
  if (endedAt) assertIsoDate(endedAt, 'endedAt');

  return {
    assetId,
    category: category.trim(),
    startedAt,
    endedAt,
    durationMin,
    lineageRef: lineageRef.trim(),
    payload,
  };
}

export async function createProductionCount(
  tenantId: string,
  input: ProductionCountRequest,
): Promise<CanonicalProductionCount> {
  const row = await db
    .insertInto('canon.production_count')
    .values({
      tenant_id: tenantId,
      asset_id: input.assetId,
      quantity: input.quantity,
      uom: input.uom,
      counted_at: assertIsoDate(input.countedAt, 'countedAt'),
      lineage_ref: input.lineageRef,
      shift_log_id: input.shiftLogId ?? null,
      is_scrap: input.isScrap ?? false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    countId: row.count_id,
    tenantId: row.tenant_id,
    assetId: row.asset_id ?? input.assetId,
    quantity: Number(row.quantity),
    uom: row.uom,
    countedAt: row.counted_at.toISOString(),
    lineageRef: row.lineage_ref,
    shiftLogId: row.shift_log_id ? String(row.shift_log_id) : undefined,
    isScrap: row.is_scrap,
  };
}

export async function createDowntimeEvent(
  tenantId: string,
  input: DowntimeEventRequest,
): Promise<CanonicalEvent> {
  const row = await db
    .insertInto('canon.event')
    .values({
      tenant_id: tenantId,
      event_type: 'downtime',
      asset_id: input.assetId ?? null,
      category: input.category,
      started_at: assertIsoDate(input.startedAt, 'startedAt'),
      ended_at: input.endedAt ? assertIsoDate(input.endedAt, 'endedAt') : null,
      duration_min: input.durationMin ?? null,
      lineage_ref: input.lineageRef,
      payload: toJson(input.payload),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    assetId: row.asset_id ?? undefined,
    category: row.category ?? undefined,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString(),
    durationMin: row.duration_min ?? undefined,
    lineageRef: row.lineage_ref,
    payload: input.payload,
  };
}
