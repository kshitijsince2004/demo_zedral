#!/usr/bin/env node

/**
 * Standalone script to bulk re-index all PPC batches from PostgreSQL
 * into Elasticsearch. Run with:
 *   npm run reindex:traceability
 */

import 'dotenv/config';
import { checkElasticHealth } from '../src/elastic/elasticClient.ts';
import { ensureIndex } from '../src/elastic/traceabilityIndex.ts';
import { reindexAll } from '../src/elastic/traceabilityIndexer.ts';

async function main() {
  console.log('=== Traceability Re-index ===\n');

  const ok = await checkElasticHealth();
  if (!ok) {
    console.error('Elasticsearch is not reachable. Aborting.');
    process.exit(1);
  }

  await ensureIndex();

  const { total, indexed, errors } = await reindexAll();
  console.log(`\nDone. ${indexed}/${total} documents indexed, ${errors} errors.`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Re-index failed:', err);
  process.exit(1);
});
