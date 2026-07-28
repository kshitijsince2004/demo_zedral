import { describe, expect, it } from 'vitest';
import { toPgJsonb } from '../src/utils/pgJsonb';

describe('toPgJsonb', () => {
  it('stringifies non-empty arrays for jsonb binding', () => {
    const value = [{ id: '1', status: 'OPEN' }];
    expect(toPgJsonb(value)).toBe(JSON.stringify(value));
  });

  it('stringifies empty arrays', () => {
    expect(toPgJsonb([])).toBe('[]');
  });

  it('passes objects through unchanged', () => {
    const obj = { rolling: [], batchNumber: 'B1' };
    expect(toPgJsonb(obj)).toBe(obj);
  });

  it('passes null through unchanged', () => {
    expect(toPgJsonb(null)).toBe(null);
  });
});
