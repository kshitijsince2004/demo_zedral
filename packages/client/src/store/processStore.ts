import { create } from 'zustand';
import { apiClient } from '../lib/apiClient';
import { jsonEqual } from '../lib/silentRefresh';
import { notifyProductionChanged } from '../lib/productionSync';
import type { ProcessStationCode } from '../lib/processConfig';
import { useShiftStore } from './shiftStore';
import {
  hrsSchema,
  pklSchema,
  annSchema,
  rwdSchema,
  crsSchema,
  ctlSchema,
} from '@m1/shared-validation';
import type { z } from 'zod';

const CAPTURE_SCHEMA_BY_ENDPOINT: Record<string, z.ZodTypeAny> = {
  '/production/hrs': hrsSchema,
  '/production/hrs/draft': hrsSchema,
  '/production/pkl': pklSchema,
  '/production/pkl/draft': pklSchema,
  '/production/ann': annSchema,
  '/production/rwd': rwdSchema,
  '/production/crs': crsSchema,
  '/production/ctl': ctlSchema,
};

export type QueueStatusFilter = 'ALL' | 'PENDING' | 'PREPARING' | 'IN_PROGRESS' | 'HOLD' | 'COMPLETED';

/** Hub queue statuses — RWD/HRS/PKL keep STOPPAGE (rail hydrate after refresh). */
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

/** HRS/PKL order status → queue card (keep STOPPAGE; REJECTED → HOLD for hub). */
export function mapHrsPklQueueStatus(raw?: string): ProcessQueueStatus {
  const s = (raw ?? 'PENDING').toUpperCase();
  if (s === 'COMPLETED') return 'COMPLETED';
  if (s === 'REJECTED') return 'HOLD';
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

/** Queue endpoint per line — HRS/PKL use order routes; ANN/CRS/CTL use stations. */
export function processQueueUrl(code: ProcessStationCode): string {
  if (code === 'RWD') return '/rewinding/queue?machine=RWD';
  if (code === 'HRS') return '/hrs-order/queue';
  if (code === 'PKL') return '/pkl-order/queue';
  return `/stations/${code}/queue`;
}

export function formatCaptureError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const m = msg.match(/ACTIVE_ORDER_CONFLICT:(\S+)/);
  if (m) return `Coil ${m[1]} is already running — end it before starting another.`;
  return msg || 'Action failed';
}

/** Pure response → card mapping shared by loadQueueFor and useProcessHubQueue. */
export function mapQueue(code: ProcessStationCode, raw: unknown): ProcessQueueCard[] {
  const rows = ((raw as { queue?: Array<Record<string, unknown>> })?.queue
    ?? (Array.isArray(raw) ? raw : [])) as Array<Record<string, unknown>>;

  if (code === 'RWD') {
    return rows.map((c) => {
      const status = mapRwdQueueStatus(c.status as string | undefined);
      const batchNumber = String(c.batchNumber ?? '');
      const surfaceFinish = c.surfaceFinish != null ? String(c.surfaceFinish) : undefined;
      const machineAllocated = Boolean(c.machineAllocated);
      return {
        coilNo: String(c.coilNo ?? ''),
        displayCoilNo: c.displayCoilNo != null ? String(c.displayCoilNo) : undefined,
        gradeCode: String(c.gradeCode ?? ''),
        customerName: String(c.customerName ?? ''),
        widthMm: Number(c.widthMm) || 0,
        thicknessMm: Number(c.thicknessMm) || 0,
        weightMt: Number(c.weightMt) || 0,
        status,
        journeyId: batchNumber,
        stepNo: 0,
        batchNumber,
        slitId: c.slitId != null ? String(c.slitId) : undefined,
        surfaceFinish,
        combinedGroupId: c.combinedGroupId != null ? String(c.combinedGroupId) : undefined,
        machineAllocated,
        machineCode: c.machineCode != null ? String(c.machineCode) : undefined,
        planDate: c.planDate != null ? String(c.planDate).slice(0, 10) : undefined,
        prefill: {
          batchNumber: { value: batchNumber, source: 'Plan' },
          surfaceFinish: surfaceFinish ? { value: surfaceFinish, source: 'Plan' } : undefined,
          machineAllocated,
        },
      };
    });
  }

  if (code === 'HRS') {
    return rows.map((c) => {
      const coilNo = String(c.coilNo ?? '');
      return {
        coilNo,
        displayCoilNo: c.displayCoilNo != null ? String(c.displayCoilNo) : undefined,
        gradeCode: String(c.gradeCode ?? ''),
        customerName: String(c.customerName ?? ''),
        widthMm: Number(c.widthMm) || 0,
        thicknessMm: Number(c.thicknessMm) || 0,
        weightMt: Number(c.weightMt) || 0,
        status: mapHrsPklQueueStatus(c.status as string | undefined),
        journeyId: String(c.journeyId ?? coilNo),
        stepNo: Number(c.stepNo) || 0,
        orderLines: c.orderLines as ProcessQueueCard['orderLines'],
        lineCount: c.lineCount != null ? Number(c.lineCount) : undefined,
        combination: c.combination != null ? String(c.combination) : undefined,
        routeRaw: c.routeRaw != null ? String(c.routeRaw) : undefined,
      };
    });
  }

  if (code === 'PKL') {
    return rows.map((c) => {
      const coilNo = String(c.coilNo ?? '');
      return {
        coilNo,
        displayCoilNo: c.displayCoilNo != null ? String(c.displayCoilNo) : undefined,
        gradeCode: String(c.gradeCode ?? ''),
        customerName: String(c.customerName ?? ''),
        widthMm: Number(c.widthMm) || 0,
        thicknessMm: Number(c.thicknessMm) || 0,
        weightMt: Number(c.weightMt) || 0,
        status: mapHrsPklQueueStatus(c.status as string | undefined),
        journeyId: String(c.journeyId ?? coilNo),
        stepNo: Number(c.stepNo) || 0,
        motherCoilNo: c.motherCoilNo != null ? String(c.motherCoilNo) : undefined,
        slitId: c.slitId != null ? String(c.slitId) : undefined,
        routeRaw: c.routeRaw != null ? String(c.routeRaw) : undefined,
      };
    });
  }

  return rows as unknown as ProcessQueueCard[];
}

