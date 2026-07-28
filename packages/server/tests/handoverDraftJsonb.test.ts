import { afterAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../src/db-types';
import { toPgJsonb } from '../src/utils/pgJsonb';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'm1_user',
  password: process.env.DB_PASSWORD || 'm1_password',
  database: process.env.DB_NAME || 'm1_db',
});

const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

const REMARKS = 'handover-jsonb-integration-test';

describe('handover open_stoppages jsonb insert', () => {
  afterAll(async () => {
    await db.deleteFrom('txn.machine_handover').where('remarks', '=', REMARKS).execute();
    await pool.end();
  });

  it('inserts non-empty open_stoppages array via toPgJsonb', async () => {
    const openStoppages = [
      {
        id: '1',
        categoryCode: 'MECH',
        categoryLabel: 'Mechanical',
        startAt: new Date().toISOString(),
        status: 'OPEN',
      },
    ];

    const row = await db
      .insertInto('txn.machine_handover')
      .values({
        machine_code: '4HI',
        process_code: '4HI',
        outgoing_shift_code: 'A',
        incoming_shift_code: 'B',
        outgoing_prod_date: new Date(),
        incoming_prod_date: new Date(),
        outgoing_operator_id: 1,
        machine_status: 'STOPPAGE',
        remarks: REMARKS,
        production_snapshot: { batchNumber: 'B1' } as any,
        open_stoppages: toPgJsonb(openStoppages) as any,
        queue_snapshot: { rolling: [], skinpass: [] } as any,
        status: 'DRAFT',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(Array.isArray(row.open_stoppages)).toBe(true);
    expect((row.open_stoppages as unknown[]).length).toBe(1);
  });
});
