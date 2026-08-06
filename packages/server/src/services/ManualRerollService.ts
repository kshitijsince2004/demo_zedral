import { sql } from 'kysely';
import { db } from '../db';
import { assertCombineEligible } from '../utils/orderLifecycleHelpers';
import { SixHiService } from './SixHiService';
import { MachineStateEventService } from './MachineStateEventService';
import type { ManualRerollMachine } from '@m1/shared-validation';

export const ACTIVE_REROLL_CONFLICT = 'ACTIVE_REROLL_CONFLICT';

/** Blocks new CRM / re-roll starts on the mill. */
export const BLOCKING_REROLL_STATUSES = ['IN_PROGRESS', 'STOPPAGE'] as const;
/** Includes Hold queue sessions (machine stays idle / free for other work). */
export const OPEN_REROLL_STATUSES = ['IN_PROGRESS', 'ON_HOLD', 'STOPPAGE'] as const;
/** Sessions that keep CRM batches out of the Manual Re-Roll pending list. */
export const CLAIMED_REROLL_STATUSES = ['IN_PROGRESS', 'ON_HOLD', 'STOPPAGE', 'COMPLETED'] as const;
export type OpenRerollStatus = (typeof OPEN_REROLL_STATUSES)[number];

export function computeDurationMin(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export interface ManualRerollStoppageDto {
  stoppageId: string;
  sessionId: string;
  machineCode: string;
  categoryCode: string;
  stoppageCode: string | null;
  remarks: string | null;
  startTime: string;
  endTime: string | null;
  durationMin: number | null;
}

export interface ManualRerollSessionDto {
  sessionId: string;
  orderId: string | null;
  batchNumber: string | null;
  batchNumbers: string[];
  machineCode: string;
  machineType: string;
  operatorId: number;
  shiftCode: string | null;
  rerollQuantity: number | null;
  status: string;
  remarks: string | null;
  startTime: string;
  endTime: string | null;
  durationMin: number | null;
  activeStoppage?: ManualRerollStoppageDto | null;
  stoppages?: ManualRerollStoppageDto[];
}

/** Open overlay session used by LiveService machine cards. */
export interface OpenManualRerollLiveRow {
  machineCode: string;
  sessionId: string;
  status: string;
  batchNumber: string | null;
  batchNumbers: string[];
  startTime: string;
  operatorName: string | null;
  shiftCode: string | null;
  stoppageCategory: string | null;
  stoppageRemarks: string | null;
  stoppageStartAt: string | null;
  stoppageLabel: string | null;
}

export interface ManualRerollSummary {
  machineCode: string;
  from: string;
  to: string;
  shiftCode?: string;
  totalRerollMt: number;
  sessionCount: number;
  byShift: Array<{ shiftCode: string | null; totalRerollMt: number; sessionCount: number }>;
  byOrder: Array<{
    orderId: string | null;
    batchNumber: string | null;
    totalRerollMt: number;
    sessionCount: number;
  }>;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const COMBINED_TAG = /\[\[batches:([^\]]+)\]\]/;

/** @deprecated Prefer batch_numbers column; kept for legacy rows / tests. */
export function encodeCombinedBatches(batchNumbers: string[], remarks?: string): string | null {
  const unique = [...new Set(batchNumbers.map((b) => b.trim()).filter(Boolean))];
  const tag = unique.length > 1 ? `[[batches:${unique.join(',')}]]` : '';
  const text = [tag, remarks?.trim()].filter(Boolean).join('\n');
  return text || null;
}

export function decodeCombinedBatches(batchNumber: string | null, remarks: string | null): string[] {
  const match = remarks?.match(COMBINED_TAG);
  if (match) return match[1].split(',').map((part) => part.trim()).filter(Boolean);
  return batchNumber ? [batchNumber] : [];
}

export function stripCombinedTag(remarks: string | null | undefined): string | null {
  if (!remarks) return null;
  const text = remarks.replace(/\[\[batches:[^\]]+\]\]\n?/g, '').trim();
  return text || null;
}

