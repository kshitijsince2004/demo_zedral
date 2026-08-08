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
      // ponytail: kysely 0.28 loses callable .where when TableName is a generic keyof
      return await (trx as any)
        .selectFrom(this.tableName)
        .selectAll()
        .where(idColumn, '=', id)
        .where('tenant_id', '=', this.tenantId)
        .executeTakeFirst();
    });
  }

  async insert(data: any): Promise<any> {
    return withTenantContext(async (trx) => {
      const dataWithTenant = {
        ...data,
        tenant_id: this.tenantId,
      };

      return await (trx as any)
        .insertInto(this.tableName)
        .values(dataWithTenant)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async update(idColumn: string, id: any, data: any): Promise<any> {
    return withTenantContext(async (trx) => {
      return await (trx as any)
        .updateTable(this.tableName)
        .set(data)
        .where(idColumn, '=', id)
        .where('tenant_id', '=', this.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async delete(idColumn: string, id: any): Promise<any> {
    return withTenantContext(async (trx) => {
      return await (trx as any)
        .deleteFrom(this.tableName)
        .where(idColumn, '=', id)
        .where('tenant_id', '=', this.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
}
