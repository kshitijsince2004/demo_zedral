import { Kysely } from 'kysely';
import { Database } from '../db';
import { getTenantId } from '../context';
import { withTenantContext } from '../db';

/**
 * BaseRepository enforces tenant isolation at the application layer.
 * All DB operations are wrapped in `withTenantContext` to also enforce RLS at the DB layer.
 */
export class BaseRepository<TableName extends keyof Database> {
  constructor(protected readonly tableName: TableName) {}

  /**
   * Helper to ensure tenant_id is always applied.
   */
  protected get tenantId(): string {
    const id = getTenantId();
    if (!id) {
      throw new Error('Tenant context is missing. Cross-tenant or unauthenticated access blocked.');
    }
    return id;
  }

  async findById(idColumn: string, id: any): Promise<any> {
    return withTenantContext(async (trx) => {
      return await trx.selectFrom(this.tableName)
        .selectAll()
        // Type casting any because Kysely typings for generic table names require complex inference
        .where(idColumn as any, '=', id)
        .where('tenant_id' as any, '=', this.tenantId)
        .executeTakeFirst();
    });
  }

  async insert(data: any): Promise<any> {
    return withTenantContext(async (trx) => {
      const dataWithTenant = {
        ...data,
        tenant_id: this.tenantId,
      };

      return await trx.insertInto(this.tableName)
        .values(dataWithTenant)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async update(idColumn: string, id: any, data: any): Promise<any> {
    return withTenantContext(async (trx) => {
      return await trx.updateTable(this.tableName)
        .set(data)
        .where(idColumn as any, '=', id)
        .where('tenant_id' as any, '=', this.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async delete(idColumn: string, id: any): Promise<any> {
    return withTenantContext(async (trx) => {
      return await trx.deleteFrom(this.tableName)
        .where(idColumn as any, '=', id)
        .where('tenant_id' as any, '=', this.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
}
