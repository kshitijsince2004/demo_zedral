import { db } from '../db';
import { isAuditPersistenceEnabled } from '../audit/auditConfig';
import { endOfDateFilter, startOfDateFilter } from '../utils/dateOnly';

/** M1-08 baseline audit_log row shape (matches doc/M1_schema.sql). */
export interface AuditLogEntry {
  table_name: string;
  record_pk: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  column_name: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: number | null;
}

function serializeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Prefer stored PK; if blank (legacy stub fn_audit), recover from row JSON. */
const PK_JSON_KEYS = [
  'shift_log_id',
  'entry_id',
  'field_id',
  'defect_code',
  'stoppage_code',
  'coil_no',
  'charge_no',
  'stoppage_id',
  'defect_id',
  'override_id',
  'customer_id',
  'grade_code',
  'coil_plan_id',
  'plan_order_id',
  'import_batch_id',
  'order_id',
  'export_id',
  'user_id',
  'process_id',
  'machine_code',
  'tenant_id',
] as const;

function resolveRecordId(
  recordPk: unknown,
  newValue: string | null,
  oldValue: string | null,
): string {
  const raw = recordPk == null ? '' : String(recordPk).trim();
  if (raw && raw !== 'UNKNOWN') return raw;

  for (const blob of [newValue, oldValue]) {
    if (!blob) continue;
    try {
      const obj = JSON.parse(blob) as Record<string, unknown>;
      for (const key of PK_JSON_KEYS) {
        const v = obj[key];
        if (v !== null && v !== undefined && String(v).trim() !== '') {
          return String(v);
        }
      }
    } catch {
      // not JSON — ignore
    }
  }
  return raw;
}

/**
 * Application-level audit writer for explicit events (e.g. last-writer conflict snapshots).
 * Routine DML is captured by DB triggers (audit.fn_audit) in the same transaction.
 */
export interface AuditQueryResult {
  records: Array<{
    id: number;
    table_name: string;
    record_id: string;
    action: string;
    field: string | null;
    old_value: string | null;
    new_value: string | null;
    user_id: number | null;
    timestamp: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditQueryFilters {
  scope?: string; // 'plant' or specific line
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  action?: string;
}

export class AuditTrailService {
  static async query(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    let q = db.selectFrom('audit.audit_log').selectAll();
    let countQ = db.selectFrom('audit.audit_log').select((eb) => eb.fn.countAll().as('total'));

    if (filters.action) {
      q = q.where('action', '=', filters.action);
      countQ = countQ.where('action', '=', filters.action);
    }
    
    // Default 90 days if not provided
    const toDate = filters.to ? endOfDateFilter(filters.to) : new Date();
    const fromDate = filters.from
      ? startOfDateFilter(filters.from)
      : new Date(toDate.getTime() - 90 * 24 * 60 * 60 * 1000);
    
    q = q.where('ts', '>=', fromDate).where('ts', '<=', toDate);
    countQ = countQ.where('ts', '>=', fromDate).where('ts', '<=', toDate);

    if (filters.scope && filters.scope !== 'plant') {
      // Assuming table names might be filtered by scope or something similar if it's not plant?
      // "all lines included" for Plant Head, so if scope is 'plant', we include all.
      // If there's a specific line scope, we might need a join or something, but typically Plant Head sees all.
    }

    const rows = await q.orderBy('ts', 'desc').limit(pageSize).offset(offset).execute();
    const countRow = await countQ.executeTakeFirst();
    const total = Number(countRow?.total ?? 0);

    const records = rows.map((r: any) => {
      const old_value = r.old_value ?? null;
      const new_value = r.new_value ?? null;
      return {
        id: Number(r.audit_id),
        table_name: r.table_name,
        record_id: resolveRecordId(r.record_pk, new_value, old_value),
        action: r.action,
        field: r.column_name ?? null, // null for whole-row INSERT/DELETE
        old_value,
        new_value,
        user_id: r.user_id ? Number(r.user_id) : null,
        timestamp: new Date(r.ts).toISOString(),
      };
    });

    return { records, total, page, pageSize };
  }

  static buildEntries(
    tableName: string,
    recordPk: string,
    action: 'INSERT' | 'UPDATE' | 'DELETE',
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
    userId: number,
    _changeRequestId?: number,
  ): AuditLogEntry[] {
    const changes: AuditLogEntry[] = [];

    if (action === 'UPDATE' && oldValues && newValues) {
      const keys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
      for (const key of keys) {
        const oldVal = serializeValue(oldValues[key]);
        const newVal = serializeValue(newValues[key]);
        if (oldVal !== newVal) {
          changes.push({
            table_name: tableName,
            record_pk: recordPk,
            action,
            column_name: key,
            old_value: oldVal,
            new_value: newVal,
            user_id: userId,
          });
        }
      }
      return changes;
    }

    changes.push({
      table_name: tableName,
      record_pk: recordPk,
      action,
      column_name: null,
      old_value: oldValues ? JSON.stringify(oldValues) : null,
      new_value: newValues ? JSON.stringify(newValues) : null,
      user_id: userId,
    });
    return changes;
  }

  static async log(
    tableName: string,
    recordPk: string,
    action: 'INSERT' | 'UPDATE' | 'DELETE',
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
    userId: number,
    changeRequestId?: number,
  ): Promise<void> {
    if (!isAuditPersistenceEnabled()) {
      return;
    }

    const changes = this.buildEntries(
      tableName,
      recordPk,
      action,
      oldValues,
      newValues,
      userId,
      changeRequestId,
    );

    if (changes.length > 0) {
      await db.insertInto('audit.audit_log').values(changes).execute();
    }
  }
}
