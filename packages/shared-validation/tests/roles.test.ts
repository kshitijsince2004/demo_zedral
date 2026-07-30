import { describe, it, expect } from 'vitest';
import { UserRole, ROLE_RANK, ROLE_LABELS, normalizeRoleName } from '../src/types/roles';

describe('canonical role source', () => {
  it('ROLE_RANK orders roles ascending by privilege', () => {
    expect(ROLE_RANK[UserRole.OPERATOR]).toBe(0);
    expect(ROLE_RANK[UserRole.SUPERVISOR]).toBe(0);
    expect(ROLE_RANK[UserRole.MACHINE_HEAD]).toBe(1);
    expect(ROLE_RANK[UserRole.QUALITY]).toBe(2);
    expect(ROLE_RANK[UserRole.PLANT_HEAD]).toBe(3);
    expect(ROLE_RANK[UserRole.ADMIN]).toBe(4);
    expect(ROLE_RANK[UserRole.ADMIN]).toBeGreaterThan(ROLE_RANK[UserRole.PLANT_HEAD]);
    expect(ROLE_RANK[UserRole.QUALITY]).toBeGreaterThan(ROLE_RANK[UserRole.MACHINE_HEAD]);
  });

  it('ROLE_LABELS uses sentence case for every role', () => {
    expect(ROLE_LABELS[UserRole.PLANT_HEAD]).toBe('Plant head');
    expect(ROLE_LABELS[UserRole.MACHINE_HEAD]).toBe('Machine head');
    expect(ROLE_LABELS[UserRole.QUALITY]).toBe('Quality');
    expect(ROLE_LABELS[UserRole.OPERATOR]).toBe('Operator');
    expect(ROLE_LABELS[UserRole.SUPERVISOR]).toBe('Supervisor');
    expect(ROLE_LABELS[UserRole.ADMIN]).toBe('Admin');
  });

  it('normalizeRoleName preserves SUPERVISOR (no legacy fold to MACHINE_HEAD)', () => {
    expect(normalizeRoleName('supervisor')).toBe('SUPERVISOR');
    expect(normalizeRoleName('SUPERVISOR')).toBe('SUPERVISOR');
  });
});
