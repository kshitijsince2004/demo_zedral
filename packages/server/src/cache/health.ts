import { getAppCache } from '../cache';
import { getTenantId } from '../context';
import { tenantCacheKey } from '../cache/types';

export async function checkRedisHealth(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return false;

  try {
    // @ts-expect-error optional dependency - health check is skipped when Redis is unavailable.
    const ioredis = await import('ioredis');
    const Redis = ioredis.default ?? ioredis;
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await client.ping();
    await client.quit();
    return true;
  } catch {
    return false;
  }
}

export async function invalidateTenantCache(prefixParts: string[]): Promise<void> {
  const tenantId = getTenantId();
  const prefix = tenantCacheKey(tenantId, ...prefixParts);
  await getAppCache().del(prefix);
}