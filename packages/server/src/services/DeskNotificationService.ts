import { db } from '../db';

export type DeskNotificationKind = 'AUTO_HANDOVER_BOUNDARY';

export interface DeskNotificationRow {
  notificationId: string;
  kind: string;
  title: string;
  body: string;
  machineCode: string | null;
  handoverId: string | null;
  shiftLogId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * In-app desk notifications for Machine Heads (SPEC2 §10).
 * Fire-and-forget after Tier-1 auto handover; resolve on MH shift sign-off.
 */
export class DeskNotificationService {
  static async notifyMachineHeadsAutoHandover(args: {
    machineCode: string;
    handoverId: string;
    shiftLogId: string | null;
    outgoingShiftCode: string;
    outgoingProdDate: string;
    operatorUserId: number;
    operatorUsername?: string | null;
  }): Promise<number> {
    const mhRows = await db
      .selectFrom('security.machine_access as ma')
      .innerJoin('security.user_role as ur', 'ur.user_id', 'ma.user_id')
      .innerJoin('security.role as r', 'r.role_id', 'ur.role_id')
      .select('ma.user_id')
      .where('ma.machine_code', '=', args.machineCode)
      .where('r.role_name', '=', 'MACHINE_HEAD')
      .distinct()
      .execute();

    if (mhRows.length === 0) return 0;

    let operatorLabel = args.operatorUsername?.trim() || null;
    if (!operatorLabel) {
      const u = await db
        .selectFrom('security.app_user')
        .select(['username', 'full_name'])
        .where('user_id', '=', args.operatorUserId)
        .executeTakeFirst();
      operatorLabel = u?.full_name || u?.username || `user#${args.operatorUserId}`;
    }

    const title = `Auto handover on ${args.machineCode}`;
    const body =
      `Shift closed automatically on ${args.machineCode} — ${operatorLabel} ` +
      `did not submit a handover before shift end ` +
      `(${args.outgoingProdDate} · Shift ${args.outgoingShiftCode}).`;

    const payload = {
      handoverId: args.handoverId,
      shiftLogId: args.shiftLogId,
      machineCode: args.machineCode,
      outgoingShiftCode: args.outgoingShiftCode,
      outgoingProdDate: args.outgoingProdDate,
      reviewPath: args.shiftLogId
        ? `/machine-head/shift-review?shiftLogId=${args.shiftLogId}`
        : '/machine-head/shift-review',
    };

    await db
      .insertInto('txn.desk_notification')
      .values(
        mhRows.map((r) => ({
          user_id: Number(r.user_id),
          kind: 'AUTO_HANDOVER_BOUNDARY' as const,
          title,
          body,
          machine_code: args.machineCode,
          handover_id: args.handoverId as any,
          shift_log_id: args.shiftLogId as any,
          payload: payload as any,
        })),
      )
      .execute();

    return mhRows.length;
  }

  static async listOpenForUser(userId: number, limit = 20): Promise<DeskNotificationRow[]> {
    const rows = await db
      .selectFrom('txn.desk_notification')
      .selectAll()
      .where('user_id', '=', userId)
      .where('resolved_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map((r) => ({
      notificationId: String(r.notification_id),
      kind: r.kind,
      title: r.title,
      body: r.body,
      machineCode: r.machine_code,
      handoverId: r.handover_id != null ? String(r.handover_id) : null,
      shiftLogId: r.shift_log_id != null ? String(r.shift_log_id) : null,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      createdAt: new Date(r.created_at as any).toISOString(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at as any).toISOString() : null,
    }));
  }

  /** Resolve open notifications tied to a shift-log (MH sign-off). */
  static async resolveForShiftLog(shiftLogId: string): Promise<number> {
    const result = await db
      .updateTable('txn.desk_notification')
      .set({ resolved_at: new Date() })
      .where('shift_log_id', '=', shiftLogId as any)
      .where('resolved_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }
}