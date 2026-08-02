import { describe, expect, it } from 'vitest';
import { classifyHandoverBranch } from '../src/lib/classifyHandoverBranch';

describe('classifyHandoverBranch', () => {
  it('routes HRS activeMachine to hrs', () => {
    expect(classifyHandoverBranch('HRS')).toBe('hrs');
  });

  it('prefers processCode HRS when activeMachine is CRM-stale', () => {
    expect(classifyHandoverBranch('6HI', 'HRS')).toBe('hrs');
  });

  it('routes ANN and PKL', () => {
    expect(classifyHandoverBranch('ANN')).toBe('ann');
    expect(classifyHandoverBranch('PKL')).toBe('pkl');
  });

  it('routes RWD to rwd (not CRM fallback)', () => {
    expect(classifyHandoverBranch('RWD')).toBe('rwd');
    expect(classifyHandoverBranch('6HI', 'RWD')).toBe('rwd');
  });

  it('keeps CRM when both point at mill', () => {
    expect(classifyHandoverBranch('6HI', null)).toBe('crm');
  });
});