function normalizeBatchNumbers(
  primary: string | null | undefined,
  batchNumbers?: string[] | null | string,
  remarks?: string | null,
): string[] {
  if (Array.isArray(batchNumbers) && batchNumbers.length > 0) {
    return [...new Set(batchNumbers.map((b) => String(b).trim()).filter(Boolean))];
  }
  // pg may return text[] as "{a,b}" in some drivers / raw paths
  if (typeof batchNumbers === 'string' && batchNumbers.trim()) {
    const raw = batchNumbers.trim();
    if (raw.startsWith('{') && raw.endsWith('}')) {
      const inner = raw.slice(1, -1);
      if (inner) {
        return [...new Set(inner.split(',').map((p) => p.replace(/^"|"$/g, '').trim()).filter(Boolean))];
      }
    }
  }
  return decodeCombinedBatches(primary ?? null, remarks ?? null);
}

/** Expand session rows into the set of batch numbers claimed from the pending queue. */
export function buildClaimedBatchSet(
  rows: Array<{
    batch_number?: string | null;
    batch_numbers?: string[] | null | string;
    remarks?: string | null;
  }>,
): Set<string> {
  const claimed = new Set<string>();
  for (const row of rows) {
    for (const b of normalizeBatchNumbers(row.batch_number, row.batch_numbers, row.remarks)) {
      claimed.add(b);
    }
  }
  return claimed;
}

function mapStoppage(row: {
  stoppage_id: string | number | bigint;
  session_id: string | number | bigint;
  machine_code: string;
  category_code: string;
  stoppage_code: string | null;
  remarks: string | null;
  start_time: Date | string;
  end_time: Date | string | null;
  duration_min: number | null;
}): ManualRerollStoppageDto {
  return {
    stoppageId: String(row.stoppage_id),
    sessionId: String(row.session_id),
    machineCode: row.machine_code,
    categoryCode: row.category_code,
    stoppageCode: row.stoppage_code,
    remarks: row.remarks,
    startTime: toIso(row.start_time) ?? new Date().toISOString(),
    endTime: toIso(row.end_time),
    durationMin: row.duration_min,
  };
}

function mapSession(row: {
  session_id: string | number | bigint;
  order_id: string | number | bigint | null;
  batch_number: string | null;
  batch_numbers?: string[] | null;
  machine_code: string;
  machine_type: string;
  operator_id: number;
  shift_code: string | null;
  reroll_quantity: string | number | null;
  status: string;
  remarks: string | null;
  start_time: Date | string;
  end_time: Date | string | null;
  duration_min: number | null;
}, extras?: { activeStoppage?: ManualRerollStoppageDto | null; stoppages?: ManualRerollStoppageDto[] }): ManualRerollSessionDto {
  return {
    sessionId: String(row.session_id),
    orderId: row.order_id == null ? null : String(row.order_id),
    batchNumber: row.batch_number,
    batchNumbers: normalizeBatchNumbers(row.batch_number, row.batch_numbers, row.remarks),
    machineCode: row.machine_code,
    machineType: row.machine_type,
    operatorId: row.operator_id,
    shiftCode: row.shift_code,
    rerollQuantity: row.reroll_quantity == null ? null : Number(row.reroll_quantity),
    status: row.status,
    remarks: stripCombinedTag(row.remarks),
    startTime: toIso(row.start_time) ?? new Date().toISOString(),
    endTime: toIso(row.end_time),
    durationMin: row.duration_min,
    activeStoppage: extras?.activeStoppage ?? null,
    stoppages: extras?.stoppages,
  };
}

function fireMachineEvent(
  machineCode: string,
  eventType: Parameters<typeof MachineStateEventService.recordEvent>[1],
  opts: Parameters<typeof MachineStateEventService.recordEvent>[2] = {},
): void {
  MachineStateEventService.recordEvent(machineCode, eventType, opts).catch((err) => {
    console.error(`[MachineStateEvent] ${eventType} (manual reroll) failed:`, err);
  });
}

