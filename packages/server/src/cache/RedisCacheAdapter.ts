import type { AppCache } from './types';

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<string>;
};

export class RedisCacheAdapter implements AppCache {
  constructor(private client: RedisClient) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, val: T, ttlSec: number): Promise<void> {
    await this.client.set(key, JSON.stringify(val), 'EX', ttlSec);
  }

  async del(prefix: string): Promise<void> {
    const pattern = prefix.endsWith('*') ? prefix : prefix + '*';
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) await this.client.del(...keys);
  }
}

export type { RedisClient };