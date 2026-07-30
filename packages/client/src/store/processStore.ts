import { create } from 'zustand';
import { apiClient } from '../lib/apiClient';
import { jsonEqual } from '../lib/silentRefresh';
import { notifyProductionChanged } from '../lib/productionSync';
import type { ProcessStationCode } from '../lib/processConfig';
import { useShiftStore } from './shiftStore';

export type QueueStatusFilter = 'ALL' | 'PENDING' | 'IN_PROGRESS' | 'HOLD' | 'COMPLETED';

export interface ProcessQueueCard {
  coilNo: string;
  displayCoilNo?: string;
  gradeCode: string;
  customerName: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'HOLD' | 'COMPLETED';
  journeyId: string;
  stepNo: number;
  batchNumber?: string;
  prefill?: Record<string, unknown>;
}

interface ProcessStore {
  processCode: ProcessStationCode;
  queue: ProcessQueueCard[];
  statusFilter: QueueStatusFilter;
  activeCoilNo: string | null;
  activePrefill: Record<string, unknown> | null;
  captureStatus: 'idle' | 'running' | 'stoppage';
  runStartedAt: string | null;
  stoppageStartedAt: string | null;
  defectPanelOpen: boolean;
  crewPanelOpen: boolean;
  stoppageCode: string;
  stoppageRemarks: string;
  busy: boolean;
  queueRefreshToken: number;
  hubTab: 'coils' | 'chart' | 'charges';

  setProcessCode: (code: ProcessStationCode) => void;
  setStatusFilter: (filter: QueueStatusFilter) => void;
  setHubTab: (tab: 'coils' | 'chart' | 'charges') => void;
  setActiveCoil: (coilNo: string | null, prefill?: Record<string, unknown> | null) => void;
  startCapture: (coilNo: string) => void;
  stopCapture: () => void;
  resumeCapture: (coilNo: string) => Promise<void>;
  setBusy: (busy: boolean) => void;
  requestQueueRefresh: () => void;
  loadQueue: () => Promise<ProcessQueueCard[]>;
  loadPrefill: (coilNo: string) => Promise<Record<string, unknown>>;
  createManualCoil: (payload: Record<string, unknown>) => Promise<void>;

  openDefectPanel: () => void;
  closeDefectPanel: () => void;
  openCrewPanel: () => void;
  closeCrewPanel: () => void;
  setStoppageCode: (code: string) => void;
  setStoppageRemarks: (remarks: string) => void;
}

export const useProcessStore = create<ProcessStore>((set, get) => ({
  processCode: 'HRS',
  queue: [],
  statusFilter: 'ALL',
  activeCoilNo: null,
  activePrefill: null,
  captureStatus: 'idle',
  runStartedAt: null,
  stoppageStartedAt: null,
  defectPanelOpen: false,
  crewPanelOpen: false,
  stoppageCode: '12',
  stoppageRemarks: '',
  busy: false,
  queueRefreshToken: 0,
  hubTab: 'coils',

  setProcessCode: (code) => set({ processCode: code }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setHubTab: (tab) => set({ hubTab: tab }),
  setActiveCoil: (coilNo, prefill = null) => set({ activeCoilNo: coilNo, activePrefill: prefill }),
  startCapture: (coilNo) => {
    // Use resumeCapture() so stoppage end (if any) can be persisted.
    void get().resumeCapture(coilNo);
  },
  resumeCapture: async (coilNo) => {
    const prevCaptureStatus = get().captureStatus;
    const stoppageStartedAt = get().stoppageStartedAt;
    const now = new Date();

    if (prevCaptureStatus === 'stoppage' && stoppageStartedAt) {
      const shiftLogId = useShiftStore.getState().shiftLogId;
      if (shiftLogId) {
        const from = new Date(stoppageStartedAt);
        const to = now;
        const fromTime = from.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kolkata',
        });
        const toTime = to.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kolkata',
        });
        const durationMins = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
        const stoppageCode = get().stoppageCode || '12';
        const stoppageRemarks = get().stoppageRemarks;

        try {
          const { submitOrQueue } = await import('../operator/sync/submitOrQueue');
          await submitOrQueue({
            url: '/stoppages',
            method: 'POST',
            payload: {
              shiftLogId,
              stoppageCode,
              fromTime,
              toTime,
              durationMins,
              remarks: stoppageRemarks.trim() ? stoppageRemarks : undefined,
            },
            aggregateKey: `stoppage:${shiftLogId}:${fromTime}:${toTime}:${stoppageCode}`,
          });
        } catch (err) {
          console.error('[processStore] failed to submit stoppage', err);
        }
      }
    }

    set({
      activeCoilNo: coilNo,
      captureStatus: 'running',
      runStartedAt: now.toISOString(),
      stoppageStartedAt: null,
    });
  },
  stopCapture: () => set({
    captureStatus: 'stoppage',
    stoppageStartedAt: new Date().toISOString(),
    runStartedAt: null,
  }),
  setBusy: (busy) => set({ busy }),
  requestQueueRefresh: () => set((s) => ({ queueRefreshToken: s.queueRefreshToken + 1 })),

  loadQueue: async () => {
    const { processCode } = get();
    const data = await apiClient.get(`/stations/${processCode}/queue`);
    const queue = (data.queue ?? []) as ProcessQueueCard[];
    set((s) => (jsonEqual(s.queue, queue) ? s : { queue }));
    return queue;
  },

  loadPrefill: async (coilNo) => {
    const { processCode } = get();
    const prefill = await apiClient.get(`/stations/${processCode}/entry/${encodeURIComponent(coilNo)}`);
    set({ activePrefill: prefill });
    return prefill;
  },

  createManualCoil: async (payload) => {
    const { processCode } = get();
    set({ busy: true });
    try {
      await apiClient.post(`/stations/${processCode}/manual`, payload);
      get().requestQueueRefresh();
      await get().loadQueue();
    } finally {
      set({ busy: false });
    }
  },

  openDefectPanel: () => set({ defectPanelOpen: true }),
  closeDefectPanel: () => set({ defectPanelOpen: false }),
  openCrewPanel: () => set({ crewPanelOpen: true }),
  closeCrewPanel: () => set({ crewPanelOpen: false }),
  setStoppageCode: (code) => set({ stoppageCode: code }),
  setStoppageRemarks: (remarks) => set({ stoppageRemarks: remarks }),
}));

export async function submitProcessCapture(
  endpoint: string,
  payload: unknown,
  coilNo: string,
): Promise<void> {
  const { submitOrQueue } = await import('../operator/sync/submitOrQueue');
  await submitOrQueue({
    url: endpoint,
    method: 'POST',
    payload,
    aggregateKey: `capture:${coilNo}`,
  });
  notifyProductionChanged();
  useProcessStore.getState().requestQueueRefresh();
}