function eventOptsForSession(row: {
  session_id: string | number | bigint;
  order_id?: string | number | bigint | null;
  batch_number: string | null;
  batch_numbers?: string[] | null;
  remarks?: string | null;
  operator_id: number;
  shift_code: string | null;
}, extraMeta?: Record<string, unknown>) {
  const batchNumbers = normalizeBatchNumbers(row.batch_number, row.batch_numbers, row.remarks);
  return {
    orderId: row.order_id == null ? undefined : String(row.order_id),
    batchNumber: row.batch_number ?? batchNumbers[0],
    operatorId: row.operator_id,
    shiftCode: row.shift_code ?? undefined,
    meta: {
      source: 'MANUAL_REROLL',
      sessionId: String(row.session_id),
      ...(batchNumbers.length > 1 ? { combinedRunBatchNumbers: batchNumbers } : {}),
      ...extraMeta,
    },
  };
}

let tableReady: Promise<void> | null = null;

async function ensureManualRerollTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS txn.manual_reroll_session (
          session_id        BIGSERIAL PRIMARY KEY,
          tenant_id         UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                            REFERENCES security.tenant(tenant_id),
          order_id          BIGINT,
          batch_number      VARCHAR(64),
          machine_code      VARCHAR(32) NOT NULL,
          machine_type      VARCHAR(16) NOT NULL,
          operator_id       INTEGER NOT NULL REFERENCES security.app_user(user_id),
          shift_code        VARCHAR(16),
          reroll_quantity   NUMERIC(12,3),
          status            VARCHAR(24) NOT NULL DEFAULT 'IN_PROGRESS',
          remarks           TEXT,
          start_time        TIMESTAMPTZ NOT NULL DEFAULT now(),
          end_time          TIMESTAMPTZ,
          duration_min      INTEGER,
          created_by        INTEGER NOT NULL REFERENCES security.app_user(user_id),
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `.execute(db);
      await sql`
        ALTER TABLE txn.manual_reroll_session
          ADD COLUMN IF NOT EXISTS batch_numbers TEXT[]
      `.execute(db);
      await sql`
        CREATE TABLE IF NOT EXISTS txn.manual_reroll_stoppage (
          stoppage_id     BIGSERIAL PRIMARY KEY,
          tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                          REFERENCES security.tenant(tenant_id),
          session_id      BIGINT NOT NULL REFERENCES txn.manual_reroll_session(session_id) ON DELETE CASCADE,
          machine_code    VARCHAR(32) NOT NULL,
          category_code   VARCHAR(64) NOT NULL,
          stoppage_code   VARCHAR(64),
          remarks         TEXT,
          operator_id     INTEGER REFERENCES security.app_user(user_id),
          start_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
          end_time        TIMESTAMPTZ,
          duration_min    INTEGER,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `.execute(db);
      await sql`
        DROP INDEX IF EXISTS txn.uq_manual_reroll_session_active_machine
      `.execute(db);
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_reroll_session_active_machine
          ON txn.manual_reroll_session (machine_code)
          WHERE status IN ('IN_PROGRESS','STOPPAGE')
      `.execute(db);
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_reroll_stoppage_open_session
          ON txn.manual_reroll_stoppage (session_id)
          WHERE end_time IS NULL
      `.execute(db);
      await sql`
        DO $chk$
        DECLARE r RECORD;
        BEGIN
          FOR r IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'txn'
              AND t.relname = 'manual_reroll_session'
              AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) ILIKE '%status%'
          LOOP
            EXECUTE format('ALTER TABLE txn.manual_reroll_session DROP CONSTRAINT IF EXISTS %I', r.conname);
          END LOOP;
          ALTER TABLE txn.manual_reroll_session
            ADD CONSTRAINT manual_reroll_session_status_check
            CHECK (status IN ('IN_PROGRESS','ON_HOLD','STOPPAGE','COMPLETED','CANCELLED'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $chk$;
      `.execute(db);
    })().catch((err: unknown) => {
      tableReady = null;
      throw err;
    });
  }
  try {
    await tableReady;
  } catch {
    // Tests / no-DDL still proceed; insert will surface a real missing-table error.
  }
}

async function loadStoppages(sessionId: string): Promise<ManualRerollStoppageDto[]> {
  const rows = await db
    .selectFrom('txn.manual_reroll_stoppage' as any)
    .selectAll()
    .where('session_id', '=', sessionId)
    .orderBy('start_time', 'asc')
    .execute();
  return rows.map((r: any) => mapStoppage(r));
}

async function loadActiveStoppage(sessionId: string): Promise<ManualRerollStoppageDto | null> {
  const row = await db
    .selectFrom('txn.manual_reroll_stoppage' as any)
    .selectAll()
    .where('session_id', '=', sessionId)
    .where('end_time', 'is', null)
    .executeTakeFirst();
  return row ? mapStoppage(row as any) : null;
}

function sumStoppageMinutes(stoppages: ManualRerollStoppageDto[], until: Date): number {
  let total = 0;
  for (const s of stoppages) {
    const start = new Date(s.startTime);
    const end = s.endTime ? new Date(s.endTime) : until;
    total += Math.max(0, computeDurationMin(start, end));
  }
  return total;
}

export class ManualRerollService {
  /** Session that blocks starting CRM production or another re-roll (running / stoppage). */
  static async getActiveSession(machineCode: string): Promise<ManualRerollSessionDto | null> {
    await ensureManualRerollTable();
    const row = await db
      .selectFrom('txn.manual_reroll_session')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .where('status', 'in', [...BLOCKING_REROLL_STATUSES])
      .executeTakeFirst();
    if (!row) return null;
    const stoppages = await loadStoppages(String(row.session_id));
    const activeStoppage = stoppages.find((s) => !s.endTime) ?? null;
    return mapSession(row as any, { activeStoppage, stoppages });
  }

  /** Open hold on this mill (Hold queue / StatusRail), if any. */
  static async getHeldSession(machineCode: string): Promise<ManualRerollSessionDto | null> {
    await ensureManualRerollTable();
    const row = await db
      .selectFrom('txn.manual_reroll_session')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .where('status', '=', 'ON_HOLD')
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
    if (!row) return null;
    return mapSession(row as any, { activeStoppage: null, stoppages: await loadStoppages(String(row.session_id)) });
  }

  static async assertNoActiveReroll(machineCode: string): Promise<void> {
    const active = await this.getActiveSession(machineCode);
    if (active) throw new Error(ACTIVE_REROLL_CONFLICT);
  }

  /** Overlay combine validation — planning.ppc_batch only (no CRM writes). */
  static async assertCompatibleBatches(machine: string, batchNumbers: string[]): Promise<void> {
    const unique = [...new Set(batchNumbers.map((b) => b.trim()).filter(Boolean))];
    if (unique.length <= 1) return;

    const batches = await db
      .selectFrom('planning.ppc_batch')
      .select([
        'batch_number',
        'coil_no',
        'slit_id',
        'roll_finish',
        'machine_code',
        'machine_allocated',
        'sub_process',
      ])
      .where('batch_number', 'in', unique)
      .execute();

    if (batches.length !== unique.length) {
      throw new Error('One or more selected orders were not found');
    }
    for (const batch of batches) {
      if (batch.machine_code !== machine) {
        throw new Error('Combined production orders must be assigned to the same machine');
      }
    }
    // Overlay re-roll: machine_code already scoped to this mill. Do not require
    // CRM machine_allocated (PENDING rows are often unallocated but still on the mill plan).
    assertCombineEligible(
      batches.map((b) => ({
        machineCode: b.machine_code,
        machineAllocated: true,
        coilNo: b.coil_no,
        slitId: b.slit_id,
        rollFinish: b.roll_finish,
        subProcess: b.sub_process,
      })),
      { requireSameSubProcess: true },
    );
  }

  /** Open sessions for LiveService machine cards (keyed by machine). */
  static async listOpenSessionsForMachines(machineCodes: string[]): Promise<OpenManualRerollLiveRow[]> {
    if (machineCodes.length === 0) return [];
    await ensureManualRerollTable();
    const rows = await db
      .selectFrom('txn.manual_reroll_session as s')
      .leftJoin('security.app_user as u', 'u.user_id', 's.operator_id')
      .leftJoin('txn.manual_reroll_stoppage as st', (join) =>
        join.onRef('st.session_id', '=', 's.session_id').on('st.end_time', 'is', null))
      .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'st.category_code')
      .select([
        's.session_id',
        's.machine_code',
        's.status',
        's.batch_number',
        's.batch_numbers',
        's.remarks',
        's.start_time',
        's.shift_code',
        'u.full_name as operator_name',
        'st.category_code as stoppage_category',
        'st.remarks as stoppage_remarks',
        'st.start_time as stoppage_start_at',
        'sc.label as stoppage_label',
      ])
      .where('s.machine_code', 'in', machineCodes)
      .where('s.status', 'in', [...OPEN_REROLL_STATUSES])
      .execute();

    return rows.map((row: any) => ({
      machineCode: row.machine_code,
      sessionId: String(row.session_id),
      status: row.status,
      batchNumber: row.batch_number,
      batchNumbers: normalizeBatchNumbers(row.batch_number, row.batch_numbers, row.remarks),
      startTime: toIso(row.start_time) ?? new Date().toISOString(),
      operatorName: row.operator_name ?? null,
      shiftCode: row.shift_code,
      stoppageCategory: row.stoppage_category ?? null,
      stoppageRemarks: row.stoppage_remarks ?? null,
      stoppageStartAt: toIso(row.stoppage_start_at),
      stoppageLabel: row.stoppage_label ?? null,
    }));
  }

  static async startSession(input: {
    machine: ManualRerollMachine;
    batchNumber: string;
    batchNumbers?: string[];
    orderId?: string | number | null;
    rerollQuantity?: number | null;
    remarks?: string;
    operatorId: number;
    shiftCode?: string | null;
  }): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    const activeOrder = await SixHiService.findActiveMachineOrder(input.machine);
    if (activeOrder) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${activeOrder.batchNumber}`);
    }

    const existing = await this.getActiveSession(input.machine);
    if (existing) throw new Error(ACTIVE_REROLL_CONFLICT);

    const batches = normalizeBatchNumbers(
      input.batchNumber,
      input.batchNumbers?.length ? input.batchNumbers : [input.batchNumber],
    );
    await this.assertCompatibleBatches(input.machine, batches);

    const row = await db
      .insertInto('txn.manual_reroll_session')
      .values({
        order_id: input.orderId == null ? null : String(input.orderId),
        batch_number: input.batchNumber,
        batch_numbers: sql`ARRAY[${sql.join(batches.map((b) => sql`${b}`))}]::text[]`,
        machine_code: input.machine,
        machine_type: input.machine,
        operator_id: input.operatorId,
        shift_code: input.shiftCode ?? null,
        reroll_quantity: input.rerollQuantity ?? null,
        status: 'IN_PROGRESS',
        remarks: input.remarks?.trim() || null,
        created_by: input.operatorId,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    fireMachineEvent(input.machine, 'RUNNING_STARTED', eventOptsForSession(row as any));
    return mapSession(row as any, { activeStoppage: null, stoppages: [] });
  }

  static async holdSession(sessionId: string, remarks: string): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    const reason = remarks.trim();
    if (!reason) throw new Error('HOLD_REMARKS_REQUIRED');
    const current = await this.requireSession(sessionId);
    if (current.status !== 'IN_PROGRESS') throw new Error('SESSION_NOT_RUNNING');

    const row = await db
      .updateTable('txn.manual_reroll_session')
      .set({ status: 'ON_HOLD', remarks: reason, updated_at: new Date() })
      .where('session_id', '=', sessionId)
      .where('status', '=', 'IN_PROGRESS')
      .returningAll()
      .executeTakeFirstOrThrow();

    fireMachineEvent(current.machine_code, 'RUNNING_ENDED', eventOptsForSession(current as any));
    fireMachineEvent(current.machine_code, 'IDLE_STARTED', {
      ...eventOptsForSession(current as any),
      reason: reason || 'Manual re-roll on hold',
    });
    return mapSession(row as any);
  }

  static async resumeSession(sessionId: string): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    const current = await this.requireSession(sessionId);
    if (current.status !== 'ON_HOLD') throw new Error('SESSION_NOT_ON_HOLD');

    const row = await db
      .updateTable('txn.manual_reroll_session')
      .set({ status: 'IN_PROGRESS', updated_at: new Date() })
      .where('session_id', '=', sessionId)
      .where('status', '=', 'ON_HOLD')
      .returningAll()
      .executeTakeFirstOrThrow();

    fireMachineEvent(current.machine_code, 'RUNNING_STARTED', eventOptsForSession(row as any));
    return mapSession(row as any);
  }

  /**
   * Close an ON_HOLD session so the machine is free and the batch can be
   * started again from the Pending queue (overlay does not mutate CRM).
   */
  static async releaseToPending(sessionId: string, operatorId: number): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    const current = await this.requireSession(sessionId);
    if (current.status !== 'ON_HOLD') throw new Error('SESSION_NOT_ON_HOLD');
    return this.closeSession(sessionId, operatorId, 'CANCELLED', current.remarks ?? undefined);
  }

  static async updateRemarks(sessionId: string, remarks: string): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    await this.requireOpenSession(sessionId);
    const row = await db
      .updateTable('txn.manual_reroll_session')
      .set({
        remarks: remarks.trim() || null,
        updated_at: new Date(),
      })
      .where('session_id', '=', sessionId)
      .where('status', 'in', [...OPEN_REROLL_STATUSES])
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapSession(row as any);
  }

  static async startStoppage(input: {
    sessionId: string;
    categoryCode: string;
    stoppageCode?: string;
    remarks?: string;
    operatorId: number;
  }): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    const current = await this.requireSession(input.sessionId);
    if (current.status !== 'IN_PROGRESS') throw new Error('SESSION_NOT_RUNNING');
    const existing = await loadActiveStoppage(input.sessionId);
    if (existing) throw new Error('STOPPAGE_ALREADY_OPEN');

    await db
      .insertInto('txn.manual_reroll_stoppage' as any)
      .values({
        session_id: input.sessionId,
        machine_code: current.machine_code,
        category_code: input.categoryCode,
        stoppage_code: input.stoppageCode ?? null,
        remarks: input.remarks?.trim() || null,
        operator_id: input.operatorId,
      })
      .execute();

    await db
      .updateTable('txn.manual_reroll_session')
      .set({ status: 'STOPPAGE', updated_at: new Date() })
      .where('session_id', '=', input.sessionId)
      .execute();

    fireMachineEvent(current.machine_code, 'STOPPAGE_STARTED', {
      ...eventOptsForSession(current as any),
      categoryCode: input.categoryCode,
      reason: input.remarks?.trim() || input.stoppageCode || input.categoryCode,
    });

    return (await this.getSessionById(input.sessionId))!;
  }

  static async updateStoppage(input: {
    sessionId: string;
    stoppageId: string;
    categoryCode: string;
    stoppageCode?: string;
    remarks?: string;
  }): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    await this.requireOpenSession(input.sessionId);
    const updated = await db
      .updateTable('txn.manual_reroll_stoppage' as any)
      .set({
        category_code: input.categoryCode,
        stoppage_code: input.stoppageCode ?? null,
        remarks: input.remarks !== undefined ? (input.remarks.trim() || null) : undefined,
        updated_at: new Date(),
      })
      .where('stoppage_id', '=', input.stoppageId)
      .where('session_id', '=', input.sessionId)
      .returningAll()
      .executeTakeFirst();
    if (!updated) throw new Error('STOPPAGE_NOT_FOUND');
    return (await this.getSessionById(input.sessionId))!;
  }

  static async endStoppage(input: {
    sessionId: string;
    stoppageId: string;
    categoryCode?: string;
    stoppageCode?: string;
    remarks?: string;
  }): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    const session = await this.requireOpenSession(input.sessionId);
    const current = await db
      .selectFrom('txn.manual_reroll_stoppage' as any)
      .selectAll()
      .where('stoppage_id', '=', input.stoppageId)
      .where('session_id', '=', input.sessionId)
      .executeTakeFirst();
    if (!current) throw new Error('STOPPAGE_NOT_FOUND');
    if (current.end_time != null) throw new Error('STOPPAGE_ALREADY_CLOSED');

    const endTime = new Date();
    const startTime = current.start_time instanceof Date ? current.start_time : new Date(current.start_time);
    const durationMin = computeDurationMin(startTime, endTime);

    await db
      .updateTable('txn.manual_reroll_stoppage' as any)
      .set({
        end_time: endTime,
        duration_min: durationMin,
        category_code: input.categoryCode ?? current.category_code,
        stoppage_code: input.stoppageCode !== undefined ? input.stoppageCode : current.stoppage_code,
        remarks: input.remarks !== undefined ? (input.remarks.trim() || null) : current.remarks,
        updated_at: endTime,
      })
      .where('stoppage_id', '=', input.stoppageId)
      .execute();

    await db
      .updateTable('txn.manual_reroll_session')
      .set({ status: 'IN_PROGRESS', updated_at: endTime })
      .where('session_id', '=', input.sessionId)
      .where('status', '=', 'STOPPAGE')
      .execute();

    fireMachineEvent(session.machine_code, 'STOPPAGE_ENDED', eventOptsForSession(session as any));
    fireMachineEvent(session.machine_code, 'RUNNING_STARTED', eventOptsForSession(session as any));

    return (await this.getSessionById(input.sessionId))!;
  }

  static async endSession(
    sessionId: string,
    operatorId: number,
    remarks?: string,
  ): Promise<ManualRerollSessionDto> {
    return this.closeSession(sessionId, operatorId, 'COMPLETED', remarks);
  }

  static async cancelSession(
    sessionId: string,
    operatorId: number,
    remarks?: string,
  ): Promise<ManualRerollSessionDto> {
    return this.closeSession(sessionId, operatorId, 'CANCELLED', remarks);
  }

  private static async closeSession(
    sessionId: string,
    _operatorId: number,
    status: 'COMPLETED' | 'CANCELLED',
    remarks?: string,
  ): Promise<ManualRerollSessionDto> {
    await ensureManualRerollTable();
    const current = await this.requireOpenSession(sessionId);
    const priorStatus = current.status;

    const endTime = new Date();
    const startTime = current.start_time instanceof Date
      ? current.start_time
      : new Date(current.start_time);

    if (current.status === 'STOPPAGE') {
      const openStop = await loadActiveStoppage(sessionId);
      if (openStop) {
        await this.endStoppage({
          sessionId,
          stoppageId: openStop.stoppageId,
          categoryCode: openStop.categoryCode,
          stoppageCode: openStop.stoppageCode ?? undefined,
        });
      }
    }

    const stoppages = await loadStoppages(sessionId);
    const wallMin = computeDurationMin(startTime, endTime);
    const stopMin = sumStoppageMinutes(stoppages, endTime);
    const durationMin = Math.max(0, wallMin - stopMin);

    const row = await db
      .updateTable('txn.manual_reroll_session')
      .set({
        status,
        end_time: endTime,
        duration_min: durationMin,
        remarks: remarks !== undefined ? remarks : current.remarks,
        updated_at: endTime,
      })
      .where('session_id', '=', sessionId)
      .where('status', 'in', [...OPEN_REROLL_STATUSES])
      .returningAll()
      .executeTakeFirstOrThrow();

    if (priorStatus === 'IN_PROGRESS' || priorStatus === 'STOPPAGE') {
      fireMachineEvent(current.machine_code, 'RUNNING_ENDED', eventOptsForSession(current as any));
    }
    fireMachineEvent(current.machine_code, 'IDLE_STARTED', eventOptsForSession(current as any));

    return mapSession(row as any, { stoppages, activeStoppage: null });
  }

  static async listSessions(machineCode: string): Promise<ManualRerollSessionDto[]> {
    await ensureManualRerollTable();
    const rows = await db
      .selectFrom('txn.manual_reroll_session')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .orderBy('start_time', 'desc')
      .limit(100)
      .execute();
    return rows.map((r) => mapSession(r as any));
  }

  /**
   * Batches claimed by open or COMPLETED re-roll sessions on this mill.
   * CANCELLED (incl. Move to Pending) is not claimed — those return to pending.
   */
  static async listClaimedBatchNumbers(machineCode: string): Promise<Set<string>> {
    await ensureManualRerollTable();
    const rows = await db
      .selectFrom('txn.manual_reroll_session')
      .select(['batch_number', 'batch_numbers', 'remarks'])
      .where('machine_code', '=', machineCode)
      .where('status', 'in', [...CLAIMED_REROLL_STATUSES])
      .execute();
    return buildClaimedBatchSet(rows as Array<{
      batch_number?: string | null;
      batch_numbers?: string[] | null | string;
      remarks?: string | null;
    }>);
  }

  /** Open sessions + today's completed (for console queue). */
  static async listQueueSessions(machineCode: string, dayStart: Date): Promise<ManualRerollSessionDto[]> {
    await ensureManualRerollTable();
    const rows = await db
      .selectFrom('txn.manual_reroll_session')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .where((eb) =>
        eb.or([
          eb('status', 'in', [...OPEN_REROLL_STATUSES]),
          eb.and([eb('status', '=', 'COMPLETED'), eb('start_time', '>=', dayStart)]),
        ]),
      )
      .orderBy('start_time', 'desc')
      .limit(200)
      .execute();

    const result: ManualRerollSessionDto[] = [];
    for (const row of rows) {
      const sid = String(row.session_id);
      const stoppages = await loadStoppages(sid);
      const activeStoppage = stoppages.find((s) => !s.endTime) ?? null;
      result.push(mapSession(row as any, { activeStoppage, stoppages }));
    }
    return result;
  }

  static async getSessionById(sessionId: string): Promise<ManualRerollSessionDto | null> {
    await ensureManualRerollTable();
    const row = await db
      .selectFrom('txn.manual_reroll_session')
      .selectAll()
      .where('session_id', '=', sessionId)
      .executeTakeFirst();
    if (!row) return null;
    const stoppages = await loadStoppages(sessionId);
    const activeStoppage = stoppages.find((s) => !s.endTime) ?? null;
    return mapSession(row as any, { activeStoppage, stoppages });
  }

  private static async requireSession(sessionId: string) {
    const row = await db
      .selectFrom('txn.manual_reroll_session')
      .selectAll()
      .where('session_id', '=', sessionId)
      .executeTakeFirst();
    if (!row) throw new Error('SESSION_NOT_FOUND');
    return row;
  }

  private static async requireOpenSession(sessionId: string) {
    const row = await this.requireSession(sessionId);
    if (!(OPEN_REROLL_STATUSES as readonly string[]).includes(row.status)) {
      throw new Error('SESSION_NOT_OPEN');
    }
    return row;
  }

  static async getProductionSummary(filter: {
    machine: ManualRerollMachine;
    from: Date;
    to: Date;
    fromLabel: string;
    toLabel: string;
    shift?: string;
  }): Promise<ManualRerollSummary> {
    await ensureManualRerollTable();
    let query = db
      .selectFrom('txn.manual_reroll_session')
      .selectAll()
      .where('machine_code', '=', filter.machine)
      .where('status', '=', 'COMPLETED')
      .where('start_time', '>=', filter.from)
      .where('start_time', '<=', filter.to);

    if (filter.shift) {
      query = query.where('shift_code', '=', filter.shift.toUpperCase());
    }

    const rows = await query.execute();

    let totalRerollMt = 0;
    const byShiftMap = new Map<string, { shiftCode: string | null; totalRerollMt: number; sessionCount: number }>();
    const byOrderMap = new Map<string, {
      orderId: string | null;
      batchNumber: string | null;
      totalRerollMt: number;
      sessionCount: number;
    }>();

    for (const row of rows) {
      const qty = row.reroll_quantity == null ? 0 : Number(row.reroll_quantity);
      totalRerollMt += qty;
      const shiftKey = row.shift_code ?? '';
      const shiftEntry = byShiftMap.get(shiftKey) ?? {
        shiftCode: row.shift_code,
        totalRerollMt: 0,
        sessionCount: 0,
      };
      shiftEntry.totalRerollMt += qty;
      shiftEntry.sessionCount += 1;
      byShiftMap.set(shiftKey, shiftEntry);

      const orderKey = `${row.order_id ?? ''}|${row.batch_number ?? ''}`;
      const orderEntry = byOrderMap.get(orderKey) ?? {
        orderId: row.order_id == null ? null : String(row.order_id),
        batchNumber: row.batch_number,
        totalRerollMt: 0,
        sessionCount: 0,
      };
      orderEntry.totalRerollMt += qty;
      orderEntry.sessionCount += 1;
      byOrderMap.set(orderKey, orderEntry);
    }

    return {
      machineCode: filter.machine,
      from: filter.fromLabel,
      to: filter.toLabel,
      shiftCode: filter.shift?.toUpperCase(),
      totalRerollMt,
      sessionCount: rows.length,
      byShift: [...byShiftMap.values()],
      byOrder: [...byOrderMap.values()],
    };
  }
}
