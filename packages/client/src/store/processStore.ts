import { create } from 'zustand';
import { apiClient } from '../lib/apiClient';
import { jsonEqual } from '../lib/silentRefresh';
import { notifyProductionChanged } from '../lib/productionSync';
import type { ProcessStationCode } from '../lib/processConfig';
import { useShiftStore } from './shiftStore';

export type QueueStatusFilter = 'ALL' | 'PENDING' | 'IN_PROGRESS' | 'HOLD' | 'COMPLETED';

/** Hub queue statuses — RWD keeps raw PREPARING/STOPPAGE/REJECTED; HRS/PKL still use HOLD. */
export type ProcessQueueStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'IN_PROGRESS'
  | 'STOPPAGE'
  | 'HOLD'
  | 'REJECTED'
  | 'COMPLETED';

export function mapRwdQueueStatus(raw?: string): ProcessQueueStatus {
  const s = (raw ?? 'PENDING').toUpperCase();
  if (s === 'COMPLETED') return 'COMPLETED';
  if (s === 'REJECTED') return 'REJECTED';
  if (s === 'STOPPAGE') return 'STOPPAGE';
  if (s === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (s === 'PREPARING') return 'PREPARING';
  if (s === 'HOLD') return 'HOLD';
  return 'PENDING';
}

export function processQueueStatusLabel(status: ProcessQueueStatus): string {
  if (status === 'HOLD' || status === 'REJECTED') return 'Order Hold';
  return status.replace(/_/g, ' ');
}

export interface ProcessQueueCard {
  coilNo: string;
  displayCoilNo?: string;
  gradeCode: string;
  customerName: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  status: ProcessQueueStatus;
  journeyId: string;
  stepNo: number;
  batchNumber?: string;
  /** PKL sibling key — mother coil (trace). */
  motherCoilNo?: string;
  /** PKL sibling key — slit id. */
  slitId?: string;
  /** RWD combine key — plan surface (M/B). */
  surfaceFinish?: string;
  /** RWD/6HI combined run stamp. */
  combinedGroupId?: string;
  machineAllocated?: boolean;
  machineCode?: string;
  lineCount?: number;
  combination?: string;
  orderLines?: Array<{
    batchNumber?: string;
    widthMm?: number;
    weightMt?: number;
    thicknessMm?: number;
    finishThicknessMm?: number;
    customerName?: string;
    routeRaw?: string;
    slitId?: string;
    surfaceFinish?: string;
    toWorkCenter?: string;
    suggestedMachine?: string;
  }>;
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
  remarkPanelOpen: boolean;
  stoppageCode: string;
  stoppageRemarks: string;
  /** Server open stoppage id while rail is in stoppage. */
  activeStoppageId: string | null;
  busy: boolean;
  queueRefreshToken: number;
  hubTab: 'coils' | 'chart' | 'charges';
  /** PKL Option A: selected sibling coil nos (order preserved). */
  pklGroupCoilNos: string[];
  pklGroupWeightMt: number;
  /** Incremented when operator nav requests Manual Add. */
  manualModalToken: number;
  /** Incremented when rail End requests production-form submit. */
  endCaptureToken: number;

  setProcessCode: (code: ProcessStationCode) => void;
  setStatusFilter: (filter: QueueStatusFilter) => void;
  setHubTab: (tab: 'coils' | 'chart' | 'charges') => void;
  setActiveCoil: (coilNo: string | null, prefill?: Record<string, unknown> | null) => void;
  /**
   * Sync shell timer / Live Status from txn.rwd_order (RWD Start lives on capture page, not stations/start).
   */
  hydrateRwdRun: (input: {
    coilNo: string;
    batchNumber?: string;
    status: string;
    prodStartAt?: string | null;
    stoppageStartedAt?: string | null;
    activeStoppageId?: string | null;
    prefill?: Record<string, unknown> | null;
  }) => void;
  setPklGroup: (coilNos: string[], weightMt: number) => void;
  clearPklGroup: () => void;
  /** After a coil save — drop it from the group; return next coil or null. */
  advancePklGroup: (doneCoilNo: string) => string | null;
  requestManualCoil: () => void;
  /** Rail End → CaptureWorkspace requestSubmit on the production form. */
  requestEndCapture: () => void;
  /** Clear rail after successful production submit (hub return). */
  finishCapture: () => void;
  startCapture: (coilNo: string) => void;
  stopCapture: () => void;
  resumeCapture: (coilNo: string) => Promise<void>;
  setBusy: (busy: boolean) => void;
  requestQueueRefresh: () => void;
  loadQueue: () => Promise<ProcessQueueCard[]>;
  /** Optional override — ProcessHub passes prop so RWD doesn't use stale store default (HRS). */
  loadQueueFor: (code: ProcessStationCode) => Promise<ProcessQueueCard[]>;

  loadPrefill: (coilNo: string) => Promise<Record<string, unknown>>;
  createManualCoil: (payload: Record<string, unknown>) => Promise<void>;
  holdCoil: (coilNo: string, remarks?: string) => Promise<void>;

  openDefectPanel: () => void;
  closeDefectPanel: () => void;
  openCrewPanel: () => void;
  closeCrewPanel: () => void;
  openRemarkPanel: () => void;
  closeRemarkPanel: () => void;
  /** Abort stoppage without posting (modal cancel). */
  cancelStoppage: () => void;
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
  remarkPanelOpen: false,
  stoppageCode: '12',
  stoppageRemarks: '',
  activeStoppageId: null,
  busy: false,
  queueRefreshToken: 0,
  hubTab: 'coils',
  pklGroupCoilNos: [],
  pklGroupWeightMt: 0,
  manualModalToken: 0,
  endCaptureToken: 0,

  setProcessCode: (code) => set({ processCode: code }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setHubTab: (tab) => set({ hubTab: tab }),
  setActiveCoil: (coilNo, prefill = null) => set({ activeCoilNo: coilNo, activePrefill: prefill }),
  hydrateRwdRun: (input) => {
    const raw = (input.status ?? 'PENDING').toUpperCase();
    const captureStatus =
      raw === 'STOPPAGE' ? 'stoppage' as const
        : raw === 'IN_PROGRESS' ? 'running' as const
          : 'idle' as const;
    const queueStatus =
      raw === 'STOPPAGE' ? 'STOPPAGE' as const
        : raw === 'IN_PROGRESS' ? 'IN_PROGRESS' as const
          : raw === 'COMPLETED' ? 'COMPLETED' as const
            : raw === 'REJECTED' ? 'REJECTED' as const
              : raw === 'PREPARING' ? 'PREPARING' as const
                : raw === 'HOLD' ? 'HOLD' as const
                  : 'PENDING' as const;
    set((s) => ({
      activeCoilNo: input.coilNo,
      activePrefill: input.prefill !== undefined ? input.prefill : s.activePrefill,
      captureStatus,
      runStartedAt: captureStatus === 'idle'
        ? null
        : (input.prodStartAt ?? s.runStartedAt),
      stoppageStartedAt: captureStatus === 'stoppage'
        ? (input.stoppageStartedAt ?? s.stoppageStartedAt)
        : null,
      activeStoppageId: captureStatus === 'stoppage'
        ? (input.activeStoppageId ?? s.activeStoppageId)
        : null,
      queue: s.queue.map((c) => {
        const match =
          c.coilNo === input.coilNo
          || (!!input.batchNumber && c.batchNumber === input.batchNumber);
        return match ? { ...c, status: queueStatus } : c;
      }),
    }));
  },
  setPklGroup: (coilNos, weightMt) => set({ pklGroupCoilNos: coilNos, pklGroupWeightMt: weightMt }),
  clearPklGroup: () => set({ pklGroupCoilNos: [], pklGroupWeightMt: 0 }),
  advancePklGroup: (doneCoilNo) => {
    const remaining = get().pklGroupCoilNos.filter((c) => c !== doneCoilNo);
    if (remaining.length === 0) {
      set({ pklGroupCoilNos: [], pklGroupWeightMt: 0 });
      return null;
    }
    const weightMt = get().queue
      .filter((c) => remaining.includes(c.coilNo))
      .reduce((sum, c) => sum + (Number(c.weightMt) || 0), 0);
    set({ pklGroupCoilNos: remaining, pklGroupWeightMt: weightMt });
    return remaining[0] ?? null;
  },
  requestManualCoil: () => set((s) => ({ manualModalToken: s.manualModalToken + 1 })),
  requestEndCapture: () => set((s) => ({ endCaptureToken: s.endCaptureToken + 1 })),
  finishCapture: () => set({
    activeCoilNo: null,
    activePrefill: null,
    captureStatus: 'idle',
    runStartedAt: null,
    stoppageStartedAt: null,
    activeStoppageId: null,
  }),
  startCapture: (coilNo) => {
    // Flip UI to running immediately (6HI Start→End); station start + stoppage close in background.
    void get().resumeCapture(coilNo);
  },
  resumeCapture: async (coilNo) => {
    const prevCaptureStatus = get().captureStatus;
    const stoppageStartedAt = get().stoppageStartedAt;
    const processCode = get().processCode;
    const now = new Date();

    // Immediate Start→End swap + queue IN_PROGRESS (matches server after /start).
    set((s) => ({
      activeCoilNo: coilNo,
      captureStatus: 'running' as const,
      runStartedAt: now.toISOString(),
      stoppageStartedAt: null,
      queue: s.queue.map((c) =>
        c.coilNo === coilNo ? { ...c, status: 'IN_PROGRESS' as const } : c,
      ),
    }));
    try {
      await apiClient.post(`/stations/${processCode}/start`, { coilNo });
    } catch (err) {
      console.error('[processStore] station start failed', err);
    }

    if (prevCaptureStatus === 'stoppage') {
      const openId = get().activeStoppageId;
      if (openId) {
        try {
          await apiClient.post(`/stations/${processCode}/stoppages/${encodeURIComponent(openId)}/end`, {});
          set({ activeStoppageId: null });
        } catch (err) {
          console.error('[processStore] failed to end open stoppage', err);
        }
      } else if (stoppageStartedAt) {
        // Legacy fallback: closed interval POST if enter never got a server id.
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
    }
  },
  stopCapture: () => {
    const processCode = get().processCode;
    const shiftLogId = useShiftStore.getState().shiftLogId;
    set({
      captureStatus: 'stoppage',
      stoppageStartedAt: new Date().toISOString(),
      runStartedAt: null,
    });
    if (!shiftLogId) return;
    void apiClient
      .post(`/stations/${processCode}/stoppages/start`, {
        shiftLogId,
        stoppageCode: get().stoppageCode || '12',
        remarks: get().stoppageRemarks.trim() || undefined,
      })
      .then((res: { stoppageId?: string }) => {
        if (res?.stoppageId) set({ activeStoppageId: String(res.stoppageId) });
      })
      .catch((err) => {
        console.error('[processStore] stoppage start failed', err);
      });
  },
  cancelStoppage: () => {
    const openId = get().activeStoppageId;
    const processCode = get().processCode;
    set({
      captureStatus: 'running',
      stoppageStartedAt: null,
      runStartedAt: get().runStartedAt ?? new Date().toISOString(),
      activeStoppageId: null,
    });
    // Abort open stoppage without counting it — end immediately if server created one.
    if (openId) {
      void apiClient.post(`/stations/${processCode}/stoppages/${encodeURIComponent(openId)}/end`, {}).catch(() => {});
    }
  },
  setBusy: (busy) => set({ busy }),
  requestQueueRefresh: () => set((s) => ({ queueRefreshToken: s.queueRefreshToken + 1 })),

  loadQueue: async () => get().loadQueueFor(get().processCode),

  loadQueueFor: async (code) => {
    if (code === 'RWD') {
      const data = await apiClient.get<{ queue: Array<{
          batchNumber: string;
          coilNo: string;
          displayCoilNo?: string;
          gradeCode: string;
          customerName: string;
          widthMm: number;
          thicknessMm: number;
          weightMt: number;
          status?: string;
          slitId?: string;
          machineAllocated?: boolean;
          machineCode?: string;
          surfaceFinish?: string;
          combinedGroupId?: string;
      }> }>('/rewinding/queue?machine=RWD');
      const queue: ProcessQueueCard[] = (data.queue ?? []).map((c) => {
        const status = mapRwdQueueStatus(c.status);
        return {
          coilNo: c.coilNo,
          displayCoilNo: c.displayCoilNo,
          gradeCode: c.gradeCode,
          customerName: c.customerName,
          widthMm: c.widthMm,
          thicknessMm: c.thicknessMm,
          weightMt: c.weightMt,
          status,
          journeyId: c.batchNumber,
          stepNo: 0,
          batchNumber: c.batchNumber,
          slitId: c.slitId,
          surfaceFinish: c.surfaceFinish,
          combinedGroupId: c.combinedGroupId,
          machineAllocated: c.machineAllocated,
          machineCode: c.machineCode,
          prefill: {
            batchNumber: { value: c.batchNumber, source: 'Plan' },
            surfaceFinish: c.surfaceFinish ? { value: c.surfaceFinish, source: 'Plan' } : undefined,
            machineAllocated: c.machineAllocated,
          },
        };
      });
      set((s) => (jsonEqual(s.queue, queue) ? s : { queue, processCode: code }));
      return queue;
    }

    if (code === 'HRS') {
      const data = await apiClient.get<{ queue: Array<{
        coilNo: string;
        displayCoilNo?: string;
        gradeCode: string;
        customerName: string;
        widthMm: number;
        thicknessMm: number;
        weightMt: number;
        status?: string;
        journeyId?: string;
        stepNo?: number;
        orderLines?: ProcessQueueCard['orderLines'];
        lineCount?: number;
        combination?: string;
      }> }>('/hrs-order/queue');
      const queue: ProcessQueueCard[] = (data.queue ?? []).map((c) => {
        const raw = (c.status ?? 'PENDING').toUpperCase();
        const status: ProcessQueueCard['status'] =
          raw === 'COMPLETED' ? 'COMPLETED'
            : raw === 'REJECTED' ? 'HOLD'
              : raw === 'IN_PROGRESS' || raw === 'STOPPAGE' ? 'IN_PROGRESS'
                : 'PENDING';
        return {
          coilNo: c.coilNo,
          displayCoilNo: c.displayCoilNo,
          gradeCode: c.gradeCode,
          customerName: c.customerName,
          widthMm: c.widthMm,
          thicknessMm: c.thicknessMm,
          weightMt: c.weightMt,
          status,
          journeyId: c.journeyId ?? c.coilNo,
          stepNo: c.stepNo ?? 0,
          orderLines: c.orderLines,
          lineCount: c.lineCount,
          combination: c.combination,
        };
      });
      set((s) => (jsonEqual(s.queue, queue) ? s : { queue, processCode: code }));
      return queue;
    }

    if (code === 'PKL') {
      const data = await apiClient.get<{ queue: Array<{
        coilNo: string;
        displayCoilNo?: string;
        gradeCode: string;
        customerName: string;
        widthMm: number;
        thicknessMm: number;
        weightMt: number;
        status?: string;
        journeyId?: string;
        stepNo?: number;
        motherCoilNo?: string;
        slitId?: string;
      }> }>('/pkl-order/queue');
      const queue: ProcessQueueCard[] = (data.queue ?? []).map((c) => {
        const raw = (c.status ?? 'PENDING').toUpperCase();
        const status: ProcessQueueCard['status'] =
          raw === 'COMPLETED' ? 'COMPLETED'
            : raw === 'REJECTED' ? 'HOLD'
              : raw === 'IN_PROGRESS' || raw === 'STOPPAGE' ? 'IN_PROGRESS'
                : 'PENDING';
        return {
          coilNo: c.coilNo,
          displayCoilNo: c.displayCoilNo,
          gradeCode: c.gradeCode,
          customerName: c.customerName,
          widthMm: c.widthMm,
          thicknessMm: c.thicknessMm,
          weightMt: c.weightMt,
          status,
          journeyId: c.journeyId ?? c.coilNo,
          stepNo: c.stepNo ?? 0,
          motherCoilNo: c.motherCoilNo,
          slitId: c.slitId,
        };
      });
      set((s) => (jsonEqual(s.queue, queue) ? s : { queue, processCode: code }));
      return queue;
    }

    const data = await apiClient.get(`/stations/${code}/queue`);
    const queue = ((data as { queue?: ProcessQueueCard[] }).queue ?? []) as ProcessQueueCard[];
    set((s) => (jsonEqual(s.queue, queue) ? s : { queue, processCode: code }));
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

  holdCoil: async (coilNo, remarks) => {
    const { processCode } = get();
    set({ busy: true });
    try {
      await apiClient.post(`/stations/${processCode}/hold`, { coilNo, remarks });
      set({
        activeCoilNo: null,
        activePrefill: null,
        captureStatus: 'idle',
        runStartedAt: null,
        stoppageStartedAt: null,
        activeStoppageId: null,
      });
      get().clearPklGroup();
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
  openRemarkPanel: () => set({ remarkPanelOpen: true }),
  closeRemarkPanel: () => set({ remarkPanelOpen: false }),
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
