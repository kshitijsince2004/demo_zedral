/** Stable JSON fingerprint for comparing poll results without reference churn. */
export function jsonFingerprint(value: unknown): string {
  return JSON.stringify(value);
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
