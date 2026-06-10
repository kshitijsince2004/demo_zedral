import { Client } from '@elastic/elasticsearch';

// ── Configuration ───────────────────────────────────────────────────────────
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const ELASTICSEARCH_API_KEY = process.env.ELASTICSEARCH_API_KEY;
const ELASTICSEARCH_USERNAME = process.env.ELASTICSEARCH_USERNAME;
const ELASTICSEARCH_PASSWORD = process.env.ELASTICSEARCH_PASSWORD;

// ── Client Singleton ────────────────────────────────────────────────────────
function createClient(): Client {
  const opts: ConstructorParameters<typeof Client>[0] = {
    node: ELASTICSEARCH_URL,
  };

  if (ELASTICSEARCH_API_KEY) {
    opts.auth = { apiKey: ELASTICSEARCH_API_KEY };
  } else if (ELASTICSEARCH_USERNAME && ELASTICSEARCH_PASSWORD) {
    opts.auth = { username: ELASTICSEARCH_USERNAME, password: ELASTICSEARCH_PASSWORD };
  }

  return new Client(opts);
}

let _client: Client | null = null;
let _available = false;

/** Returns the shared Elasticsearch client instance. */
export function getElasticClient(): Client {
  if (!_client) {
    _client = createClient();
  }
  return _client;
}

/** Whether ES is reachable (set at startup by `checkElasticHealth`). */
export function isElasticAvailable(): boolean {
  return _available;
}

/**
 * Pings the ES cluster and caches the result.
 * Call once at server startup; non-fatal if ES is unreachable.
 */
export async function checkElasticHealth(): Promise<boolean> {
  try {
    const client = getElasticClient();
    await client.ping();
    _available = true;
    console.log(`[elastic] Connected to ${ELASTICSEARCH_URL}`);
    return true;
  } catch (err: any) {
    _available = false;
    console.warn(`[elastic] Elasticsearch unavailable at ${ELASTICSEARCH_URL} — traceability search will use PostgreSQL fallback. Error: ${err.message}`);
    return false;
  }
}
