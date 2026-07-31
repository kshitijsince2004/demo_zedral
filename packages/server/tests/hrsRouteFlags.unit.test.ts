import { describe, it, expect } from 'vitest';

/** Mirrors HrsSlitBuilder route → hold / for-CTL flags (plan §8). */
function flagsFromRoute(routeRaw: string, toWorkCenter?: string) {
  const r = routeRaw.toUpperCase().replace(/\s+/g, '');
  const hold = r === 'SZ' || toWorkCenter === 'Z' || r.includes('HOLD');
  const forCtl = r.includes('CLE');
  return { holdFlag: hold, forCtlFlag: forCtl && !hold };
}

describe('HRS route flags', () => {
  it('marks SZ / To=Z as HOLD', () => {
    expect(flagsFromRoute('SZ').holdFlag).toBe(true);
    expect(flagsFromRoute('SP4', 'Z').holdFlag).toBe(true);
  });

  it('marks CLE as for-CTL and CZ as ship', () => {
    expect(flagsFromRoute('SP4RFXCLE')).toEqual({ holdFlag: false, forCtlFlag: true });
    expect(flagsFromRoute('SP4RFXCCZ')).toEqual({ holdFlag: false, forCtlFlag: false });
  });
});
