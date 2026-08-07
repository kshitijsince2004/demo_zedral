import { db } from '../db';
import { serializeMachineClassification } from '@m1/shared-validation';
import { getAppCache } from '../cache';
import { getTenantId } from '../context';
import { tenantCacheKey } from '../cache/types';

function normalizeAppliesTo(raw: unknown, fallback?: string | null): string | null {
  if (Array.isArray(raw)) {
    const joined = serializeMachineClassification(raw.map(String));
    return joined || fallback || null;
  }
  if (typeof raw === 'string') {
    const joined = serializeMachineClassification(
      raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
    );
    return joined || fallback || null;
  }
  return fallback ?? null;
}

const MASTER_CACHE_TTL_SEC = 60;

/** Whitelisted master tables used by MasterDataService CRUD. */
export type MasterEntityTable =
  | 'master.customer'
  | 'master.grade'
  | 'master.surface_finish'
  | 'master.defect_code'
  | 'master.stoppage_category'
  | 'master.stoppage_code'
  | 'master.operator'
  | 'master.furnace';

const ACTIVE_FILTER_TABLES: ReadonlySet<MasterEntityTable> = new Set([
  'master.customer',
  'master.grade',
  'master.defect_code',
  'master.stoppage_code',
  'master.operator',
]);

export class MasterDataService {
  private static cacheKey(tableName: string, includeInactive: boolean): string {
    return tenantCacheKey(getTenantId(), 'master', tableName, `inactive_${includeInactive}`);
  }

  /** Invalidate all cached master reads for this tenant (or one table). */
  static async invalidateCache(tableName?: string): Promise<void> {
    const prefix = tableName
      ? tenantCacheKey(getTenantId(), 'master', tableName)
      : tenantCacheKey(getTenantId(), 'master');
    await getAppCache().del(prefix);
  }

  /**
   * Retrieves all master data for a given table, filtering by is_active by default.
   */
  static async getAll(tableName: MasterEntityTable | string, includeInactive: boolean = false) {
    const key = this.cacheKey(tableName, includeInactive);
    const cached = await getAppCache().get<Record<string, unknown>[]>(key);
    if (cached) return cached;

    const table = tableName as MasterEntityTable;
    let query = db.selectFrom(table).selectAll();

    if (!includeInactive && ACTIVE_FILTER_TABLES.has(table)) {
      query = query.where('is_active', '=', true);
    }
    const rows = await query.execute() as Record<string, unknown>[];
    await getAppCache().set(key, rows, MASTER_CACHE_TTL_SEC);
    return rows;
  }

  /**
   * Retrieves a single master data record by its code/id.
   */
  static async getById(tableName: MasterEntityTable | string, pkColumn: string, id: string) {
    return await db.selectFrom(tableName as MasterEntityTable)
      .selectAll()
      .where(pkColumn as 'grade_code', '=', id)
      .executeTakeFirst();
  }

  /**
   * Creates a new master data record.
   */
  static async create(tableName: MasterEntityTable | string, pkColumn: string, data: any) {
    let values = { ...data };
    const table = tableName as MasterEntityTable;

    if (table === 'master.defect_code') {
      values = {
        defect_code: data.defect_code ?? data.code,
        description: data.description ?? data.name,
        symbol: data.symbol ?? null,
        applies_to: normalizeAppliesTo(
          data.applies_to ?? data.machineClassification ?? data.category,
          'CRM6',
        ),
        is_active: data.is_active ?? data.isActive ?? true,
      };
    }

    if (table === 'master.stoppage_code') {
      values = {
        stoppage_code: data.stoppage_code ?? data.code,
        description: data.description ?? data.name,
        category: data.category ?? 'OPN',
        is_planned: data.is_planned ?? data.isPlanned ?? false,
        applies_to: normalizeAppliesTo(
          data.applies_to ?? data.machineClassification,
          null,
        ),
        is_active: data.is_active ?? data.isActive ?? true,
      };
    }

    if (ACTIVE_FILTER_TABLES.has(table)) {
      values.is_active = values.is_active ?? true;
    }

    const result = await db.insertInto(table)
      .values(values)
      .returning(pkColumn as 'grade_code')
      .executeTakeFirst();

    return (result as Record<string, unknown>)?.[pkColumn];
  }

  /**
   * Updates an existing master data record.
   */
  static async update(tableName: MasterEntityTable | string, pkColumn: string, id: string, data: any) {
    let values = { ...data };
    const table = tableName as MasterEntityTable;
    if (table === 'master.defect_code') {
      values = {
        ...(data.description != null || data.name != null
          ? { description: data.description ?? data.name }
          : {}),
        ...(data.symbol !== undefined ? { symbol: data.symbol } : {}),
        ...(data.applies_to !== undefined || data.machineClassification !== undefined || data.category !== undefined
          ? {
              applies_to: normalizeAppliesTo(
                data.applies_to ?? data.machineClassification ?? data.category,
                null,
              ),
            }
          : {}),
        ...(data.is_active !== undefined || data.isActive !== undefined
          ? { is_active: data.is_active ?? data.isActive }
          : {}),
      };
    }
    if (table === 'master.stoppage_code') {
      values = {
        ...(data.description != null || data.name != null
          ? { description: data.description ?? data.name }
          : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.applies_to !== undefined || data.machineClassification !== undefined
          ? {
              applies_to: normalizeAppliesTo(
                data.applies_to ?? data.machineClassification,
                null,
              ),
            }
          : {}),
        ...(data.is_active !== undefined || data.isActive !== undefined
          ? { is_active: data.is_active ?? data.isActive }
          : {}),
      };
    }
    await db.updateTable(table)
      .set(values)
      .where(pkColumn as 'grade_code', '=', id)
      .execute();
  }

  /**
   * Soft-deletes a master data record.
   */
  static async deactivate(tableName: MasterEntityTable | string, pkColumn: string, id: string) {
    const table = tableName as MasterEntityTable;
    if (ACTIVE_FILTER_TABLES.has(table)) {
      await db.updateTable(table)
        .set({ is_active: false })
        .where(pkColumn as 'grade_code', '=', id)
        .execute();
    } else {
      await db.deleteFrom(table)
        .where(pkColumn as 'grade_code', '=', id)
        .execute();
    }
  }

  // --- Task 12.2 Grade Specifications ---

  /**
   * Stores a grade specification. Supports customer-specific specs.
   */
  static async createGradeSpec(data: any) {
    const id = data.id || crypto.randomUUID();
    await db.insertInto('master.grade_spec').values({
      ...data,
      customer_id: data.customerId || null,
    }).execute();
    return id;
  }

  /**
   * Resolves a grade spec with fallback logic.
   * If customer-specific spec exists, returns it. Otherwise returns default (customer_id IS NULL).
   */
  static async getGradeSpec(gradeCode: string, customerId?: string) {
    if (customerId) {
      const specific = await db.selectFrom('master.grade_spec')
        .selectAll()
        .where('grade_code', '=', gradeCode)
        .where('customer_id', '=', Number(customerId))
        .executeTakeFirst();

      if (specific) return specific;
    }

    const fallback = await db.selectFrom('master.grade_spec')
      .selectAll()
      .where('grade_code', '=', gradeCode)
      .where('customer_id', 'is', null)
      .executeTakeFirst();

    return fallback;
  }
}
