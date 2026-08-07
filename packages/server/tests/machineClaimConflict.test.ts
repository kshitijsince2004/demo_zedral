import { describe, it, expect } from 'vitest';
import { assertMachineClaimOrIdempotent } from '../src/utils/machineAllocation';
import { isVersionConflict } from '../src/utils/versionConflict';

describe('assertMachineClaimOrIdempotent (PERF-E3)', () => {
  it('returns idempotent when already on target', () => {
    expect(
      assertMachineClaimOrIdempotent(
        { batchNumber: 'B1', machine_code: '6HI', machine_allocated: true },
        '6HI',
      ),
    ).toBe('idempotent');
  });

  it('returns proceed when unallocated', () => {
    expect(
      assertMachineClaimOrIdempotent(
        { batchNumber: 'B1', machine_code: '6HI', machine_allocated: false },
        '4HI',
      ),
    ).toBe('proceed');
  });

  it('throws VERSION_CONFLICT when claimed by another machine', () => {
    try {
      assertMachineClaimOrIdempotent(
        { batchNumber: 'B1', machine_code: '6HI', machine_allocated: true },
        '4HI',
      );
      expect.unreachable('should throw');
    } catch (e) {
      expect(isVersionConflict(e)).toBe(true);
      if (isVersionConflict(e)) {
        expect(e.current).toEqual({
          batchNumber: 'B1',
          machineCode: '6HI',
          machineAllocated: true,
        });
      }
    }
  });

  it('allows reassign when allowReassign=true', () => {
    expect(
      assertMachineClaimOrIdempotent(
        { batchNumber: 'B1', machine_code: '6HI', machine_allocated: true },
        '4HI',
        true,
      ),
    ).toBe('proceed');
  });
});
