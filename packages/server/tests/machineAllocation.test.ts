import { describe, it, expect } from 'vitest';
import {
  assertMachineForSubProcess,
  millsForSubProcess,
  parseCrmMillCode,
} from '../src/utils/machineAllocation';
import {
  routeCodeFromBatch,
  resolveLinkRouteCode,
  parseRouteString,
} from '../src/services/ProcessRouteService';

describe('machine allocation helpers', () => {
  it('maps CRM batches to generic route codes 4 and X', () => {
    expect(routeCodeFromBatch('6HI', 'ROLLING')).toBe('4');
    expect(routeCodeFromBatch('4HI', 'ROLLING')).toBe('4');
    expect(routeCodeFromBatch('2HI', 'SKIN_PASS')).toBe('X');
    expect(routeCodeFromBatch('6HI', 'SKIN_PASS')).toBe('X');
    expect(routeCodeFromBatch('2HI', 'REWINDING')).toBe('R');
    expect(routeCodeFromBatch('RWD', '')).toBe('R');
  });

  it('lists allowed mills per subprocess', () => {
    expect(millsForSubProcess('ROLLING')).toEqual(['6HI', '4HI']);
    expect(millsForSubProcess('SKIN_PASS')).toEqual(['2HI', '4HI', '6HI']);
  });

  it('validates machine for subprocess', () => {
    expect(assertMachineForSubProcess('ROLLING', '6HI')).toBe('6HI');
    expect(() => assertMachineForSubProcess('ROLLING', '2HI')).toThrow();
    expect(assertMachineForSubProcess('SKIN_PASS', '2HI')).toBe('2HI');
  });

  it('parses CRM mill codes', () => {
    expect(parseCrmMillCode('4hi')).toBe('4HI');
    expect(parseCrmMillCode('PKL')).toBeNull();
  });
});

describe('generic route metadata', () => {
  it('route 4 and X have no preset machine on journey steps', () => {
    const steps = parseRouteString('S-P-4-X-C-LE');
    expect(steps.find((s) => s.routeCode === '4')?.machineCode).toBeNull();
    expect(steps.find((s) => s.routeCode === 'X')?.machineCode).toBeNull();
  });

  it('resolveLinkRouteCode prefers generic 4 for rolling import', () => {
    expect(resolveLinkRouteCode('6HI', 'ROLLING', 'S-P-4-X-C-LE')).toBe('4');
    expect(resolveLinkRouteCode('2HI', 'SKIN_PASS', 'S-P-4-X-C-LE')).toBe('X');
  });
});
