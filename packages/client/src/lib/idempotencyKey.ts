/** UUID v5 namespace for outbox / immediate-write keys (RFC 4122). */
const NAMESPACE = 'c0ffee00-5e1f-41d0-a000-0000c0ffee01';

export type IdempotencyKeyInput = {
  aggregateKey: string;
  method: string;
  url: string;
  payload: unknown;
};

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function bytesToUuidV5(bytes: Uint8Array): string {
  const b = bytes.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Deterministic 20-byte digest when SubtleCrypto SHA-1 is unavailable. */
function fallbackHash20(text: string): Uint8Array {
  const out = new Uint8Array(20);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
    h3 = Math.imul(h3 + c, 3266489917);
  }
  const words = [h1, h2, h3, h1 ^ h2, h2 ^ h3];
  for (let i = 0; i < 5; i++) {
    const w = words[i] >>> 0;
    out[i * 4] = (w >>> 24) & 0xff;
    out[i * 4 + 1] = (w >>> 16) & 0xff;
    out[i * 4 + 2] = (w >>> 8) & 0xff;
    out[i * 4 + 3] = w & 0xff;
  }
  return out;
}

async function sha1Bytes(text: string): Promise<Uint8Array> {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.subtle) {
    const buf = await cryptoObj.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return new Uint8Array(buf);
  }
  return fallbackHash20(text);
}

/**
 * Stable UUID v5 for a logical write. Repeat taps with the same aggregate +
 * method + url + payload produce the same key; a different payload does not.
 */
export async function computeIdempotencyKey(input: IdempotencyKeyInput): Promise<string> {
  const material = [
    NAMESPACE,
    input.aggregateKey,
    input.method.toUpperCase(),
    input.url,
    canonicalJson(input.payload ?? null),
  ].join('\n');
  return bytesToUuidV5(await sha1Bytes(material));
}

const TAP_LOCK_MS = 750;
const tapUntil = new Map<string, number>();
const inflight = new Map<string, Promise<unknown>>();

export function isTapLocked(aggregateKey: string, now = Date.now()): boolean {
  const until = tapUntil.get(aggregateKey);
  return until != null && now < until;
}

export function markTapLock(aggregateKey: string, ms = TAP_LOCK_MS): void {
  tapUntil.set(aggregateKey, Date.now() + ms);
}

/** Coalesce concurrent calls for the same aggregate; also applies the 750ms tap lock. */
export function withTapLock<T>(aggregateKey: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(aggregateKey);
  if (existing) return existing as Promise<T>;
  markTapLock(aggregateKey);
  const pending = fn().finally(() => {
    if (inflight.get(aggregateKey) === pending) inflight.delete(aggregateKey);
  });
  inflight.set(aggregateKey, pending);
  return pending;
}
