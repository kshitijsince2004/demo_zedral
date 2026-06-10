import { getElasticClient, isElasticAvailable } from '../elastic/elasticClient';
import { TRACEABILITY_INDEX } from '../elastic/traceabilityIndex';

export interface ElasticSearchHit {
  batch_id: number;
  batch_number: string;
  coil_no: string;
  sap_order_no: string | null;
  slit_id: string | null;
  customer_name: string;
  grade_code: string;
  sub_process: string;
  machine_code: string;
  status: string;
  weight_mt: number;
  plan_date: string;
  score: number;
}

export interface SuggestionResult {
  text: string;
  type: 'batch' | 'coil' | 'sap_order' | 'slit';
  score: number;
}

export class ElasticTraceabilityService {
  /**
   * Full-text search across the traceability index.
   *
   * Uses a bool query with:
   * - Exact keyword matches on batch_number, coil_no, sap_order_no, slit_id (boosted)
   * - Fuzzy full-text match on the search_all composite field
   * - Prefix match for partial queries
   *
   * Returns top 10 candidates ranked by relevance.
   */
  static async search(query: string): Promise<ElasticSearchHit[]> {
    if (!isElasticAvailable()) return [];

    const client = getElasticClient();
    const q = query.trim();
    if (!q) return [];

    try {
      const result = await client.search({
        index: TRACEABILITY_INDEX,
        size: 10,
        query: {
          bool: {
            should: [
              // Exact matches on keyword fields — highest boost
              { term: { batch_number: { value: q, boost: 10 } } },
              { term: { coil_no: { value: q, boost: 10 } } },
              { term: { sap_order_no: { value: q, boost: 8 } } },
              { term: { slit_id: { value: q, boost: 8 } } },
              { term: { item_no: { value: q, boost: 6 } } },

              // Prefix match for partial input
              { prefix: { batch_number: { value: q, boost: 5 } } },
              { prefix: { coil_no: { value: q, boost: 5 } } },
              { prefix: { sap_order_no: { value: q, boost: 3 } } },

              // Fuzzy full-text on composite field
              {
                match: {
                  search_all: {
                    query: q,
                    fuzziness: 'AUTO',
                    operator: 'or' as const,
                    boost: 2,
                  },
                },
              },

              // Wildcard for embedded substrings (e.g., "9901" matching "HR-9901-C")
              { wildcard: { batch_number: { value: `*${q}*`, boost: 1 } } },
              { wildcard: { coil_no: { value: `*${q}*`, boost: 1 } } },
            ],
            minimum_should_match: 1,
          },
        },
      });

      const hits = result.hits?.hits ?? [];
      return hits.map((hit: any) => ({
        ...hit._source,
        batch_id: Number(hit._source.batch_id),
        weight_mt: Number(hit._source.weight_mt),
        score: hit._score ?? 0,
      }));
    } catch (err: any) {
      console.error(`[elastic] Search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Autocomplete suggestions using ES completion suggesters.
   *
   * Returns up to 8 suggestions with type labels.
   */
  static async suggest(query: string): Promise<SuggestionResult[]> {
    if (!isElasticAvailable()) return [];

    const client = getElasticClient();
    const q = query.trim();
    if (!q || q.length < 2) return [];

    try {
      const result = await client.search({
        index: TRACEABILITY_INDEX,
        _source: false,
        suggest: {
          batch_suggest: {
            prefix: q,
            completion: {
              field: 'batch_number_suggest',
              size: 5,
              skip_duplicates: true,
            },
          },
          coil_suggest: {
            prefix: q,
            completion: {
              field: 'coil_no_suggest',
              size: 5,
              skip_duplicates: true,
            },
          },
        },
      });

      const suggestions: SuggestionResult[] = [];
      const seen = new Set<string>();

      // Process batch suggestions
      const batchOptions = (result as any).suggest?.batch_suggest?.[0]?.options ?? [];
      for (const opt of batchOptions) {
        const text = opt.text;
        if (!seen.has(text)) {
          seen.add(text);
          suggestions.push({ text, type: 'batch', score: opt._score ?? 0 });
        }
      }

      // Process coil suggestions
      const coilOptions = (result as any).suggest?.coil_suggest?.[0]?.options ?? [];
      for (const opt of coilOptions) {
        const text = opt.text;
        if (!seen.has(text)) {
          seen.add(text);
          suggestions.push({ text, type: 'coil', score: opt._score ?? 0 });
        }
      }

      // Sort by score descending, limit to 8
      suggestions.sort((a, b) => b.score - a.score);
      return suggestions.slice(0, 8);
    } catch (err: any) {
      console.error(`[elastic] Suggest failed: ${err.message}`);
      return [];
    }
  }
}
