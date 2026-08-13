import { getElasticClient, isElasticAvailable, checkElasticHealth } from './elasticClient';
import { TRACEABILITY_INDEX } from './traceabilityIndex';
import { db } from '../db';
import { formatPlantDate } from '@m1/shared-validation';
import { logger } from '../utils/logger';

/** Shape of a document stored in the traceability index. */
export interface TraceabilityDoc {
  batch_id: number;
  batch_number: string;
  coil_no: string;
  sap_order_no: string | null;
  slit_id: string | null;
  item_no: string | null;
  customer_name: string;
  grade_code: string;
  sub_process: string;
  machine_code: string;
  shift_code: string;
  status: string;
  weight_mt: number;
  thk_mm: number;
  input_thk_mm: number | null;
  plan_date: string;
  indexed_at: string;
  batch_number_suggest: string;
  coil_no_suggest: string;
}

/**
 * Converts a PPC batch row from PostgreSQL into an ES document.
 */
function batchRowToDoc(row: any): TraceabilityDoc {
  return {
    batch_id: Number(row.batch_id),
    batch_number: row.batch_number,
    coil_no: row.coil_no,
    sap_order_no: row.sap_order_no ?? null,
    slit_id: row.slit_id ?? null,
    item_no: row.item_no ?? null,
    customer_name: row.customer_name,
    grade_code: row.grade_code,
    sub_process: row.sub_process,
    machine_code: row.machine_code,
    shift_code: row.shift_code,
    status: 'PENDING', // default; can be enriched with CRM6 status later
    weight_mt: Number(row.ppc_weight_mt),
    thk_mm: Number(row.ppc_thk_mm),
    input_thk_mm: row.input_thk_mm != null ? Number(row.input_thk_mm) : null,
    plan_date: formatPlantDate(row.plan_date),
    indexed_at: new Date().toISOString(),
    batch_number_suggest: row.batch_number,
    coil_no_suggest: row.coil_no,
  };
}

/**
 * Index a single PPC batch document into Elasticsearch.
 * Uses batch_id as the document ID for idempotent upserts.
 */
export async function indexBatch(batchRow: any): Promise<void> {
  if (!isElasticAvailable()) return;

  const client = getElasticClient();
  const doc = batchRowToDoc(batchRow);
  try {
    await client.index({
      index: TRACEABILITY_INDEX,
      id: String(doc.batch_id),
      body: doc,
    });
  } catch (err: any) {
    logger.error(`[elastic] Failed to index batch ${doc.batch_number}: ${err.message}`);
  }
}

/**
 * Bulk-index multiple PPC batch rows.
 * Used for initial seeding and re-indexing.
 */
export async function indexBulk(batchRows: any[]): Promise<{ indexed: number; errors: number }> {
  if (!isElasticAvailable() || batchRows.length === 0) {
    return { indexed: 0, errors: 0 };
  }

  const client = getElasticClient();
  const body: any[] = [];

  for (const row of batchRows) {
    const doc = batchRowToDoc(row);
    body.push(
      { index: { _index: TRACEABILITY_INDEX, _id: String(doc.batch_id) } },
      doc,
    );
  }

  try {
    const result = await client.bulk({ body, refresh: 'false' });
    const errorCount = result.items?.filter((item: any) => item.index?.error).length ?? 0;
    return { indexed: batchRows.length - errorCount, errors: errorCount };
  } catch (err: any) {
    logger.error(`[elastic] Bulk index failed: ${err.message}`);
    return { indexed: 0, errors: batchRows.length };
  }
}

/**
 * Remove a batch document from the index.
 */
export async function removeBatch(batchId: number | string): Promise<void> {
  if (!isElasticAvailable()) return;

  const client = getElasticClient();
  try {
    await client.delete({
      index: TRACEABILITY_INDEX,
      id: String(batchId),
    });
  } catch (err: any) {
    // 404 is fine — document may not have been indexed
    if (err.meta?.statusCode !== 404) {
      logger.error(`[elastic] Failed to remove batch ${batchId}: ${err.message}`);
    }
  }
}

/**
 * Full re-index: reads all PPC batches from PostgreSQL and bulk-indexes
 * them into Elasticsearch. Processes in pages of 1000.
 */
export async function reindexAll(): Promise<{ total: number; indexed: number; errors: number }> {
  if (!isElasticAvailable()) {
    const ok = await checkElasticHealth();
    if (!ok) {
      throw new Error('Elasticsearch is not available');
    }
  }

  const PAGE_SIZE = 1000;
  let offset = 0;
  let totalIndexed = 0;
  let totalErrors = 0;
  let totalRows = 0;

  logger.info('[elastic] Starting full re-index of traceability data...');

  while (true) {
    const rows = await db.selectFrom('planning.ppc_batch')
      .selectAll()
      .orderBy('batch_id', 'asc')
      .limit(PAGE_SIZE)
      .offset(offset)
      .execute();

    if (rows.length === 0) break;

    totalRows += rows.length;
    const { indexed, errors } = await indexBulk(rows);
    totalIndexed += indexed;
    totalErrors += errors;

    logger.info(`[elastic] Indexed page at offset ${offset}: ${indexed} ok, ${errors} errors`);
    offset += PAGE_SIZE;
  }

  // Final refresh so documents are immediately searchable
  const client = getElasticClient();
  await client.indices.refresh({ index: TRACEABILITY_INDEX });

  logger.info(`[elastic] Re-index complete: ${totalIndexed}/${totalRows} indexed, ${totalErrors} errors`);
  return { total: totalRows, indexed: totalIndexed, errors: totalErrors };
}
