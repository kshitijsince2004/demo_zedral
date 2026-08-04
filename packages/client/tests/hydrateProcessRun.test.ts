import { describe, expect, it } from 'vitest';
import { mapHrsPklQueueStatus, mapRwdQueueStatus } from '../src/store/processStore';
import { orderToHydrateInput } from '../src/lib/hrsPklWrites';
import { processRailFlags } from '../src/lib/processRailFlags';

describe('mapHrsPklQueueStatus', () => {
  it('keeps STOPPAGE (does not squash to IN_PROGRESS)', () => {
    expect(mapHrsPklQueueStatus('STOPPAGE')).toBe('STOPPAGE');
    expect(mapHrsPklQueueStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(mapHrsPklQueueStatus('REJECTED')).toBe('HOLD');
  });

  it('matches RWD for STOPPAGE', () => {
    expect(mapHrsPklQueueStatus('STOPPAGE')).toBe(mapRwdQueueStatus('STOPPAGE'));
  });
});

describe('orderToHydrateInput', () => {
  it('maps open stoppage to hydrate fields', () => {
    const input = orderToHydrateInput({
      status: 'STOPPAGE',
      coilNo: 'HRS-COIL-001',
      prodStartAt: '2026-08-02T10:00:00.000Z',
      activeStoppageId: '99',
      stoppages: [
        { stoppageId: '99', startAt: '2026-08-02T11:00:00.000Z' },
        { stoppageId: '88', startAt: '2026-08-02T09:00:00.000Z', endAt: '2026-08-02T09:30:00.000Z' },
      ],
    });
    expect(input).toEqual({
      coilNo: 'HRS-COIL-001',
      status: 'STOPPAGE',
      prodStartAt: '2026-08-02T10:00:00.000Z',
      stoppageStartedAt: '2026-08-02T11:00:00.000Z',
      activeStoppageId: '99',
    });
  });

  it('clears stoppage fields when running', () => {
    const input = orderToHydrateInput({
      status: 'IN_PROGRESS',
      coilNo: 'PKL-COIL-001',
      prodStartAt: '2026-08-02T10:00:00.000Z',
      stoppages: [{ stoppageId: '1', startAt: '2026-08-02T09:00:00.000Z', endAt: '2026-08-02T09:10:00.000Z' }],
    });
    expect(input.stoppageStartedAt).toBeNull();
    expect(input.activeStoppageId).toBeNull();
    expect(processRailFlags('running', input.coilNo).canEnd).toBe(true);
  });
});
