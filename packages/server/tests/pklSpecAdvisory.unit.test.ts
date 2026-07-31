import { describe, it, expect } from 'vitest';

/** Advisory range check used by PKL chart (plan §6.2). */
function outOfRange(n: number, min: number | null, max: number | null): boolean {
  if (min != null && n < min) return true;
  if (max != null && n > max) return true;
  return false;
}

describe('pklSpecAdvisory', () => {
  it('flags T1 temp below 65', () => {
    expect(outOfRange(60, 65, 80)).toBe(true);
    expect(outOfRange(70, 65, 80)).toBe(false);
  });

  it('allows null-bounded max-only (T1 acid ≤4)', () => {
    expect(outOfRange(5, null, 4)).toBe(true);
    expect(outOfRange(3, null, 4)).toBe(false);
  });
});
