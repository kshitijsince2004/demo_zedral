import { clearSwrIdbCache } from './swrCacheProvider';

const API_READ_CACHE = 'api-reads';

/** Clear session-scoped API caches on logout (SW + SWR idb). */
export async function clearSessionCaches(): Promise<void> {
  await clearSwrIdbCache();

  if (typeof caches === 'undefined') return;

  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name === API_READ_CACHE || name.startsWith('workbox-precache'))
        .map((name) => caches.delete(name)),
    );
  } catch {
    // Non-fatal.
  }
}
