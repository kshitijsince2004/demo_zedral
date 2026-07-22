import NodeCache from 'node-cache';
import type { AppCache } from './types';

export class NodeCacheAdapter implements AppCache {
  constructor(private cache = new NodeCache()) {}

  async get<T>(key: string): Promise<T | null> {
    const value = this.cache.get<T>(key);
    return value === undefined ? null : value;
  }

  async set<T>(key: string, val: T, ttlSec: number): Promise<void> {
    this.cache.set(key, val, ttlSec);
  }

  async del(prefix: string): Promise<void> {
    const keys = this.cache.keys().filter((key) => key.startsWith(prefix));
    if (keys.length > 0) this.cache.del(keys);
  }
}