import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    updateTable: vi.fn(),
    insertInto: vi.fn(),
  },
}));

const mockGetCurrentShift = vi.fn();
vi.mock('../src/services/ShiftDetectionService', () => ({
  ShiftDetectionService: {
    getCurrentShift: (...args: unknown[]) => mockGetCurrentShift(...args),
    closeAllStaleActiveSessions: vi.fn(async () => 2),
    closeStaleSessionsOnMachine: vi.fn(async () => 1),
  },
}));

const mockProcessStaleSessions = vi.fn(async () => 2);
vi.mock('../src/services/ShiftBoundaryService', () => ({
  getAutoBoundaryMode: () => 'off',
  ShiftBoundaryService: {
    processStaleSessions: (...args: unknown[]) => mockProcessStaleSessions(...args),
  },
}));

import { LiveService } from '../src/services/LiveService';
import { ShiftBoundaryScheduler } from '../src/jobs/ShiftBoundaryScheduler';

describe('Task 5 Phase 1 — getShiftQueueContext machine scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentShift.mockResolvedValue({
      shiftCode: 'C',
      shiftName: 'Shift C',
      prodDate: '2026-07-19',
      windowStart: '22:00',
      windowEnd: '06:00',
      detectedAt: new Date().toISOString(),
      source: 'SESSION',
    });
  });

  it('passes machineCode into getCurrentShift', async () => {
    const ctx = await LiveService.getShiftQueueContext(42, '6HI');
    expect(mockGetCurrentShift).toHaveBeenCalledWith({ userId: 42, machineCode: '6HI' });
    expect(ctx).toEqual({ prodDate: '2026-07-19', shiftCode: 'C' });
  });

  it('omits machineCode when not provided (clock/override path)', async () => {
    mockGetCurrentShift.mockResolvedValueOnce({
      shiftCode: 'A',
      shiftName: 'Shift A',
      prodDate: '2026-07-20',
      windowStart: '06:00',
      windowEnd: '14:00',
      detectedAt: new Date().toISOString(),
      source: 'FALLBACK',
    });
    const ctx = await LiveService.getShiftQueueContext(42);
    expect(mockGetCurrentShift).toHaveBeenCalledWith({ userId: 42, machineCode: undefined });
    expect(ctx.shiftCode).toBe('A');
  });
});

describe('Task 5 Phase 3 — ShiftBoundaryScheduler stale sweeper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessStaleSessions.mockResolvedValue(2);
    ShiftBoundaryScheduler.stop();
  });

  it('tick closes stale ACTIVE sessions via ShiftBoundaryService', async () => {
    const closed = await ShiftBoundaryScheduler.tick();
    expect(mockProcessStaleSessions).toHaveBeenCalledWith('off');
    expect(closed).toBe(2);
  });
});
