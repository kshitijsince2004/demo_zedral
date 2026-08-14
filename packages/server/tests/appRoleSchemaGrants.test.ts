import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { DB } from '../src/db-types';

const dbAvailable = process.env.VITEST_DB_AVAILABLE === '1';

function resolveConnectionString(): string {
  return (
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'm1_user'}:${process.env.DB_PASSWORD || 'm1_password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'm1_db'}`
  );
}

describe.skipIf(!dbAvailable)('m1_app schema grants', () => {
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
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it('has USAGE on config and canon, not CREATE', async () => {
    const rows = await sql<{
      config_usage: boolean;
      config_create: boolean;
      canon_usage: boolean;
      canon_create: boolean;
    }>`
      SELECT
        has_schema_privilege('m1_app', 'config', 'USAGE') AS config_usage,
        has_schema_privilege('m1_app', 'config', 'CREATE') AS config_create,
        has_schema_privilege('m1_app', 'canon', 'USAGE') AS canon_usage,
        has_schema_privilege('m1_app', 'canon', 'CREATE') AS canon_create
    `.execute(appDb);

    expect(rows.rows[0]?.config_usage).toBe(true);
    expect(rows.rows[0]?.config_create).toBe(false);
    expect(rows.rows[0]?.canon_usage).toBe(true);
    expect(rows.rows[0]?.canon_create).toBe(false);
  });

  it('can SELECT config.validation_rule and config.ruleset_version', async () => {
    await appDb.selectFrom('config.validation_rule').select('field_id').limit(1).execute();
    await appDb.selectFrom('config.ruleset_version').select('version').limit(1).execute();
  });
});
