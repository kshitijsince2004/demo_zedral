import { describe, expect, it } from 'vitest';
import {
  isProcessHubMachine,
  processHubRedirect,
  processStationEntry,
} from '../src/lib/processStationEntry';

describe('processStationEntry', () => {
  it('opens live hubs even when the tenant flag is false', () => {
    for (const code of ['HRS', 'PKL', 'ANN', 'RWD', 'hrs']) {
      expect(processStationEntry(code, false)).toBe('hub');
      expect(processStationEntry(code, true)).toBe('hub');
    }
  });

  it('gates CRS/CTL without a /capture bounce', () => {
    expect(processStationEntry('CRS', false)).toBe('disabled');
    expect(processStationEntry('CTL', false)).toBe('disabled');
    expect(processStationEntry('CRS', true)).toBe('hub');
    expect(processStationEntry('CTL', true)).toBe('hub');
  });

  it('ignores non-process codes', () => {
    expect(processStationEntry('6HI', false)).toBe('not-process');
    expect(processStationEntry('SKP', true)).toBe('not-process');
  });
});

describe('processHubRedirect', () => {
  it('sends process /capture URLs to the operator workspace, not / or /capture', () => {
    const dest = processHubRedirect('/alice.operator');
    expect(dest).toEqual({ to: '/alice.operator' });
    expect('to' in dest && dest.to).not.toBe('/');
    expect('to' in dest && dest.to.startsWith('/capture/')).toBe(false);
  });

  it('refuses / and /capture/* (those loop with RoleHomeRedirect / GenericCapture)', () => {
    expect(processHubRedirect('/')).toEqual({ comingSoon: true });
    expect(processHubRedirect('/capture/HRS')).toEqual({ comingSoon: true });
    expect(processHubRedirect('/capture/ANN')).toEqual({ comingSoon: true });
    expect(processHubRedirect('')).toEqual({ comingSoon: true });
  });
});

describe('isProcessHubMachine', () => {
  it('covers every process station that used to bounce through GenericCapture', () => {
    for (const code of ['HRS', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL']) {
      expect(isProcessHubMachine(code)).toBe(true);
    }
    expect(isProcessHubMachine('SKP')).toBe(false);
  });
});
