/**
 * Bind values for PostgreSQL json/jsonb columns via node-pg.
 * JS arrays must be JSON-stringified — node-pg sends them as PG array literals ({...}),
 * which jsonb rejects with "invalid input syntax for type json".
 */
export function toPgJsonb(value: unknown): unknown {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}
