import { db } from '../db';
import { requestContext } from '../context';
import { ShiftLogState } from '@m1/shared-validation';
import {
  normalizeTableName,
  resolvePkColumn,
  toDbColumnNames,
} from './changeRequestPk';

export type ChangeRequestState = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'APPLIED';

export interface CreateChangeRequestInput {
  shiftLogId?: string;
  tableName?: string;
  recordPk?: string;
  reason: string;
  proposedChanges?: Record<string, unknown>;
}

export interface ChangeRequestDto {
  id: string;
  shiftLogId: string;
  tableName: string;
  recordPk: string;
  reason: string;
  proposedChanges: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'APPLIED' | 'REJECTED';
  state: ChangeRequestState;
  createdAt: string;
  resolvedAt?: string;
  requestedByName?: string;
  rejectionNote?: string;
}

function parseProposedChanges(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function mapStateToClient(state: string): ChangeRequestDto['status'] {
  switch (state) {
    case 'REQUESTED':
      return 'PENDING';
    case 'APPLIED':
      return 'APPLIED';
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return 'PENDING';
  }
}

function toDto(row: any, requestedByName?: string): ChangeRequestDto {
  const tableName = row.table_name ?? row.tableName;
  const recordPk = String(row.record_pk ?? row.recordPk);
  const state = row.state as ChangeRequestState;

  return {
    id: String(row.cr_id ?? row.id),
    shiftLogId: tableName === 'txn.shift_log' ? recordPk : recordPk,
    tableName,
    recordPk,
    reason: row.reason,
    proposedChanges: parseProposedChanges(row.proposed_changes ?? row.proposedChanges),
    status: mapStateToClient(state),
    state,
    createdAt: new Date(row.requested_at ?? row.requestedAt).toISOString(),
    resolvedAt: row.decided_at ? new Date(row.decided_at).toISOString() : undefined,
    requestedByName: requestedByName ?? row.requestedByName,
    rejectionNote: row.rejection_note ?? undefined,
  };
}

export class ChangeRequestService {
  static async create(payload: CreateChangeRequestInput, userId: string): Promise<ChangeRequestDto> {
    const tableName = normalizeTableName(payload.tableName || 'txn.shift_log');
    const recordPk = String(payload.recordPk || payload.shiftLogId || '');
    if (!recordPk) {
      throw new Error('recordPk or shiftLogId is required');
    }
    if (!payload.reason?.trim()) {
      throw new Error('reason is required');
    }

    const result = await db
      .insertInto('audit.change_request')
      .values({
        table_name: tableName,
        record_pk: recordPk,
        reason: payload.reason.trim(),
        proposed_changes: JSON.stringify(payload.proposedChanges ?? {}) as any,
        state: 'REQUESTED',
        requested_by: Number(userId),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return toDto(result);
  }

  private static resolveApplyChanges(
    tableName: string,
    proposedChanges: Record<string, unknown>
  ): Record<string, unknown> {
    let changes = toDbColumnNames(proposedChanges);

    if (tableName === 'txn.shift_log' && Object.keys(changes).length === 0) {
      changes = { state: ShiftLogState.REOPENED };
    }

    return changes;
  }

  static async approve(id: string, approverId: string): Promise<ChangeRequestDto> {
    const cr = await db
      .selectFrom('audit.change_request')
      .selectAll()
      .where('cr_id', '=', id)
      .executeTakeFirst();

    if (!cr || cr.state !== 'REQUESTED') {
      throw new Error('Change request not found or not in REQUESTED state');
    }

    const tableName = normalizeTableName(cr.table_name);
    const pkColumn = resolvePkColumn(tableName);
    const proposedChanges = parseProposedChanges(cr.proposed_changes);
    const changes = this.resolveApplyChanges(tableName, proposedChanges);

    const oldRecord = await (db as any)
      .selectFrom(tableName)
      .selectAll()
      .where(pkColumn, '=', cr.record_pk)
      .executeTakeFirst();

    if (!oldRecord && Object.keys(changes).length > 0) {
      throw new Error(`Target record not found in ${tableName}`);
    }

    const currentStore = requestContext.getStore() || {};
    await new Promise<void>((resolve, reject) => {
      requestContext.run({ ...currentStore, change_request_id: id }, async () => {
        try {
          if (Object.keys(changes).length > 0) {
            await (db as any)
              .updateTable(tableName)
              .set(changes)
              .where(pkColumn, '=', cr.record_pk)
              .execute();
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    const updated = await db
      .updateTable('audit.change_request')
      .set({
        state: 'APPLIED',
        approved_by: Number(approverId),
        decided_at: new Date(),
      })
      .where('cr_id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return toDto(updated);
  }

  static async reject(id: string, rejectorId: string, remarks?: string): Promise<ChangeRequestDto> {
    const updated = await db
      .updateTable('audit.change_request')
      .set({
        state: 'REJECTED',
        approved_by: Number(rejectorId),
        decided_at: new Date(),
        rejection_note: remarks?.trim() || null,
      })
      .where('cr_id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      throw new Error('Change request not found');
    }

    return toDto(updated);
  }

  static async getById(id: string): Promise<ChangeRequestDto | null> {
    const row = await db
      .selectFrom('audit.change_request')
      .selectAll()
      .where('cr_id', '=', id)
      .executeTakeFirst();

    return row ? toDto(row) : null;
  }

  static mapListRow(row: any): ChangeRequestDto {
    return toDto(row, row.requestedByName);
  }
}
