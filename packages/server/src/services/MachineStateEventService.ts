/**
 * MachineStateEventService
 *
 * Persists machine state transitions (RUNNING, IDLE, STOPPAGE, MAINTENANCE)
 * to txn.machine_state_event.
 *
 * All live dashboards, analytics, and timers should derive from these events
 * as the single source of truth.
 */
import { db } from '../db';
import { getTenantId } from '../context';

export type MachineStateEventType =
  | 'RUNNING_STARTED'
  | 'RUNNING_ENDED'
  | 'STOPPAGE_STARTED'
  | 'STOPPAGE_ENDED'
  | 'IDLE_STARTED'
  | 'IDLE_ENDED'
  | 'MAINTENANCE_STARTED'
  | 'MAINTENANCE_ENDED'
  | 'DEFECT_REPORTED'
  | 'DEFECT_CLOSED'
  | 'ORDER_REJECTED'
  | 'ORDER_REINSTATED';

export interface RecordEventOptions {
  orderId?: string | number | bigint;
  batchNumber?: string;
  operatorId?: number;
  shiftCode?: string;
  reason?: string;
  categoryCode?: string;
  meta?: Record<string, unknown>;
}

export class MachineStateEventService {
  /**
   * Record a new machine state event.
   * Before inserting, closes any currently open event of the opposite type.
   */
  static async recordEvent(
    machineCode: string,
    eventType: MachineStateEventType,
    opts: RecordEventOptions = {},
  ): Promise<void> {
    const now = new Date();

    // Determine which event types to close when this one starts
    const closeMap: Partial<Record<MachineStateEventType, MachineStateEventType[]>> = {
      RUNNING_STARTED: ['IDLE_STARTED', 'STOPPAGE_STARTED', 'MAINTENANCE_STARTED'],
      RUNNING_ENDED:   ['RUNNING_STARTED'],
      STOPPAGE_STARTED: ['RUNNING_STARTED', 'IDLE_STARTED'],
      STOPPAGE_ENDED:  ['STOPPAGE_STARTED'],
      IDLE_STARTED:    ['RUNNING_STARTED', 'STOPPAGE_STARTED', 'MAINTENANCE_STARTED'],
      IDLE_ENDED:      ['IDLE_STARTED'],
      MAINTENANCE_STARTED: ['RUNNING_STARTED', 'IDLE_STARTED', 'STOPPAGE_STARTED'],
      MAINTENANCE_ENDED: ['MAINTENANCE_STARTED'],
      DEFECT_CLOSED: ['DEFECT_REPORTED'],
    };

    const toClose = closeMap[eventType] ?? [];

    await db.transaction().execute(async (trx) => {
      // Close open counterpart events
      if (toClose.length > 0) {
        const openEvents = await trx
          .selectFrom('txn.machine_state_event')
          .select(['event_id', 'occurred_at'])
          .where('machine_code', '=', machineCode)
          .where('event_type', 'in', toClose)
          .where('ended_at', 'is', null)
          .execute();

        for (const ev of openEvents) {
          const durationMin = Math.round(
            (now.getTime() - new Date(ev.occurred_at).getTime()) / 60000,
          );
          await trx
            .updateTable('txn.machine_state_event')
            .set({ ended_at: now, duration_min: durationMin })
            .where('event_id', '=', ev.event_id)
            .execute();
        }
      }

      // Insert the new event
      await trx
        .insertInto('txn.machine_state_event')
        .values({
          machine_code: machineCode,
          event_type: eventType,
          occurred_at: now,
          order_id: opts.orderId ? BigInt(opts.orderId) : null,
          batch_number: opts.batchNumber ?? null,
          operator_id: opts.operatorId ?? null,
          shift_code: opts.shiftCode ?? null,
          reason: opts.reason ?? null,
          category_code: opts.categoryCode ?? null,
          meta: opts.meta ? JSON.stringify(opts.meta) : null,
          tenant_id: getTenantId() || '00000000-0000-0000-0000-000000000001',
        })
        .execute();
    });
  }

