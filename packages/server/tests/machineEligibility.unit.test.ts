import { describe, it, expect } from 'vitest';
import { isEligible } from '../src/utils/machineEligibility';
import type { MachineSpecView } from '../src/services/MachineSpecService';

const baseSpec = (over: Partial<MachineSpecView> = {}): MachineSpecView => ({
  specId: '1',
  machineCode: 'CRS3',
  rev: 1,
  status: 'ACTIVE',
  widthMinMm: 20,
  widthMaxMm: 1000,
  thkMinMm: 0.2,
  thkMaxMm: 2.5,
  mandrelIds: [500],
  coilWtMinMt: 1,
  coilWtMaxMt: 12,
  exitOdMaxMm: 1600,
  lineSpeedMpm: null,
  cutterDiaMm: null,
  airMode: null,
  isReferenceSeed: true,
  notes: null,
  activatedAt: null,
  ...over,
});

describe('isEligible', () => {
  it('allows anything when envelope is missing', () => {
    const r = isEligible({ requiredMandrelIdMm: 600, widthMm: 2000 }, null);
    expect(r.eligible).toBe(true);
    expect(r.hardBlocked).toBe(false);
    expect(r.overrideRequired).toBe(false);
  });

  it('hard-blocks mandrel ID mismatch', () => {
    const r = isEligible({ requiredMandrelIdMm: 600 }, baseSpec());
    expect(r.eligible).toBe(false);
    expect(r.hardBlocked).toBe(true);
    expect(r.overrideRequired).toBe(false);
  });

  it('soft-warns width/thickness out of band and requires override', () => {
    const r = isEligible({ widthMm: 1200, thicknessMm: 3 }, baseSpec());
    expect(r.eligible).toBe(true);
    expect(r.hardBlocked).toBe(false);
    expect(r.overrideRequired).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
