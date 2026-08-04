import { describe, expect, it } from 'vitest';
import { parseRouteString, routeCodeFromBatch } from '../src/services/ProcessRouteService';

describe('ProcessRouteService journey tokens (new lines)', () => {
  it('maps HRS/PKL/ANN/RWD to S/P/F/R', () => {
    expect(routeCodeFromBatch('HRS', '')).toBe('S');
    expect(routeCodeFromBatch('PKL', '')).toBe('P');
    expect(routeCodeFromBatch('ANN', '')).toBe('F');
    expect(routeCodeFromBatch('RWD', '')).toBe('R');
    expect(routeCodeFromBatch('2HI', 'REWINDING')).toBe('R');
  });

  it('parseRouteString labels include new-line steps', () => {
    const steps = parseRouteString('S-P-F-R');
    expect(steps.map((s) => s.routeCode)).toEqual(['S', 'P', 'F', 'R', 'PKG']);
    expect(steps.find((s) => s.routeCode === 'S')?.processCode).toBe('HRS');
    expect(steps.find((s) => s.routeCode === 'P')?.processCode).toBe('PKL');
    expect(steps.find((s) => s.routeCode === 'F')?.processCode).toBe('ANN');
    expect(steps.find((s) => s.routeCode === 'R')?.processCode).toBe('RWD');
  });
});
