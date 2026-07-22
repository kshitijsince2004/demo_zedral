export interface AppCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, val: T, ttlSec: number): Promise<void>;
  del(prefix: string): Promise<void>;
}

export function tenantCacheKey(tenantId: string | undefined, ...parts: string[]): string {
  const tenant = tenantId ?? 'default';
  return 't:' + tenant + ':' + parts.join(':');
}