  /**
   * Close all open events of specified types for a machine.
   * Used for cleanup (e.g., on shift boundary).
   */
  static async closeOpenEvents(
    machineCode: string,
    eventTypes: MachineStateEventType[],
    endedAt: Date = new Date(),
  ): Promise<void> {
    if (eventTypes.length === 0) return;

    const openEvents = await db
      .selectFrom('txn.machine_state_event')
      .select(['event_id', 'occurred_at'])
      .where('machine_code', '=', machineCode)
      .where('event_type', 'in', eventTypes)
      .where('ended_at', 'is', null)
      .execute();

    for (const ev of openEvents) {
      const durationMin = Math.round(
        (endedAt.getTime() - new Date(ev.occurred_at).getTime()) / 60000,
      );
      await db
        .updateTable('txn.machine_state_event')
        .set({ ended_at: endedAt, duration_min: durationMin })
        .where('event_id', '=', ev.event_id)
        .execute();
    }
  }

  /**
   * Get event timeline for a machine over the last N hours.
   */
  static async getTimeline(machineCode: string, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const events = await db
      .selectFrom('txn.machine_state_event as mse')
      .leftJoin('security.app_user as u', 'u.user_id', 'mse.operator_id')
      .select([
        'mse.event_id',
        'mse.machine_code',
        'mse.event_type',
        'mse.occurred_at',
        'mse.ended_at',
        'mse.duration_min',
        'mse.batch_number',
        'mse.reason',
        'mse.category_code',
        'mse.shift_code',
        'u.full_name as operator_name',
      ])
      .where('mse.machine_code', '=', machineCode)
      .where('mse.occurred_at', '>=', since)
      .orderBy('mse.occurred_at', 'desc')
      .execute();

    return events.map((e) => ({
      eventId: String(e.event_id),
      machineCode: e.machine_code,
      eventType: e.event_type as MachineStateEventType,
      occurredAt: new Date(e.occurred_at).toISOString(),
      endedAt: e.ended_at ? new Date(e.ended_at).toISOString() : undefined,
      durationMin: e.duration_min ? Number(e.duration_min) : undefined,
      batchNumber: e.batch_number ?? undefined,
      reason: e.reason ?? undefined,
      categoryCode: e.category_code ?? undefined,
      shiftCode: e.shift_code ?? undefined,
      operatorName: (e as any).operator_name ?? undefined,
    }));
  }

  /**
   * Get utilization summary for a machine over the last N hours.
   */
  static async getUtilizationSummary(machineCode: string, hours = 24, sinceOverride?: Date) {
    const map = await this.getUtilizationSummaries([machineCode], hours, sinceOverride);
    return map.get(machineCode)!;
  }

