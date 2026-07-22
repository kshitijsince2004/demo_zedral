import { del, get, set } from 'idb-keyval';
import type { Cache } from 'swr';

const SWR_IDB_KEY = 'm1:swr-cache-v1';

type SWRPersistedMap = Map<string, unknown>;

function isEnabled(): boolean {
  return import.meta.env.VITE_SWR_IDB_CACHE !== 'false';
}

async function loadMap(): Promise<SWRPersistedMap> {
  if (!isEnabled()) return new Map();
  try {
    const stored = await get<[string, unknown][]>(SWR_IDB_KEY);
    return new Map(stored ?? []);
  } catch {
    return new Map();
  }
}

async function persistMap(map: SWRPersistedMap): Promise<void> {
  if (!isEnabled()) return;
  try {
    await set(SWR_IDB_KEY, [...map.entries()]);
  } catch {
    // Non-fatal — in-memory SWR cache still works.
  }
}

/** Hydrate SWR from IndexedDB; flush on tab hide / unload. */
export function makeIdbCacheProvider(): (() => Cache) | undefined {
  if (!isEnabled()) return undefined;

  return () => {
    const map: SWRPersistedMap = new Map();
    let hydrated = false;

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
