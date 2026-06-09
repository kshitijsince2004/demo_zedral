import { describe, it, expect } from 'vitest';
import { resolveBoundaryShifts } from '../src/services/ShiftBoundaryService';

const WINDOWS = [
  { shift_code: 'A', name: 'Shift A', start_time: '06:00', end_time: '14:00' },
  { shift_code: 'B', name: 'Shift B', start_time: '14:00', end_time: '22:00' },
  { shift_code: 'C', name: 'Shift C', start_time: '22:00', end_time: '06:00' },
];

describe('resolveBoundaryShifts', () => {
  it('at 14:00 outgoing is A, incoming is B', () => {
    const at = new Date('2026-06-08T14:00:00');
    const r = resolveBoundaryShifts(WINDOWS, at);
    expect(r.incomingShiftCode).toBe('B');
    expect(r.outgoingShiftCode).toBe('A');
    expect(r.outgoingProdDate).toBe('2026-06-08');
  });

  it('at 06:00 outgoing is C (prev day), incoming is A', () => {
    const at = new Date('2026-06-09T06:00:00');
    const r = resolveBoundaryShifts(WINDOWS, at);
    expect(r.incomingShiftCode).toBe('A');
    expect(r.outgoingShiftCode).toBe('C');
    expect(r.outgoingProdDate).toBe('2026-06-08');
  });

  it('at 22:00 outgoing is B, incoming is C', () => {
    const at = new Date('2026-06-08T22:00:00');
    const r = resolveBoundaryShifts(WINDOWS, at);
    expect(r.incomingShiftCode).toBe('C');
    expect(r.outgoingShiftCode).toBe('B');
  });
});
