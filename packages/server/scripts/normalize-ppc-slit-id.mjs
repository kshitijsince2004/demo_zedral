/**
 * Align planning.ppc_batch.slit_id with the coil dash-suffix when they disagree.
 *
 * Usage:
 *   node --env-file=../../.env scripts/normalize-ppc-slit-id.mjs          # dry-run
 *   node --env-file=../../.env scripts/normalize-ppc-slit-id.mjs --apply  # write
 */
import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const apply = process.argv.includes('--apply');

const SELECT_SQL = `
SELECT pb.batch_id, pb.batch_number, pb.coil_no, pb.slit_id,
       substring(pb.coil_no from '-([A-Za-z0-9]{1,4})$') AS coil_suffix,
       pb.machine_code, pb.sub_process, pb.import_batch_id
FROM planning.ppc_batch pb
WHERE pb.coil_no ~ '-[A-Za-z0-9]{1,4}$'
  AND upper(coalesce(pb.slit_id,'')) <> upper(substring(pb.coil_no from '-([A-Za-z0-9]{1,4})$'))
`;

const UPDATE_SQL = `
UPDATE planning.ppc_batch
SET slit_id = upper(substring(coil_no from '-([A-Za-z0-9]{1,4})$'))
WHERE coil_no ~ '-[A-Za-z0-9]{1,4}$'
  AND upper(coalesce(slit_id,'')) <> upper(substring(coil_no from '-([A-Za-z0-9]{1,4})$'))
`;

const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
await client.connect();

try {
  const { rows } = await client.query(SELECT_SQL);
  const originImport = rows.filter((r) => r.import_batch_id).length;
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    divergentCount: rows.length,
    originImport,
    originFanoutOrSwap: rows.length - originImport,
    sample: rows.slice(0, 25),
  }, null, 2));

  if (!apply) {
    console.log('Dry-run only. Re-run with --apply to write.');
  } else if (rows.length > 0) {
    await client.query('BEGIN');
    const updated = await client.query(UPDATE_SQL);
    const verify = await client.query(SELECT_SQL);
    if (verify.rowCount !== 0) {
      await client.query('ROLLBACK');
      throw new Error(`verify still divergent: ${verify.rowCount} (expected 0)`);
    }
    await client.query('COMMIT');
    console.log(`Applied slit_id normalize to ${updated.rowCount} ppc_batch rows.`);
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
