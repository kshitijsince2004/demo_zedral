import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OCR_MIN_CONFIDENCE,
  parseWeightFromOcrText,
  resolveOcrMinConfidence,
} from '../src/utils/weightOcr';

describe('parseWeightFromOcrText', () => {
  it('parses plain decimals', () => {
    expect(parseWeightFromOcrText('12.345')).toBe(12.345);
  });

  it('strips junk characters', () => {
    expect(parseWeightFromOcrText('MT 12.34 kg')).toBe(12.34);
    expect(parseWeightFromOcrText('=12.34')).toBe(12.34);
  });

  it('takes the first number when multiple present', () => {
    expect(parseWeightFromOcrText('12.3 99.9')).toBe(12.3);
  });

  it('handles leading zeros', () => {
    expect(parseWeightFromOcrText('012.5')).toBe(12.5);
  });

  it('returns undefined for empty or non-numeric', () => {
    expect(parseWeightFromOcrText('')).toBeUndefined();
    expect(parseWeightFromOcrText('abc')).toBeUndefined();
    expect(parseWeightFromOcrText('...')).toBeUndefined();
  });
});

describe('resolveOcrMinConfidence', () => {
  it('falls back to default', () => {
    expect(resolveOcrMinConfidence(undefined)).toBe(DEFAULT_OCR_MIN_CONFIDENCE);
    expect(resolveOcrMinConfidence(null)).toBe(DEFAULT_OCR_MIN_CONFIDENCE);
  });

  it('clamps to 0..100', () => {
    expect(resolveOcrMinConfidence(75)).toBe(75);
    expect(resolveOcrMinConfidence(-10)).toBe(0);
    expect(resolveOcrMinConfidence(150)).toBe(100);
  });
});
