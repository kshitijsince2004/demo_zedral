import { describe, expect, it } from 'vitest';
import {
  cleanTaperReadings,
  latestByTime,
  parseDecimalInput,
  sanitizeDecimalInput,
  slotReadingsToThkPasses,
  thkPassesToSlotReadings,
} from '../src/lib/hrsThkMatrix';

describe('decimal thickness input', () => {
  it('keeps trailing / leading decimal while typing', () => {
    expect(sanitizeDecimalInput('2.')).toBe('2.');
    expect(sanitizeDecimalInput('.5')).toBe('.5');
    expect(sanitizeDecimalInput('2.5.1')).toBe('2.51');
    expect(parseDecimalInput('2.')).toBe(2);
    expect(parseDecimalInput('2.51')).toBe(2.51);
    expect(parseDecimalInput('.')).toBeUndefined();
  });
});

describe('thkPassesToSlotReadings', () => {
  const passes = [
    { time: '10:00', bySlot: { A: '2.5', C: '2.4' } },
    { time: '10:15', bySlot: { A: '2.51', B: '2.48' } },
    { time: '  ', bySlot: { A: '9' } },
    { time: '10:30', bySlot: { A: '0', B: '-1' } },
  ];

  it('omits empty / non-positive cells and blank times', () => {
    expect(thkPassesToSlotReadings(passes, 'A')).toEqual([
      { time: '10:00', thkMm: 2.5 },
      { time: '10:15', thkMm: 2.51 },
    ]);
    expect(thkPassesToSlotReadings(passes, 'B')).toEqual([
      { time: '10:15', thkMm: 2.48 },
    ]);
    expect(thkPassesToSlotReadings(passes, 'C')).toEqual([
      { time: '10:00', thkMm: 2.4 },
    ]);
  });

  it('latest-wins per slot', () => {
    expect(latestByTime(thkPassesToSlotReadings(passes, 'A'))?.thkMm).toBe(2.51);
  });

  it('round-trips slot readings back into matrix rows', () => {
    expect(slotReadingsToThkPasses([
      { slot: 'A', readings: [{ time: '10:00', thkMm: 2.5 }, { time: '10:15', thkMm: 2.51 }] },
      { slot: 'B', readings: [{ time: '10:15', thkMm: 2.48 }] },
    ])).toEqual([
      { time: '10:00', bySlot: { A: '2.5' } },
      { time: '10:15', bySlot: { A: '2.51', B: '2.48' } },
    ]);
  });
});

describe('cleanTaperReadings + fan-out', () => {
  it('drops incomplete rows; same list applies to every slot', () => {
    const cleaned = cleanTaperReadings([
      { time: '10:05', taper: 'OK' },
      { time: '10:20', taper: '  ' },
      { time: '', taper: 'BAD' },
      { time: '10:40', taper: 'EDGE' },
    ]);
    expect(cleaned).toEqual([
      { time: '10:05', taper: 'OK' },
      { time: '10:40', taper: 'EDGE' },
    ]);
    const slots = ['A', 'B', 'C'];
    const fanned = Object.fromEntries(slots.map((slot) => [slot, cleaned]));
    expect(fanned.A).toBe(fanned.B);
    expect(fanned.C).toEqual(cleaned);
    expect(latestByTime(cleaned)?.taper).toBe('EDGE');
  });
});
