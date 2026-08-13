import { describe, it, expect } from 'vitest';
import {
  assertMachineForSubProcess,
  millFromAssignRequest,
  millsForSubProcess,
  parseCrmMillCode,
} from '../src/utils/machineAllocation';
import {
  routeCodeFromBatch,
  resolveLinkRouteCode,
  parseRouteString,
} from '../src/services/ProcessRouteService';

describe('machine allocation helpers', () => {
  it('maps CRM batches to machine-specific route codes', () => {
    expect(routeCodeFromBatch('6HI', 'ROLLING')).toBe('6');
    expect(routeCodeFromBatch('4HI', 'ROLLING')).toBe('4');
    expect(routeCodeFromBatch('2HI', 'SKIN_PASS')).toBe('X');
    expect(routeCodeFromBatch('6HI', 'SKIN_PASS')).toBe('Z');
    expect(routeCodeFromBatch('4HI', 'SKIN_PASS')).toBe('Y');
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
    expect(parseCrmMillCode('6HI:1')).toBe('6HI');
    expect(parseCrmMillCode('4HI:2')).toBe('4HI');
    expect(parseCrmMillCode('2HI:ROLLING')).toBeNull();
  });

  it('prefers body.machineCode over invalid query mill', () => {
    expect(millFromAssignRequest({ machineCode: '6HI' }, { machine: '6HI:1' })).toBe('6HI');
    expect(millFromAssignRequest({ machineCode: '4HI' }, { machine: 'PKL' })).toBe('4HI');
    expect(millFromAssignRequest({}, { machine: '6HI:1' })).toBe('6HI');
    expect(millFromAssignRequest({ machine: '2HI' }, { machine: '6HI:1' })).toBe('2HI');
    expect(millFromAssignRequest({}, {})).toBeNull();
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

  it('resolveLinkRouteCode prefers machine-specific code when route contains it', () => {
    expect(resolveLinkRouteCode('6HI', 'ROLLING', 'S-P-6-Z-C-LE')).toBe('6');
    expect(resolveLinkRouteCode('6HI', 'SKIN_PASS', 'S-P-4-Z-C-LE')).toBe('Z');
  });
});
