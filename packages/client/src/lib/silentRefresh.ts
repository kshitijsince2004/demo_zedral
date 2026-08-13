/**
 * Cheap stable fingerprint for poll equality checks.
 * Single JSON.stringify with sorted object keys (no recursive string concat).
 */
function sortForHash(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortForHash);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sortForHash(obj[k]);
  return out;
}

/** Stable fingerprint for comparing poll results without recursive hash churn. */
export function jsonFingerprint(value: unknown): string {
  return JSON.stringify(sortForHash(value));
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  return jsonFingerprint(a) === jsonFingerprint(b);
}

/** Apply setState only when serialized value changed — skips React re-render. */
export function patchIfChanged<T>(
  next: T,
  prev: T,
  apply: (value: T) => void,
): boolean {
  if (jsonEqual(next, prev)) return false;
  apply(next);
  return true;
}
