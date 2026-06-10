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
  | 'ORDER_REJECTED';

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
  static async getUtilizationSummary(machineCode: string, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const now = new Date();
    const windowMin = hours * 60;

    const events = await db
      .selectFrom('txn.machine_state_event')
      .select(['event_type', 'occurred_at', 'ended_at', 'duration_min', 'reason', 'category_code'])
      .where('machine_code', '=', machineCode)
      .where('occurred_at', '>=', since)
      .execute();

    let runningMin = 0;
    let idleMin = 0;
    let stoppageMin = 0;
    let maintenanceMin = 0;
    let stoppageCount = 0;
    let orderCount = 0;

    const stoppageReasonMap = new Map<string, { count: number; totalMin: number }>();

    for (const ev of events) {
      const end = ev.ended_at ? new Date(ev.ended_at) : now;
      const start = new Date(ev.occurred_at);
      const min = Math.max(0, (end.getTime() - start.getTime()) / 60000);

      if (ev.event_type === 'RUNNING_STARTED') {
        runningMin += min;
        orderCount++;
      } else if (ev.event_type === 'IDLE_STARTED') {
        idleMin += min;
      } else if (ev.event_type === 'STOPPAGE_STARTED') {
        stoppageMin += min;
        stoppageCount++;
        const key = ev.reason ?? ev.category_code ?? 'Unknown';
        const existing = stoppageReasonMap.get(key) ?? { count: 0, totalMin: 0 };
        stoppageReasonMap.set(key, { count: existing.count + 1, totalMin: existing.totalMin + min });
      } else if (ev.event_type === 'MAINTENANCE_STARTED') {
        maintenanceMin += min;
      }
    }

    const topStoppageReasons = Array.from(stoppageReasonMap.entries())
      .map(([reason, data]) => ({ reason, ...data }))
      .sort((a, b) => b.totalMin - a.totalMin)
      .slice(0, 5);

    return {
      machineCode,
      windowHours: hours,
      runningMin: Math.round(runningMin),
      idleMin: Math.round(idleMin),
      stoppageMin: Math.round(stoppageMin),
      maintenanceMin: Math.round(maintenanceMin),
      runningPct: Math.round((runningMin / windowMin) * 100),
      idlePct: Math.round((idleMin / windowMin) * 100),
      stopPagePct: Math.round((stoppageMin / windowMin) * 100),
      maintenancePct: Math.round((maintenanceMin / windowMin) * 100),
      orderCount,
      stoppageCount,
      topStoppageReasons,
    };
  }

  /**
   * Get the currently active (open) event for a machine.
   */
  static async getCurrentEvent(machineCode: string) {
    return db
      .selectFrom('txn.machine_state_event')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .where('ended_at', 'is', null)
      .orderBy('occurred_at', 'desc')
      .executeTakeFirst();
  }
}
