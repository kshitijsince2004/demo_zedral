import { describe, expect, it, vi, afterEach } from 'vitest';
import { BoundedLruMap, CRITICAL_KEY_RE, createSwrCacheMap } from '../../src/lib/swrCacheProvider';

describe('BoundedLruMap', () => {
  it('evicts least-recently-used non-critical keys at cap', () => {
    const map = new BoundedLruMap<string>(3);
    map.set('a', '1');
    map.set('b', '2');
    map.set('c', '3');
    map.set('d', '4'); // evicts 'a'
    expect(map.has('a')).toBe(false);
    expect(map.get('b')).toBe('2');
    expect(map.get('c')).toBe('3');
    expect(map.get('d')).toBe('4');
    expect(map.size).toBe(3);
  });

  it('never evicts critical queue/hub keys', () => {
    const map = new BoundedLruMap<string>(2);
    map.set('/api/queue', 'q');
    map.set('/api/hub/live', 'h');
    map.set('stale-date-key', 'x');
    expect(map.has('/api/queue')).toBe(true);
    expect(map.has('/api/hub/live')).toBe(true);
    map.set('another', 'y');
    expect(map.has('/api/queue')).toBe(true);
    expect(map.has('/api/hub/live')).toBe(true);
    expect(CRITICAL_KEY_RE.test('/api/queue')).toBe(true);
  });

  it('bumps recency on get so LRU targets unused keys', () => {
    const map = new BoundedLruMap<string>(2);
    map.set('old', '1');
    map.set('mid', '2');
    map.get('old'); // bump old
    map.set('new', '3'); // evicts mid
    expect(map.has('mid')).toBe(false);
    expect(map.has('old')).toBe(true);
    expect(map.has('new')).toBe(true);
  });
});

describe('createSwrCacheMap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns unbounded Map when VITE_SWR_CACHE_MAX unset', () => {
    vi.stubEnv('VITE_SWR_CACHE_MAX', '');
    const map = createSwrCacheMap();
    expect(map).toBeInstanceOf(Map);
    expect(map).not.toBeInstanceOf(BoundedLruMap);
  });

  it('returns BoundedLruMap when VITE_SWR_CACHE_MAX is set', () => {
    vi.stubEnv('VITE_SWR_CACHE_MAX', '500');
    const map = createSwrCacheMap();
    expect(map).toBeInstanceOf(BoundedLruMap);
  });
});