const IDLE_RUN = {
  activeCoilNo: null as string | null,
  activePrefill: null as Record<string, unknown> | null,
  captureStatus: 'idle' as const,
  runStartedAt: null as string | null,
  stoppageStartedAt: null as string | null,
  activeStoppageId: null as string | null,
  runStoppages: [] as Array<{ id?: string; startAt: string; endAt?: string | null }>,
  captureError: null as string | null,
};

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
  /** Process route string from PPC (PKL hub detail / capture). */
  routeRaw?: string;
  /** RWD combine key — plan surface (M/B). */
  surfaceFinish?: string;
  /** RWD/6HI combined run stamp. */
  combinedGroupId?: string;
  machineAllocated?: boolean;
  machineCode?: string;
  /** PPC plan date (YYYY-MM-DD) — RWD queue. */
  planDate?: string;
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
  /** Closed + open stoppages for net timer (PKL). */
  runStoppages: Array<{ id?: string; startAt: string; endAt?: string | null }>;
  /** Start/stoppage failure message for hub/rail banner. */
  captureError: string | null;
  busy: boolean;
  queueRefreshToken: number;
  hubTab: 'coils' | 'chart' | 'charges';
  /** PKL Option A: selected sibling coil nos (order preserved). */
  pklGroupCoilNos: string[];
  pklGroupWeightMt: number;
  /** Incremented when rail Manage Stop should reopen the stoppage modal. */
  stoppageManageToken: number;
  /** Incremented when operator nav requests Manual Add. */
  manualModalToken: number;
  /** Incremented when rail End requests production-form submit. */
  endCaptureToken: number;
  /** Body Save → open OrderEndModal (same path as rail End). */
  endConfirmToken: number;

  setProcessCode: (code: ProcessStationCode) => void;
  /** Clear run-scoped + line-scoped UI when switching HRS/PKL/… */
  resetForLine: (code: ProcessStationCode) => void;
  setStatusFilter: (filter: QueueStatusFilter) => void;
  setHubTab: (tab: 'coils' | 'chart' | 'charges') => void;
  setActiveCoil: (coilNo: string | null, prefill?: Record<string, unknown> | null) => void;
  clearCaptureError: () => void;
  /**
   * Sync shell timer / Live Status from server order (RWD/HRS/PKL).
   * Key match on coilNo; batchNumber for RWD combine cards.
   */
  hydrateProcessRun: (input: {
    coilNo: string;
    batchNumber?: string;
    status: string;
    prodStartAt?: string | null;
    stoppageStartedAt?: string | null;
    activeStoppageId?: string | null;
    stoppages?: Array<{ id?: string; stoppageId?: string; startAt: string; endAt?: string | null }>;
    prefill?: Record<string, unknown> | null;
  }) => void;
  /** @deprecated alias — prefer hydrateProcessRun */
  hydrateRwdRun: (input: {
    coilNo: string;
    batchNumber?: string;
    status: string;
    prodStartAt?: string | null;
    stoppageStartedAt?: string | null;
    activeStoppageId?: string | null;
    stoppages?: Array<{ id?: string; stoppageId?: string; startAt: string; endAt?: string | null }>;
    prefill?: Record<string, unknown> | null;
  }) => void;
  setPklGroup: (coilNos: string[], weightMt: number) => void;
  clearPklGroup: () => void;
  /** After a coil save — drop it from the group; return next coil or null. */
  advancePklGroup: (doneCoilNo: string) => string | null;
  requestManualCoil: () => void;
  /** Clear Manual modal request so remounting Orders does not reopen it. */
  consumeManualCoilRequest: () => void;
  /** Re-open Manage Stoppage UI while order is already stopped. */
  requestManageStoppage: () => void;
  /** Body Save → ProcessLayout opens OrderEndModal. */
  requestEndConfirm: () => void;
  /** Rail End / modal confirm → CaptureWorkspace requestSubmit on the production form. */
  requestEndCapture: () => void;
  /** Clear rail after successful production submit (hub return). */
  finishCapture: () => void;
  startCapture: (coilNo: string) => void;
  stopCapture: (opts?: { categoryCode?: string; remarks?: string }) => void;
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
  runStoppages: [],
  captureError: null,
  busy: false,
  queueRefreshToken: 0,
  hubTab: 'coils',
  pklGroupCoilNos: [],
  pklGroupWeightMt: 0,
  manualModalToken: 0,
  stoppageManageToken: 0,
  endCaptureToken: 0,
  endConfirmToken: 0,

  setProcessCode: (code) => set({ processCode: code }),
  resetForLine: (code) => set({
    processCode: code,
    queue: [],
    ...IDLE_RUN,
    pklGroupCoilNos: [],
    pklGroupWeightMt: 0,
    defectPanelOpen: false,
    crewPanelOpen: false,
    remarkPanelOpen: false,
    stoppageCode: '12',
    stoppageRemarks: '',
    statusFilter: 'ALL',
  }),
  clearCaptureError: () => set({ captureError: null }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setHubTab: (tab) => set({ hubTab: tab }),
  setActiveCoil: (coilNo, prefill = null) => set({ activeCoilNo: coilNo, activePrefill: prefill }),
  hydrateProcessRun: (input) => {
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
    const mappedStoppages = input.stoppages?.map((s) => ({
      id: s.id ?? s.stoppageId,
      startAt: s.startAt,
      endAt: s.endAt ?? null,
    }));
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
      runStoppages: mappedStoppages !== undefined ? mappedStoppages : s.runStoppages,
      queue: s.queue.map((c) => {
        const match =
          c.coilNo === input.coilNo
          || (!!input.batchNumber && c.batchNumber === input.batchNumber);
        return match ? { ...c, status: queueStatus } : c;
      }),
    }));
  },
  hydrateRwdRun: (input) => get().hydrateProcessRun(input),
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
  consumeManualCoilRequest: () => set({ manualModalToken: 0 }),
  requestManageStoppage: () => set((s) => ({ stoppageManageToken: s.stoppageManageToken + 1 })),
  requestEndConfirm: () => set((s) => ({ endConfirmToken: s.endConfirmToken + 1 })),
  requestEndCapture: () => set((s) => ({ endCaptureToken: s.endCaptureToken + 1 })),
  finishCapture: () => set({ ...IDLE_RUN }),
  startCapture: (coilNo) => {
    // Flip UI to running immediately (6HI Start→End); station start + stoppage close in background.
    void get().resumeCapture(coilNo);
  },
  resumeCapture: async (coilNo) => {
    const prevCaptureStatus = get().captureStatus;
    const processCode = get().processCode;
    const prevRunStartedAt = get().runStartedAt;
    const prevStoppageStartedAt = get().stoppageStartedAt;
    const prevCardStatus = get().queue.find((c) => c.coilNo === coilNo)?.status;
    const isResume = prevCaptureStatus === 'stoppage';
    const now = new Date();

    // Optimistic gate; on resume keep wall-clock prod_start (not now).
    set((s) => ({
      activeCoilNo: coilNo,
      captureStatus: 'running' as const,
      captureError: null,
      runStartedAt: isResume ? (prevRunStartedAt ?? s.runStartedAt) : now.toISOString(),
      stoppageStartedAt: null,
      queue: s.queue.map((c) =>
        c.coilNo === coilNo ? { ...c, status: 'IN_PROGRESS' as const } : c,
      ),
    }));

    if (isResume) {
      const openId = get().activeStoppageId;
      if (openId) {
        try {
          const res = await apiClient.post<{
            stoppageId?: string;
            order?: {
              status: string;
              coilNo?: string;
              prodStartAt?: string;
              activeStoppageId?: string;
              stoppages?: Array<{ startAt: string; endAt?: string }>;
            };
          }>(`/stations/${processCode}/stoppages/${encodeURIComponent(openId)}/end`, { coilNo });
          set({ activeStoppageId: null });
          if (res?.order) {
            const open = res.order.stoppages?.find((s) => !s.endAt);
            get().hydrateProcessRun({
              coilNo: res.order.coilNo || coilNo,
              status: res.order.status,
              prodStartAt: res.order.prodStartAt,
              stoppageStartedAt: open?.startAt,
              activeStoppageId: res.order.activeStoppageId ?? null,
              stoppages: res.order.stoppages,
            });
            return;
          }
        } catch (err) {
          set((s) => ({
            captureStatus: prevCaptureStatus,
            runStartedAt: prevRunStartedAt,
            stoppageStartedAt: prevStoppageStartedAt,
            captureError: formatCaptureError(err),
            queue: prevCardStatus
              ? s.queue.map((c) => (c.coilNo === coilNo ? { ...c, status: prevCardStatus } : c))
              : s.queue,
          }));
          return;
        }
      }
    }

    try {
      const started = await apiClient.post<{
        coilNo?: string;
        status?: string;
        prodStartAt?: string;
      } | {
        status: string;
        coilNo: string;
        prodStartAt?: string;
        activeStoppageId?: string;
        stoppages?: Array<{ startAt: string; endAt?: string }>;
      }>(`/stations/${processCode}/start`, { coilNo });
      // Stations start returns thin {coilNo,status}; hrs startProduction returns full order via service
      // but ProcessStationService.startCoil only returns {coilNo,status}. Re-fetch for HRS/PKL.
      if (processCode === 'HRS' || processCode === 'PKL') {
        const { fetchHrsPklOrder, orderToHydrateInput } = await import('../lib/hrsPklWrites');
        const order = await fetchHrsPklOrder(processCode, coilNo);
        get().hydrateProcessRun(orderToHydrateInput(order));
      } else if (started && typeof started === 'object' && 'prodStartAt' in started && started.prodStartAt) {
        get().hydrateProcessRun({
          coilNo,
          status: String((started as { status?: string }).status ?? 'IN_PROGRESS'),
          prodStartAt: started.prodStartAt as string,
        });
      }
    } catch (err) {
      set((s) => ({
        captureStatus: prevCaptureStatus === 'stoppage' ? 'stoppage' : 'idle',
        runStartedAt: prevCaptureStatus === 'stoppage' ? prevRunStartedAt : null,
        stoppageStartedAt: prevCaptureStatus === 'stoppage' ? prevStoppageStartedAt : null,
        captureError: formatCaptureError(err),
        queue: prevCardStatus
          ? s.queue.map((c) => (c.coilNo === coilNo ? { ...c, status: prevCardStatus } : c))
          : s.queue,
      }));
    }
  },
  stopCapture: (opts) => {
    const processCode = get().processCode;
    const shiftLogId = useShiftStore.getState().shiftLogId;
    const coilNo = get().activeCoilNo;
    const prevCaptureStatus = get().captureStatus;
    const prevRunStartedAt = get().runStartedAt;
    const prevStoppageStartedAt = get().stoppageStartedAt;
    const prevCardStatus = coilNo ? get().queue.find((c) => c.coilNo === coilNo)?.status : undefined;
    const categoryCode = opts?.categoryCode?.trim() || get().stoppageCode || '12';
    const remarks = opts?.remarks !== undefined ? opts.remarks : get().stoppageRemarks;
    if (opts?.categoryCode) set({ stoppageCode: categoryCode });
    if (opts?.remarks !== undefined) set({ stoppageRemarks: remarks });
    set({
      captureStatus: 'stoppage',
      captureError: null,
      stoppageStartedAt: new Date().toISOString(),
      // Keep prod start for net timer (hydrate also restores from server).
      runStartedAt: prevRunStartedAt,
      queue: get().queue.map((c) =>
        c.coilNo === coilNo ? { ...c, status: 'STOPPAGE' as const } : c,
      ),
    });
    if (!coilNo && !shiftLogId) return;
    void apiClient
      .post<{
        stoppageId?: string;
        order?: {
          status: string;
          coilNo?: string;
          prodStartAt?: string;
          activeStoppageId?: string;
          stoppages?: Array<{ stoppageId?: string; startAt: string; endAt?: string }>;
        };
      }>(`/stations/${processCode}/stoppages/start`, {
        shiftLogId,
        coilNo: coilNo ?? undefined,
        stoppageCode: categoryCode,
        remarks: remarks.trim() || undefined,
      })
      .then((res) => {
        if (res?.order) {
          const open = res.order.stoppages?.find((s) => !s.endAt);
          get().hydrateProcessRun({
            coilNo: res.order.coilNo || coilNo!,
            status: res.order.status,
            prodStartAt: res.order.prodStartAt,
            stoppageStartedAt: open?.startAt,
            activeStoppageId: res.order.activeStoppageId ?? res.stoppageId ?? null,
            stoppages: res.order.stoppages,
          });
          return;
        }
        if (res?.stoppageId) set({ activeStoppageId: String(res.stoppageId) });
      })
      .catch((err) => {
        set((s) => ({
          captureStatus: prevCaptureStatus,
          runStartedAt: prevRunStartedAt,
          stoppageStartedAt: prevStoppageStartedAt,
          captureError: formatCaptureError(err),
          queue: prevCardStatus && coilNo
            ? s.queue.map((c) => (c.coilNo === coilNo ? { ...c, status: prevCardStatus } : c))
            : s.queue,
        }));
      });
  },
  cancelStoppage: () => {
    const openId = get().activeStoppageId;
    const processCode = get().processCode;
    const coilNo = get().activeCoilNo;
    set({
      captureStatus: 'running',
      stoppageStartedAt: null,
      activeStoppageId: null,
    });
    if (!openId) return;
    void (async () => {
      try {
        await apiClient.post(`/stations/${processCode}/stoppages/${encodeURIComponent(openId)}/end`, {
          coilNo: coilNo ?? undefined,
        });
        if ((processCode === 'HRS' || processCode === 'PKL') && coilNo) {
          const { fetchHrsPklOrder, orderToHydrateInput } = await import('../lib/hrsPklWrites');
          get().hydrateProcessRun(orderToHydrateInput(await fetchHrsPklOrder(processCode, coilNo)));
        }
      } catch {
        /* ignore abort errors */
      }
    })();
  },
  setBusy: (busy) => set({ busy }),
  requestQueueRefresh: () => set((s) => ({ queueRefreshToken: s.queueRefreshToken + 1 })),

  loadQueue: async () => get().loadQueueFor(get().processCode),

  loadQueueFor: async (code) => {
    try {
      const data = await apiClient.get(processQueueUrl(code));
      const queue = mapQueue(code, data);
      // Always pin processCode — jsonEqual short-circuit must not leave a stale line.
      set((s) => (jsonEqual(s.queue, queue) ? { processCode: code } : { queue, processCode: code }));
      return queue;
    } catch {
      return get().queue;
    }
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
      set({ ...IDLE_RUN });
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
  // Validate before outbox — invalid payloads park forever as Sync Attention.
  const schema = CAPTURE_SCHEMA_BY_ENDPOINT[endpoint];
  const parsed = schema?.safeParse(payload);
  if (parsed && !parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(detail || 'Invalid production payload');
  }
  const body = parsed?.success ? parsed.data : payload;

  const { submitOrQueue } = await import('../operator/sync/submitOrQueue');
  await submitOrQueue({
    url: endpoint,
    method: 'POST',
    payload: body,
    aggregateKey: `capture:${coilNo}`,
  });
  notifyProductionChanged();
  useProcessStore.getState().requestQueueRefresh();
}
