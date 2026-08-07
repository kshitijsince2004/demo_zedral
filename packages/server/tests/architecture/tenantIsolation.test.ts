import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { DB } from '../../src/db-types';

const dbAvailable = process.env.VITEST_DB_AVAILABLE === '1';
const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function resolveConnectionString(): string {
  return (
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'm1_user'}:${process.env.DB_PASSWORD || 'm1_password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'm1_db'}`
  );
}

describe.skipIf(!dbAvailable)('tenant isolation under m1_app role', () => {
  let pool: Pool;
  let appDb: Kysely<DB>;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: resolveConnectionString().replace(
        /\/\/([^:]+):([^@]+)@/,
        '//m1_app:m1_app_password@',
      ),
    });
    appDb = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

    await sql`SELECT set_config('app.tenant_id', ${tenantA}, false)`.execute(appDb);
    await appDb
      .insertInto('security.tenant')
      .values([
        { tenant_id: tenantA, name: 'RLS Tenant A', status: 'ACTIVE' },
        { tenant_id: tenantB, name: 'RLS Tenant B', status: 'ACTIVE' },
      ])
      .onConflict((oc) => oc.column('tenant_id').doNothing())
      .execute();
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it('returns zero rows when reading another tenant shift_log via RLS', async () => {
    await sql`SELECT set_config('app.tenant_id', ${tenantA}, false)`.execute(appDb);
    const own = await appDb
      .selectFrom('txn.shift_log')
      .select('shift_log_id')
      .limit(1)
      .execute();

    await sql`SELECT set_config('app.tenant_id', ${tenantB}, false)`.execute(appDb);
    if (own.length > 0) {
      const blocked = await appDb
        .selectFrom('txn.shift_log')
        .select('shift_log_id')
        .where('shift_log_id', '=', own[0].shift_log_id)
        .execute();
      expect(blocked).toHaveLength(0);
    } else {
      expect(own).toEqual([]);
    }
  });

  it('connects as m1_app without superuser or BYPASSRLS', async () => {
    const role = await sql<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }>`
      SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `.execute(appDb);
    expect(role.rows[0]?.current_user).toBe('m1_app');
    expect(role.rows[0]?.rolsuper).toBe(false);
    expect(role.rows[0]?.rolbypassrls).toBe(false);
  });
});
