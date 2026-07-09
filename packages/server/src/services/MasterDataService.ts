import { db } from '../db';

export class MasterDataService {
  /**
   * Retrieves all master data for a given table, filtering by is_active by default.
   */
  static async getAll(tableName: string, includeInactive: boolean = false) {
    let query = db.selectFrom(tableName as any).selectAll();
    
    // Not all tables have is_active, but for the ones that do (customer, grade, defect_code, stoppage_code, operator)
    if (!includeInactive) {
      if (['master.customer', 'master.grade', 'master.defect_code', 'master.stoppage_code', 'master.operator'].includes(tableName)) {
        query = query.where('is_active', '=', true);
      }
    }
    return await query.execute();
  }

  /**
   * Retrieves a single master data record by its code/id.
   */
  static async getById(tableName: string, pkColumn: string, id: string) {
    return await db.selectFrom(tableName as any)
      .selectAll()
      .where(pkColumn as any, '=', id)
      .executeTakeFirst();
  }

  /**
   * Creates a new master data record.
   */
  static async create(tableName: string, pkColumn: string, data: any) {
    let values = { ...data };

    if (tableName === 'master.defect_code') {
      values = {
        defect_code: data.defect_code ?? data.code,
        description: data.description ?? data.name,
        symbol: data.symbol ?? null,
        applies_to: data.applies_to ?? data.category ?? 'CRM6',
        is_active: data.is_active ?? data.isActive ?? true,
      };
    }

    if (['master.customer', 'master.grade', 'master.defect_code', 'master.stoppage_code', 'master.operator'].includes(tableName)) {
        values.is_active = values.is_active ?? true;
    }

    const result = await db.insertInto(tableName as any)
      .values(values)
      .returning(pkColumn as any)
      .executeTakeFirst();
      
    return (result as any)[pkColumn];
  }

  /**
   * Updates an existing master data record.
   */
  static async update(tableName: string, pkColumn: string, id: string, data: any) {
    let values = { ...data };
    if (tableName === 'master.defect_code') {
      values = {
        ...(data.description != null || data.name != null
          ? { description: data.description ?? data.name }
          : {}),
        ...(data.symbol !== undefined ? { symbol: data.symbol } : {}),
        ...(data.applies_to !== undefined || data.category !== undefined
          ? { applies_to: data.applies_to ?? data.category }
          : {}),
        ...(data.is_active !== undefined || data.isActive !== undefined
          ? { is_active: data.is_active ?? data.isActive }
          : {}),
      };
    }
    await db.updateTable(tableName as any)
      .set(values)
      .where(pkColumn as any, '=', id)
      .execute();
  }

  /**
   * Soft-deletes a master data record.
   */
  static async deactivate(tableName: string, pkColumn: string, id: string) {
    if (['master.customer', 'master.grade', 'master.defect_code', 'master.stoppage_code', 'master.operator'].includes(tableName)) {
        await db.updateTable(tableName as any)
          .set({ is_active: false })
          .where(pkColumn as any, '=', id)
          .execute();
    } else {
        await db.deleteFrom(tableName as any)
          .where(pkColumn as any, '=', id)
          .execute();
    }
  }

  // --- Task 12.2 Grade Specifications ---

  /**
   * Stores a grade specification. Supports customer-specific specs.
   */
  static async createGradeSpec(data: any) {
    const id = data.id || crypto.randomUUID();
    // Unique constraint on (grade_code, customer_id) is handled by the DB schema
    await db.insertInto('master.grade_spec' as any).values({
      ...data,
      customer_id: data.customerId || null
    }).execute();
    return id;
  }

  /**
   * Resolves a grade spec with fallback logic.
   * If customer-specific spec exists, returns it. Otherwise returns default (customer_id IS NULL).
   */
  static async getGradeSpec(gradeCode: string, customerId?: string) {
    if (customerId) {
      const specific = await db.selectFrom('master.grade_spec' as any)
        .selectAll()
        .where('grade_code', '=', gradeCode)
        .where('customer_id', '=', customerId)
        .executeTakeFirst();
      
      if (specific) return specific;
    }

    // Fallback to default
    const fallback = await db.selectFrom('master.grade_spec' as any)
      .selectAll()
      .where('grade_code', '=', gradeCode)
      .where('customer_id', 'is', null)
      .executeTakeFirst();

    return fallback;
  }
}
