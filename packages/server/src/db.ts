import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql, CompiledQuery, Driver, DatabaseConnection, TransactionSettings } from 'kysely';

import type { DB } from './db-types';
import { getTenantId, getCorrelationId, requestContext } from './context';

export type Database = DB;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

/** Sanitize GUC values to prevent SQL injection in set_config calls. */
function safeGuc(value: string, pattern: RegExp, fallback = ''): string {
  return pattern.test(value) ? value : fallback;
}

class RlsDriver implements Driver {
  constructor(private readonly driver: Driver) {}
  
  async init(): Promise<void> {
    await this.driver.init();
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const conn = await this.driver.acquireConnection();
    const store = requestContext.getStore();
    const userId = safeGuc(store?.user?.id?.toString() ?? '', /^\d*$/);
    const crId = safeGuc(store?.change_request_id ?? '', /^[\w-]*$/);
    const tenantId = safeGuc(store?.tenant_id ?? DEFAULT_TENANT, UUID_RE, DEFAULT_TENANT);

    await conn.executeQuery(CompiledQuery.raw(`SELECT set_config('app.user_id', '${userId}', false)`));
    await conn.executeQuery(CompiledQuery.raw(`SELECT set_config('app.change_request_id', '${crId}', false)`));
    await conn.executeQuery(CompiledQuery.raw(`SELECT set_config('app.tenant_id', '${tenantId}', false)`));
    return conn;
  }

  async releaseConnection(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw(`SELECT set_config('app.user_id', '', false)`));
    await conn.executeQuery(CompiledQuery.raw(`SELECT set_config('app.change_request_id', '', false)`));
    await conn.executeQuery(CompiledQuery.raw(`SELECT set_config('app.tenant_id', '', false)`));
    await this.driver.releaseConnection(conn);
  }

  async beginTransaction(conn: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    await this.driver.beginTransaction(conn, settings);
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await this.driver.commitTransaction(conn);
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await this.driver.rollbackTransaction(conn);
  }

  async destroy(): Promise<void> {
    await this.driver.destroy();
  }
}

class RlsPostgresDialect extends PostgresDialect {
  createDriver(): Driver {
    return new RlsDriver(super.createDriver());
  }
}

function resolvePrimaryPoolConfig(): ConstructorParameters<typeof Pool>[0] {
  const url = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (url) {
    return { connectionString: url, max: 20 };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'm1_user',
    password: process.env.DB_PASSWORD || 'm1_password',
    database: process.env.DB_NAME || 'm1_db',
    max: 20,
  };
}

function resolveReplicaPoolConfig(): ConstructorParameters<typeof Pool>[0] | null {
  if (!process.env.DB_REPLICA_HOST) {
    return null;
  }

  return {
    host: process.env.DB_REPLICA_HOST,
    port: parseInt(process.env.DB_REPLICA_PORT || '5432', 10),
    user: process.env.DB_USER || 'm1_user',
    password: process.env.DB_PASSWORD || 'm1_password',
    database: process.env.DB_NAME || 'm1_db',
    max: 20,
  };
}

// OLTP connection pool
const primaryPool = new Pool(resolvePrimaryPoolConfig());

const replicaPoolConfig = resolveReplicaPoolConfig();
const replicaPool = replicaPoolConfig ? new Pool(replicaPoolConfig) : primaryPool;

export const db = new Kysely<Database>({
  dialect: new RlsPostgresDialect({
    pool: primaryPool,
  }),
});

export const readDb = replicaPoolConfig
  ? new Kysely<Database>({
      dialect: new RlsPostgresDialect({
        pool: replicaPool,
      }),
    })
  : db;

/**
 * Reporting/analytics queries use the read replica when DB_REPLICA_HOST is set.
 * In local dev (no replica), falls back to the primary so dashboards still work.
 */
export const reportingDb = process.env.DB_REPLICA_HOST ? readDb : db;

/**
 * BaseRepository concept:
 * Executes a callback within a transaction where the RLS tenant context is set.
 * If no tenant is present in RequestContext, it sets it to an empty UUID to enforce default-deny.
 */
export async function withTenantContext<T>(callback: (trx: Kysely<Database>) => Promise<T>): Promise<T> {
  const tenantId = getTenantId() || '00000000-0000-0000-0000-000000000000'; // Default deny if unset
  const correlationId = getCorrelationId() || 'unknown';

  return await db.transaction().execute(async (trx) => {
    // Set the GUC for RLS policies and audit logs using set_config so we can parameterize
    await sql`SELECT set_config('app.tenant_id', ${tenantId}::text, true)`.execute(trx);
    await sql`SELECT set_config('app.correlation_id', ${correlationId}::text, true)`.execute(trx);
    return await callback(trx as any);
  });
}
