import { sql, type Kysely } from 'kysely';
import { db, type Database } from '../db';
import { getCorrelationId, getTenantId } from '../context';

export async function withTenant<T>(
  callback: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error('Tenant context is required');
  }

  const correlationId = getCorrelationId() ?? 'unknown';
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    await sql`SELECT set_config('app.correlation_id', ${correlationId}, true)`.execute(trx);
    return callback(trx);
  });
}
