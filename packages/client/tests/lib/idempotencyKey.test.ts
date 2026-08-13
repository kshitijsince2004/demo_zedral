import { describe, expect, it } from 'vitest';
import { computeIdempotencyKey } from '../../src/lib/idempotencyKey';

const UUID_V5 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const base = {
  aggregateKey: '6hi-order:B1',
  method: 'POST',
  url: '/6hi/orders/B1/start',
  payload: {},
};

describe('computeIdempotencyKey', () => {
  it('returns a UUID v5-shaped string', async () => {
    const key = await computeIdempotencyKey(base);
    expect(key).toMatch(UUID_V5);
  });

  it('is stable for the same canonical action', async () => {
    const a = await computeIdempotencyKey(base);
    const b = await computeIdempotencyKey({ ...base, method: 'post' });
    const c = await computeIdempotencyKey({
      ...base,
      payload: {},
    });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('is insensitive to object key order', async () => {
    const a = await computeIdempotencyKey({
      ...base,
      payload: { defectCodes: ['A'], remarks: 'x' },
    });
    const b = await computeIdempotencyKey({
      ...base,
      payload: { remarks: 'x', defectCodes: ['A'] },
    });
    expect(a).toBe(b);
  });

  it('changes when the payload changes', async () => {
    const a = await computeIdempotencyKey({ ...base, payload: { n: 1 } });
    const b = await computeIdempotencyKey({ ...base, payload: { n: 2 } });
    expect(a).not.toBe(b);
  });

  it('changes when url or aggregate changes', async () => {
    const a = await computeIdempotencyKey(base);
    const b = await computeIdempotencyKey({ ...base, url: '/6hi/orders/B1/end' });
    const c = await computeIdempotencyKey({ ...base, aggregateKey: '6hi-order:B2' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
