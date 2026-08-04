import { describe, expect, it } from 'vitest';
import { classifyOperatorNav } from '../src/lib/classifyOperatorNav';

describe('classifyOperatorNav (debug H-F)', () => {
  it('treats /pkl.operator as PKL process, not CRM', () => {
    const c = classifyOperatorNav('PKL', '/pkl.operator/chart');
    expect(c).toMatchObject({
      isProcess: true, isCrm: false, isPkl: true, isAnn: false, wantsHistory: true,
    });
  });

  it('still treats CRM user-scope as CRM when processCode is 6HI', () => {
    const c = classifyOperatorNav('6HI', '/operator.operator/handover');
    expect(c.isCrm).toBe(true);
    expect(c.isProcess).toBe(false);
    expect(c.isPkl).toBe(false);
    expect(c.wantsHistory).toBe(false);
  });

  it('treats HRS user-scope as process with History', () => {
    const c = classifyOperatorNav('HRS', '/hrs.operator/');
    expect(c.isProcess).toBe(true);
    expect(c.isCrm).toBe(false);
    expect(c.isHrs).toBe(true);
    expect(c.wantsHistory).toBe(true);
  });

  it('treats ANN user-scope as process ANN', () => {
    const c = classifyOperatorNav('ANN', '/ann.operator/?tab=charges');
    expect(c).toMatchObject({ isProcess: true, isCrm: false, isAnn: true, wantsHistory: true });
  });

  it('treats RWD as process with History', () => {
    const c = classifyOperatorNav('RWD', '/rwd.operator/');
    expect(c).toMatchObject({ isProcess: true, isRwd: true, wantsHistory: true });
  });
});
