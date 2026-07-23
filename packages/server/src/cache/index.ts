import { NodeCacheAdapter } from './NodeCacheAdapter';
import { RedisCacheAdapter, type RedisClient } from './RedisCacheAdapter';
import type { AppCache } from './types';

let sharedCache: AppCache | null = null;

async function createRedisClient(url: string): Promise<RedisClient | null> {
  try {
    // ioredis is optional at runtime (package.json optionalDependencies); catch falls back to memory.
    const ioredis = await import('ioredis');
    const Redis = ioredis.default ?? ioredis;
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await client.ping();
    return client;
  } catch (err) {
    console.warn('[cache] Redis unavailable; falling back to in-memory cache', err);
    return null;
  }
}

export async function initAppCache(): Promise<AppCache> {
  if (sharedCache) return sharedCache;

  const driver = (process.env.CACHE_DRIVER ?? 'memory').toLowerCase();
  const redisUrl = process.env.REDIS_URL?.trim();

  if (driver === 'redis' && redisUrl) {
    const client = await createRedisClient(redisUrl);
    if (client) {
      sharedCache = new RedisCacheAdapter(client);
      console.info('[cache] Using Redis cache driver');
      return sharedCache;
    }
  }

  sharedCache = new NodeCacheAdapter();
  console.info('[cache] Using in-memory cache driver');
  return sharedCache;
}

export function getAppCache(): AppCache {
  if (!sharedCache) {
    sharedCache = new NodeCacheAdapter();
  }
  return sharedCache;
}