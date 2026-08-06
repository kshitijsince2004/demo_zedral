import { getElasticClient, isElasticAvailable } from './elasticClient';
import { logger } from '../utils/logger';

export const TRACEABILITY_INDEX = 'zedral_traceability';

/**
 * Elasticsearch index mapping for traceability documents.
 *
 * Each document represents one PPC batch row — the primary unit of
 * traceability search. Fields are typed to support:
 * - Exact keyword matching (batch_number, coil_no, sap_order_no, slit_id)
 * - Full-text search (customer_name, search_all)
 * - Autocomplete suggestions (batch_number_suggest, coil_no_suggest)
 * - Filtering (sub_process, machine_code, status, shift_code)
 * - Range queries (plan_date, weight_mt, thk_mm)
 */
const INDEX_MAPPING = {
  properties: {
    // ── Primary identifiers (exact match + copied to search_all) ──
    batch_id:          { type: 'long' as const },
    batch_number:      { type: 'keyword' as const, copy_to: 'search_all' },
    coil_no:           { type: 'keyword' as const, copy_to: 'search_all' },
    sap_order_no:      { type: 'keyword' as const, copy_to: 'search_all' },
    slit_id:           { type: 'keyword' as const, copy_to: 'search_all' },
    item_no:           { type: 'keyword' as const, copy_to: 'search_all' },

    // ── Descriptive fields ──
    customer_name:     { type: 'text' as const, analyzer: 'standard', copy_to: 'search_all' },
    grade_code:        { type: 'keyword' as const, copy_to: 'search_all' },

    // ── Categorical filters ──
    sub_process:       { type: 'keyword' as const },
    machine_code:      { type: 'keyword' as const },
    shift_code:        { type: 'keyword' as const },
    status:            { type: 'keyword' as const },

    // ── Numeric fields ──
    weight_mt:         { type: 'float' as const },
    thk_mm:            { type: 'float' as const },
    input_thk_mm:      { type: 'float' as const },

    // ── Date ──
    plan_date:         { type: 'date' as const },
    indexed_at:        { type: 'date' as const },

    // ── Composite search field (all keywords/text copied here) ──
    search_all:        { type: 'text' as const, analyzer: 'standard' },

    // ── Completion suggesters (for autocomplete) ──
    batch_number_suggest: { type: 'completion' as const },
    coil_no_suggest:      { type: 'completion' as const },
  },
};

/**
 * Creates the traceability index if it doesn't already exist.
 * Idempotent — safe to call on every server startup.
 */
export async function ensureIndex(): Promise<void> {
  if (!isElasticAvailable()) return;

  const client = getElasticClient();
  try {
    const exists = await client.indices.exists({ index: TRACEABILITY_INDEX });
    if (exists) {
      logger.info(`[elastic] Index "${TRACEABILITY_INDEX}" already exists`);
      return;
    }

    await client.indices.create({
      index: TRACEABILITY_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,   // local dev default; override in production
        refresh_interval: '1s',
      },
      mappings: INDEX_MAPPING,
    });
    logger.info(`[elastic] Created index "${TRACEABILITY_INDEX}"`);
  } catch (err: any) {
    console.error(`[elastic] Failed to ensure index: ${err.message}`);
  }
}
