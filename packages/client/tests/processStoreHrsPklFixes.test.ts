import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatCaptureError,
  mapQueue,
  useProcessStore,
} from '../src/store/processStore';

vi.mock('../src/lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../src/store/shiftStore', () => ({
  useShiftStore: {
    getState: () => ({ shiftLogId: 'shift-1' }),
  },
}));

import { apiClient } from '../src/lib/apiClient';

describe('formatCaptureError', () => {
  it('parses ACTIVE_ORDER_CONFLICT', () => {
    expect(formatCaptureError(new Error('ACTIVE_ORDER_CONFLICT:COIL-9'))).toBe(
      'Coil COIL-9 is already running — end it before starting another.',
    );
  });
});

describe('mapQueue', () => {
  it('maps HRS rows', () => {
    const cards = mapQueue('HRS', {
      queue: [{
        coilNo: 'M1',
        gradeCode: 'G',
        customerName: 'C',
        widthMm: 1000,
        thicknessMm: 2,
        weightMt: 10,
        status: 'PENDING',
        journeyId: 'j1',
        stepNo: 1,
        combination: '500+500',
      }],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      coilNo: 'M1',
      status: 'PENDING',
      combination: '500+500',
      journeyId: 'j1',
    });
  });

  it('maps PKL sibling keys', () => {
    const cards = mapQueue('PKL', {
      queue: [{
        coilNo: 'S1',
        gradeCode: 'G',
        customerName: 'C',
        widthMm: 500,
        thicknessMm: 2,
        weightMt: 5,
        status: 'IN_PROGRESS',
        motherCoilNo: 'M1',
        slitId: 'A',
      }],
    });
    expect(cards[0]).toMatchObject({
      coilNo: 'S1',
      status: 'IN_PROGRESS',
      motherCoilNo: 'M1',
      slitId: 'A',
    });
  });
});

describe('resetForLine', () => {
  beforeEach(() => {
    useProcessStore.setState({
      processCode: 'HRS',
      queue: [{
        coilNo: 'H1',
        gradeCode: 'G',
        customerName: 'C',
        widthMm: 1,
        thicknessMm: 1,
        weightMt: 1,
        status: 'IN_PROGRESS',
        journeyId: 'j',
        stepNo: 0,
      }],
      activeCoilNo: 'H1',
      activePrefill: { x: 1 },
      captureStatus: 'running',
      runStartedAt: '2026-08-02T10:00:00.000Z',
      stoppageStartedAt: null,
      activeStoppageId: null,
      captureError: 'stale',
      pklGroupCoilNos: ['A', 'B'],
      pklGroupWeightMt: 12,
      defectPanelOpen: true,
      crewPanelOpen: true,
      remarkPanelOpen: true,
      statusFilter: 'IN_PROGRESS',
    });
  });

  it('clears run-scoped + line-scoped state and pins the new code', () => {
    useProcessStore.getState().resetForLine('PKL');
    const s = useProcessStore.getState();
    expect(s.processCode).toBe('PKL');
    expect(s.queue).toEqual([]);
    expect(s.activeCoilNo).toBeNull();
    expect(s.activePrefill).toBeNull();
    expect(s.captureStatus).toBe('idle');
    expect(s.runStartedAt).toBeNull();
    expect(s.captureError).toBeNull();
    expect(s.pklGroupCoilNos).toEqual([]);
    expect(s.pklGroupWeightMt).toBe(0);
    expect(s.defectPanelOpen).toBe(false);
    expect(s.statusFilter).toBe('ALL');
  });
});

describe('resumeCapture rollback', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
    useProcessStore.setState({
      processCode: 'HRS',
      queue: [{
        coilNo: 'NEW',
        gradeCode: 'G',
        customerName: 'C',
        widthMm: 1,
        thicknessMm: 1,
        weightMt: 1,
        status: 'PENDING',
        journeyId: 'j',
        stepNo: 0,
      }],
      activeCoilNo: null,
      captureStatus: 'idle',
      runStartedAt: null,
      stoppageStartedAt: null,
      activeStoppageId: null,
      captureError: null,
    });
  });

  it('reverts card + surfaces captureError on ACTIVE_ORDER_CONFLICT', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      new Error('ACTIVE_ORDER_CONFLICT:OTHER'),
    );
    await useProcessStore.getState().resumeCapture('NEW');
    const s = useProcessStore.getState();
    expect(s.queue.find((c) => c.coilNo === 'NEW')?.status).toBe('PENDING');
    expect(s.captureStatus).toBe('idle');
    expect(s.runStartedAt).toBeNull();
    expect(s.captureError).toBe(
      'Coil OTHER is already running — end it before starting another.',
    );
  });
});
