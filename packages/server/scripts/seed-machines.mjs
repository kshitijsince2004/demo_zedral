#!/usr/bin/env node
/**
 * Idempotent master.machine registry + CRM sub-processes.
 * Safe to run on fresh production DB after migrations.
 */
import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const DEFAULT_URL = resolveDatabaseUrl();

/** @param {pg.Client | pg.PoolClient} client */
export async function seedMachines(client) {
  await client.query(`
    INSERT INTO master.process (process_id, code, name, seq_no, has_mill_type)
    VALUES (31, '6HI', '6HI', 31, FALSE)
    ON CONFLICT (process_id) DO UPDATE SET code = '6HI', name = '6HI';
  `);

  await client.query(`
    INSERT INTO master.machine (machine_code, process_id, name, process_code) VALUES
      ('6HI', 31, '6HI Mill', '6HI'),
      ('4HI', NULL, 'CRM 4HI', '6HI'),
      ('2HI', NULL, 'CRM 2HI', '6HI'),
      ('PKL', (SELECT process_id FROM master.process WHERE code = 'PKL' LIMIT 1), 'Pickling', 'PKL'),
      ('ANN', (SELECT process_id FROM master.process WHERE code = 'ANN' LIMIT 1), 'Annealing', 'ANN'),
      ('RWD', (SELECT process_id FROM master.process WHERE code = 'RWD' LIMIT 1), 'Rewinding', 'RWD'),
      ('CRS', (SELECT process_id FROM master.process WHERE code = 'CRS' LIMIT 1), 'CR Slitting', 'CRS'),
      ('CTL', (SELECT process_id FROM master.process WHERE code = 'CTL' LIMIT 1), 'CTL', 'CTL'),
      ('HRS', (SELECT process_id FROM master.process WHERE code = 'HRS' LIMIT 1), 'HR Slitting', 'HRS')
    ON CONFLICT (machine_code) DO UPDATE SET
      name = EXCLUDED.name,
      process_code = COALESCE(EXCLUDED.process_code, master.machine.process_code);
  `);

  await client.query(`
    INSERT INTO master.crm_sub_process (sub_process_code, name, machine_code) VALUES
      ('ROLLING', 'Rolling', '6HI'),
      ('SKIN_PASS', 'Skin Pass', '6HI')
    ON CONFLICT (sub_process_code) DO NOTHING;
  `);
}

async function main() {
  const client = new pg.Client({ connectionString: DEFAULT_URL });
  await client.connect();
  try {
    await seedMachines(client);
    const count = await client.query(`SELECT COUNT(*)::int AS n FROM master.machine`);
    console.log(`Machine registry ready (${count.rows[0].n} machines).`);
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1]?.includes('seed-machines');
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