  /** Batch utilization for many machines — one query (`WHERE machine_code IN (...)`). */
  static async getUtilizationSummaries(
    machineCodes: string[],
    hours = 24,
    sinceOverride?: Date,
  ) {
    const since = sinceOverride || new Date(Date.now() - hours * 60 * 60 * 1000);
    const now = new Date();
    const windowMin = sinceOverride ? Math.max(1, (now.getTime() - since.getTime()) / 60000) : hours * 60;

    type Summary = {
      machineCode: string;
      windowHours: number;
      runningMin: number;
      idleMin: number;
      stoppageMin: number;
      breakdownMin: number;
      maintenanceMin: number;
      runningPct: number;
      idlePct: number;
      stopPagePct: number;
      maintenancePct: number;
      orderCount: number;
      stoppageCount: number;
      topStoppageReasons: Array<{ reason: string; count: number; totalMin: number }>;
    };
    const empty = (machineCode: string): Summary => ({
      machineCode,
      windowHours: hours,
      runningMin: 0,
      idleMin: 0,
      stoppageMin: 0,
      breakdownMin: 0,
      maintenanceMin: 0,
      runningPct: 0,
      idlePct: 0,
      stopPagePct: 0,
      maintenancePct: 0,
      orderCount: 0,
      stoppageCount: 0,
      topStoppageReasons: [],
    });

    const out = new Map<string, Summary>();
    for (const code of machineCodes) out.set(code, empty(code));
    if (machineCodes.length === 0) return out;

    const events = await db
      .selectFrom('txn.machine_state_event')
      .select(['machine_code', 'event_type', 'occurred_at', 'ended_at', 'duration_min', 'reason', 'category_code'])
      .where('machine_code', 'in', machineCodes)
      .where('occurred_at', '>=', since)
      .execute();

    type Acc = {
      runningMin: number;
      idleMin: number;
      stoppageMin: number;
      maintenanceMin: number;
      stoppageCount: number;
      orderCount: number;
      breakdownMin: number;
      stoppageReasonMap: Map<string, { count: number; totalMin: number }>;
    };
    const accBy = new Map<string, Acc>();
    const getAcc = (code: string): Acc => {
      let a = accBy.get(code);
      if (!a) {
        a = {
          runningMin: 0,
          idleMin: 0,
          stoppageMin: 0,
          maintenanceMin: 0,
          stoppageCount: 0,
          orderCount: 0,
          breakdownMin: 0,
          stoppageReasonMap: new Map(),
        };
        accBy.set(code, a);
      }
      return a;
    };

    for (const ev of events) {
      const a = getAcc(ev.machine_code);
      const end = ev.ended_at ? new Date(ev.ended_at) : now;
      const start = new Date(ev.occurred_at);
      const min = Math.max(0, (end.getTime() - start.getTime()) / 60000);

      if (ev.event_type === 'RUNNING_STARTED') {
        a.runningMin += min;
        a.orderCount++;
      } else if (ev.event_type === 'IDLE_STARTED') {
        a.idleMin += min;
      } else if (ev.event_type === 'STOPPAGE_STARTED') {
        a.stoppageMin += min;
        a.stoppageCount++;
        if (ev.category_code === 'BREAKDOWN') a.breakdownMin += min;
        const key = ev.reason ?? ev.category_code ?? 'Unknown';
        const existing = a.stoppageReasonMap.get(key) ?? { count: 0, totalMin: 0 };
        a.stoppageReasonMap.set(key, { count: existing.count + 1, totalMin: existing.totalMin + min });
      } else if (ev.event_type === 'MAINTENANCE_STARTED') {
        a.maintenanceMin += min;
      }
    }

    for (const [machineCode, a] of accBy) {
      const topStoppageReasons = Array.from(a.stoppageReasonMap.entries())
        .map(([reason, data]) => ({ reason, ...data }))
        .sort((x, y) => y.totalMin - x.totalMin)
        .slice(0, 5);
      out.set(machineCode, {
        machineCode,
        windowHours: hours,
        runningMin: Math.round(a.runningMin),
        idleMin: Math.round(a.idleMin),
        stoppageMin: Math.round(a.stoppageMin),
        breakdownMin: Math.round(a.breakdownMin),
        maintenanceMin: Math.round(a.maintenanceMin),
        runningPct: Math.round((a.runningMin / windowMin) * 100),
        idlePct: Math.round((a.idleMin / windowMin) * 100),
        stopPagePct: Math.round((a.stoppageMin / windowMin) * 100),
        maintenancePct: Math.round((a.maintenanceMin / windowMin) * 100),
        orderCount: a.orderCount,
        stoppageCount: a.stoppageCount,
        topStoppageReasons,
      });
    }
    return out;
  }

  /**
   * Get the currently active (open) event for a machine.
   * When multiple open events exist (race / legacy data), prefer MAINTENANCE > STOPPAGE > RUNNING > IDLE.
   */
  static async getCurrentEvent(machineCode: string) {
    const openEvents = await db
      .selectFrom('txn.machine_state_event')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .where('ended_at', 'is', null)
      .execute();

    if (openEvents.length === 0) return undefined;
    if (openEvents.length === 1) return openEvents[0];

    const priority: Record<string, number> = {
      MAINTENANCE_STARTED: 50,
      STOPPAGE_STARTED: 40,
      RUNNING_STARTED: 30,
      IDLE_STARTED: 20,
    };
    return [...openEvents].sort((a, b) => {
      const priA = priority[a.event_type] ?? 0;
      const priB = priority[b.event_type] ?? 0;
      if (priB !== priA) return priB - priA;
      return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
    })[0];
  }

  /** Update fields on an open machine state event (e.g. manual stoppage details). */
  static async updateOpenEvent(
    eventId: string | number | bigint,
    updates: {
      categoryCode?: string;
      reason?: string;
      meta?: Record<string, unknown>;
    },
  ): Promise<void> {
    const patch: {
      category_code?: string;
      reason?: string | null;
      meta?: string | null;
    } = {};
    if (updates.categoryCode !== undefined) patch.category_code = updates.categoryCode;
    if (updates.reason !== undefined) patch.reason = updates.reason ?? null;
    if (updates.meta !== undefined) patch.meta = JSON.stringify(updates.meta);

    if (Object.keys(patch).length === 0) return;

    await db
      .updateTable('txn.machine_state_event')
      .set(patch)
      .where('event_id', '=', String(eventId))
      .where('ended_at', 'is', null)
      .execute();
  }
}
