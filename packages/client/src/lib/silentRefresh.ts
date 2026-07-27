function stableHash(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableHash(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableHash(val)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable fingerprint for comparing poll results without full JSON.stringify churn. */
export function jsonFingerprint(value: unknown): string {
  return stableHash(value);
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
