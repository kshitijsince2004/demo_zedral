import { describe, expect, it } from 'vitest';
import { NodeCacheAdapter } from '../src/cache/NodeCacheAdapter';
import { tenantCacheKey } from '../src/cache/types';

describe('tenant cache keys', () => {
  it('never serves tenant A data under tenant B prefix', async () => {
    const cache = new NodeCacheAdapter();
    const keyA = tenantCacheKey('tenant-a', 'validation', 'rules');
    const keyB = tenantCacheKey('tenant-b', 'validation', 'rules');

    await cache.set(keyA, [{ ruleId: 'a-only' }], 60);

    expect(await cache.get(keyA)).toEqual([{ ruleId: 'a-only' }]);
    expect(await cache.get(keyB)).toBeNull();

    await cache.del(tenantCacheKey('tenant-a', 'validation'));
    expect(await cache.get(keyA)).toBeNull();
  });
});