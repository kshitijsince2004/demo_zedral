import { del, get, set } from 'idb-keyval';
import type { Cache } from 'swr';

const SWR_IDB_KEY = 'm1:swr-cache-v1';
/** Stale persisted entries older than this are dropped on load, except offline-critical keys. */
const TTL_MS = 24 * 60 * 60 * 1000;
/** Hub/queue keys must survive cold start offline regardless of age. */
export const CRITICAL_KEY_RE = /queue|hub/i;

type SWRPersistedMap = Map<string, unknown>;
type TimestampedEntry = { v: unknown; t: number };

function isTimestamped(x: unknown): x is TimestampedEntry {
  return !!x && typeof x === 'object' && 't' in (x as Record<string, unknown>) && 'v' in (x as Record<string, unknown>);
}

function isEnabled(): boolean {
  return import.meta.env.VITE_SWR_IDB_CACHE !== 'false';
}

function cacheMaxEntries(): number {
  const raw = import.meta.env.VITE_SWR_CACHE_MAX;
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function periodicPersistEnabled(): boolean {
  return import.meta.env.VITE_SWR_PERIODIC_PERSIST === 'true';
}

/**
 * Map-shaped SWR cache with LRU eviction for non-critical keys.
 * Critical keys (/queue|hub/i) are never evicted; size may exceed max if only those remain.
 */
export class BoundedLruMap<V = unknown> implements Map<string, V> {
  private readonly map = new Map<string, V>();

  constructor(
    private readonly maxEntries: number,
    private readonly isCritical: (key: string) => boolean = (k) => CRITICAL_KEY_RE.test(k),
  ) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    // Bump recency
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): this {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    this.evictIfNeeded();
    return this;
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(): MapIterator<string> {
    return this.map.keys();
  }

  values(): MapIterator<V> {
    return this.map.values();
  }

  entries(): MapIterator<[string, V]> {
    return this.map.entries();
  }

  forEach(cb: (value: V, key: string, map: Map<string, V>) => void, thisArg?: unknown): void {
    this.map.forEach(cb, thisArg);
  }

  [Symbol.iterator](): MapIterator<[string, V]> {
    return this.map[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return 'Map';
  }

  private evictIfNeeded(): void {
    if (this.maxEntries <= 0) return;
    while (this.map.size > this.maxEntries) {
      let evicted = false;
      for (const key of this.map.keys()) {
        if (this.isCritical(key)) continue;
        this.map.delete(key);
        evicted = true;
        break;
      }
      if (!evicted) break; // only critical keys left
    }
  }
}

export function createSwrCacheMap(): SWRPersistedMap {
  const max = cacheMaxEntries();
  return max > 0 ? new BoundedLruMap(max) : new Map();
}

async function loadMap(): Promise<SWRPersistedMap> {
  if (!isEnabled()) return new Map();
  try {
    const stored = (await get<[string, unknown][]>(SWR_IDB_KEY)) ?? [];
    const now = Date.now();
    const map = createSwrCacheMap();
    for (const [key, raw] of stored) {
      if (isTimestamped(raw)) {
        if (CRITICAL_KEY_RE.test(key) || now - raw.t <= TTL_MS) map.set(key, raw.v);
      } else {
        // Legacy entry with no timestamp — keep once; will be re-persisted with a ts on next flush.
        map.set(key, raw);
      }
    }
    return map;
  } catch {
    return createSwrCacheMap();
  }
}

async function persistMap(map: SWRPersistedMap): Promise<void> {
  if (!isEnabled()) return;
  try {
    const t = Date.now();
    const entries: [string, TimestampedEntry][] = [...map.entries()].map(([k, v]) => [k, { v, t }]);
    await set(SWR_IDB_KEY, entries);
  } catch {
    // Non-fatal — in-memory SWR cache still works.
  }
}

/** Hydrate SWR from IndexedDB; flush on tab hide / unload (+ optional periodic). */
export function makeIdbCacheProvider(): (() => Cache) | undefined {
  if (!isEnabled()) return undefined;

  return () => {
    const map = createSwrCacheMap();
    let hydrated = false;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;

    const hydrate = () => {
      if (hydrated) return;
      hydrated = true;
      void loadMap().then((loaded) => {
        for (const [key, value] of loaded) {
          if (!map.has(key)) map.set(key, value);
        }
      });
    };

    hydrate();

    const flush = () => {
      void persistMap(map);
    };

    const schedulePersist = () => {
      if (!periodicPersistEnabled()) return;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        flush();
      }, 5_000);
    };

    // Debounced flush after writes when periodic persist is on.
    if (periodicPersistEnabled()) {
      const origSet = map.set.bind(map);
      map.set = ((key: string, value: unknown) => {
        const ret = origSet(key, value);
        schedulePersist();
        return ret;
      }) as typeof map.set;
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
      window.addEventListener('beforeunload', flush);
    }

    return map;
  };
}

/** Clear persisted SWR cache (call on logout). */
export async function clearSwrIdbCache(): Promise<void> {
  try {
    await del(SWR_IDB_KEY);
  } catch {
    // ignore
  }
}
