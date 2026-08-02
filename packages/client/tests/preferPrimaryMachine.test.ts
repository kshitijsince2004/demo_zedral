import { describe, expect, it } from 'vitest';
import { preferPrimaryMachine } from '../src/lib/machineRouting';

describe('preferPrimaryMachine (HRS vs PKL login)', () => {
  it('prefers HRS when lineAccess is HRS even if PKL is first in machineAccess', () => {
    expect(preferPrimaryMachine('OPERATOR', ['PKL', 'HRS'], ['HRS'])).toBe('HRS');
  });

  it('prefers PKL when lineAccess is PKL', () => {
    expect(preferPrimaryMachine('OPERATOR', ['HRS', 'PKL'], ['PKL'])).toBe('PKL');
  });

  it('uses stable NON_CRM order (HRS before PKL) when lines empty', () => {
    expect(preferPrimaryMachine('OPERATOR', ['PKL', 'HRS'], [])).toBe('HRS');
  });

  it('still prefers CRM mill when present', () => {
    expect(preferPrimaryMachine('OPERATOR', ['PKL', '6HI', 'HRS'], ['HRS'])).toBe('6HI');
  });
});
