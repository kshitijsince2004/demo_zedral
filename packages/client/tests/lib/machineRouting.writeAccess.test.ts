import { describe, expect, it } from 'vitest';
import { canWriteMachine, getWriteMachineAccess } from '../../src/lib/machineRouting';

describe('canWriteMachine (server-aligned)', () => {
  it('allows Admin/Plant Head any mill', () => {
    expect(canWriteMachine('ADMIN', [], '4HI')).toBe(true);
    expect(canWriteMachine('PLANT_HEAD', [], '4HI')).toBe(true);
    expect(getWriteMachineAccess('ADMIN', [])).toBeNull();
  });

  it('blocks Operator/MH/Supervisor mills missing from JWT', () => {
    expect(canWriteMachine('OPERATOR', ['6HI'], '4HI')).toBe(false);
    expect(canWriteMachine('MACHINE_HEAD', ['6HI'], '4HI')).toBe(false);
    expect(canWriteMachine('SUPERVISOR', ['6HI'], '4HI')).toBe(false);
    expect(canWriteMachine('SUPERVISOR', [], '4HI')).toBe(false);
    expect(canWriteMachine('OPERATOR', ['6HI'], '6HI')).toBe(true);
  });
});
