import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_PLANT_HEAD_WINDOW,
  PLANT_HEAD_WINDOWS,
  parsePlantHeadWindow,
} from '../src/reporting/plantHeadWindow';

describe('parsePlantHeadWindow', () => {
  it('defaults to 7 when window is omitted', () => {
    expect(parsePlantHeadWindow(undefined)).toBe(7);
    expect(parsePlantHeadWindow(null)).toBe(7);
    expect(parsePlantHeadWindow('')).toBe(7);
  });

  it('accepts valid windows', () => {
    for (const w of PLANT_HEAD_WINDOWS) {
      expect(parsePlantHeadWindow(String(w))).toBe(w);
      expect(parsePlantHeadWindow(w)).toBe(w);
    }
  });

  it('rejects invalid windows', () => {
    for (const bad of [0, 2, 5, 14, 91, -1, 7.5, 'abc']) {
      expect(parsePlantHeadWindow(bad)).toBeNull();
    }
  });

  describe('Property 2: Window parameter validity', () => {
    it('returns a valid window only for {1,7,30,90} or default', () => {
      fc.assert(
        fc.property(fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)), (raw) => {
          const parsed = parsePlantHeadWindow(raw);
          if (raw === undefined || raw === null || raw === '') {
            expect(parsed).toBe(DEFAULT_PLANT_HEAD_WINDOW);
            return;
          }
          const n = Number(raw);
          if (Number.isInteger(n) && (PLANT_HEAD_WINDOWS as readonly number[]).includes(n)) {
            expect(parsed).toBe(n);
          } else {
            expect(parsed).toBeNull();
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
