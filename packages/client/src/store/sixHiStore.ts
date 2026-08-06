import { create } from 'zustand';
import type { SixHiOrderDetail, SixHiOrderStatus, SixHiQueueCard, SixHiShiftSummary, SixHiSubProcess } from '@m1/shared-validation';
import { apiClient } from '../lib/apiClient';
import { setActiveCrmMill } from '../lib/crmMillContext';
import { defaultMillTab } from '../lib/millConfig';
import type { MillCode } from '../lib/millPath';
import { canRecordStoppage } from '../lib/sixHiRuntime';
import { seedOrderDetailFromQueueCard } from '../lib/sixHiQueueCardSeed';
import { notifyProductionChanged } from '../lib/productionSync';
import { useShiftStore } from './shiftStore';
import {
  detectCombinedRunFromQueue,
  reconcileCombinedSelection,
} from '../lib/combinedProductionRun';
import { jsonEqual } from '../lib/silentRefresh';

let machineStateRefreshGen = 0;
const panelOrderInflight = new Map<string, Promise<SixHiOrderDetail | null>>();

export type SixHiProcessTab = 'rolling' | 'skinpass' | 'rewinding';

interface ActiveMachineOrder {
  batchNumber: string;
  status: string;
  subProcess: SixHiSubProcess;
}

export type CrmMachineCode = '6HI' | '4HI' | '2HI';

export interface CombinedProductionRunSummary {
  batchNumber: string;
  motherCoil: string;
  slitId?: string;
  customer: string;
  weightMt: number;
}

export interface CombinedProductionRun {
  primaryBatchNumber: string;
  batchNumbers: string[];
  orders: CombinedProductionRunSummary[];
}

export interface ManualStoppageState {
  eligible: boolean;
  active: {
    eventId: string;
    categoryCode?: string;
    categoryLabel?: string;
    breakdownCode?: string;
    reason?: string;
    startedAt: string;
    shiftCode?: string;
    rollInNo?: string;
    rollInCode?: string;
    rollOutNo?: string;
    rollOutCode?: string;
  } | null;
}

interface SixHiStore {
  processTab: SixHiProcessTab;
  machineCode: CrmMachineCode;
  workspaceOpen: boolean;
  workspaceBatch: string | null;
  panelOrder: SixHiOrderDetail | null;
  machineActive: ActiveMachineOrder | null;
  manualStoppage: ManualStoppageState | null;
  shiftSummary: SixHiShiftSummary | null;
  busy: boolean;
  manualOrderOpen: boolean;
  queueRefreshToken: number;
  /** Optimistic end in-flight: used to paint Completed immediately and show an "Ending…" badge. */
  optimisticEndingBatches: string[];
  /** Matching list — every order that *could* combine. Detection owns this. */
  combinedRun: CombinedProductionRun | null;
  /** Picked list — orders the operator ticked to start/run together. */
  combinedSelectedBatches: string[];
  /** Last combined actual total entered in the production form (for end payload). */
  combinedActualMtIntent: number | undefined;
  /** Batch number when stoppage modal is open; null when closed. */
  stoppageModalBatch: string | null;

  setProcessTab: (tab: SixHiProcessTab) => void;
  setMachineCode: (machine: CrmMachineCode) => void;
  openManualOrder: () => void;
  closeManualOrder: () => void;
  requestQueueRefresh: () => void;
  openWorkspace: (batchNo: string, queueCard?: SixHiQueueCard) => void;
  closeWorkspace: () => void;
  setPanelOrder: (order: SixHiOrderDetail | null) => void;
  setMachineActive: (active: ActiveMachineOrder | null) => void;
  setManualStoppage: (state: ManualStoppageState | null) => void;
  setShiftSummary: (summary: SixHiShiftSummary | null) => void;
  setBusy: (busy: boolean) => void;
  setCombinedRun: (run: CombinedProductionRun | null, opts?: { selectedBatches?: string[] }) => void;
  setCombinedActualMtIntent: (mt: number | undefined) => void;
  /** Rebuild combinedRun from queue when navigating to capture / opening production form. */
  hydrateCombinedRunFromQueue: (
    queueCards: SixHiQueueCard[],
    machineCode: string,
    anchorBatchNumber: string,
  ) => CombinedProductionRun | null;
  toggleCombinedSelected: (batchNumber: string) => void;
  openStoppageDialog: (batchNo: string) => Promise<void>;
  closeStoppageDialog: () => void;
  requestRejectionDialog?: (batchNo: string) => void;

  loadPanelOrder: (batchNo: string) => Promise<SixHiOrderDetail | null>;
  refreshMachineState: (opts?: { skipCombinedQueueFetch?: boolean }) => Promise<void>;
  loadShiftSummary: (shiftLogId: string) => Promise<void>;
  runOrderAction: (batchNo: string, fn: () => Promise<unknown>, opts?: {
    optimisticEndBatchNumbers?: string[];
    /** Save path: await writes only; refresh panel/queue in background. */
    refreshMode?: 'full' | 'save';
  }) => Promise<SixHiOrderDetail | null>;
  resetSession: () => void;
}

const INITIAL_SixHi_STATE = {
  processTab: 'rolling' as SixHiProcessTab,
  machineCode: '6HI' as CrmMachineCode,
  workspaceOpen: false,
  workspaceBatch: null as string | null,
  panelOrder: null as SixHiOrderDetail | null,
  machineActive: null as ActiveMachineOrder | null,
  manualStoppage: null as ManualStoppageState | null,
  shiftSummary: null as SixHiShiftSummary | null,
  busy: false,
  manualOrderOpen: false,
  queueRefreshToken: 0,
  optimisticEndingBatches: [] as string[],
  combinedRun: null as CombinedProductionRun | null,
  combinedSelectedBatches: [] as string[],
  combinedActualMtIntent: undefined as number | undefined,
  stoppageModalBatch: null as string | null,
  requestRejectionDialog: undefined as ((batchNo: string) => void) | undefined,
};

export const useSixHiStore = create<SixHiStore>((set, get) => ({
  ...INITIAL_SixHi_STATE,

  setProcessTab: (tab) => set({ processTab: tab }),
  setMachineCode: (machine: MillCode) => {
    const { processTab } = get();
    setActiveCrmMill(machine);
    let nextTab = processTab;
    if (machine === '2HI' && processTab === 'rolling') nextTab = defaultMillTab(machine);
    if (machine !== '2HI' && processTab === 'rewinding') nextTab = defaultMillTab(machine);
    set({ machineCode: machine, processTab: nextTab });
  },
  openManualOrder: () => set({ manualOrderOpen: true }),
  closeManualOrder: () => set({ manualOrderOpen: false }),
  requestQueueRefresh: () => set({ queueRefreshToken: get().queueRefreshToken + 1 }),
  openWorkspace: (batchNo, queueCard) => {
    const { combinedRun, combinedSelectedBatches, panelOrder } = get();
    const pickedPrimary = combinedSelectedBatches.length > 0
      ? (combinedSelectedBatches.includes(combinedRun?.primaryBatchNumber ?? '')
        ? combinedRun!.primaryBatchNumber
        : combinedSelectedBatches[0])
      : null;
    const batch = combinedRun?.batchNumbers.includes(batchNo)
      ? (pickedPrimary ?? combinedRun.primaryBatchNumber)
      : batchNo;

    if (queueCard && queueCard.batchNumber === batch) {
      const seeded = seedOrderDetailFromQueueCard(queueCard);
      if (!panelOrder || panelOrder.batchNumber !== batch || !jsonEqual(panelOrder, seeded)) {
        set({ panelOrder: seeded });
      }
    }

    set({ workspaceOpen: true, workspaceBatch: batchNo });
    void get().loadPanelOrder(batch);
  },
  closeWorkspace: () => set({
    workspaceOpen: false,
    workspaceBatch: null,
    // Keep combinedRun/selection — capture + orders tabs still need group context after closing the form.
  }),
  setPanelOrder: (order) => set({ panelOrder: order }),
  setMachineActive: (active) => set({ machineActive: active }),
  setManualStoppage: (state) => set({ manualStoppage: state }),
  setShiftSummary: (summary) => set({ shiftSummary: summary }),
  setBusy: (busy) => set({ busy }),
  setCombinedRun: (run, opts) => {
    const prev = get();
    const next = reconcileCombinedSelection(
      prev.combinedRun,
      prev.combinedSelectedBatches,
      run,
      opts?.selectedBatches,
    );
    set({
      ...next,
      combinedActualMtIntent: run ? prev.combinedActualMtIntent : undefined,
    });
  },
  setCombinedActualMtIntent: (mt) => set({ combinedActualMtIntent: mt }),
  hydrateCombinedRunFromQueue: (queueCards, machineCode, anchorBatchNumber) => {
    const detected = detectCombinedRunFromQueue(queueCards, machineCode, anchorBatchNumber);
    const prev = get().combinedRun;
    if (detected) {
      if (!prev
        || detected.batchNumbers.length !== prev.batchNumbers.length
        || !detected.batchNumbers.every((b) => prev.batchNumbers.includes(b))) {
        get().setCombinedRun(detected);
      }
      return detected;
    }
    if (prev?.batchNumbers.includes(anchorBatchNumber)) {
      get().setCombinedRun(null);
    }
    return null;
  },
  toggleCombinedSelected: (batchNumber) => {
    const { combinedRun, combinedSelectedBatches } = get();
    if (!combinedRun?.batchNumbers.includes(batchNumber)) return;
    const has = combinedSelectedBatches.includes(batchNumber);
    const nextSelected = has
      ? combinedSelectedBatches.filter((b) => b !== batchNumber)
      : [...combinedSelectedBatches, batchNumber];
    let nextRun = combinedRun;
    if (nextSelected.length > 0 && !nextSelected.includes(nextRun.primaryBatchNumber)) {
      nextRun = { ...nextRun, primaryBatchNumber: nextSelected[0] };
    }
    set({ combinedSelectedBatches: nextSelected, combinedRun: nextRun });
  },

  openStoppageDialog: async (batchNo) => {
    if (get().panelOrder?.batchNumber !== batchNo) {
      await get().loadPanelOrder(batchNo);
    }
    const order = get().panelOrder;
    if (!order || order.batchNumber !== batchNo) {
      throw new Error('Order not found');
    }
    if (!canRecordStoppage(order)) {
      throw new Error('Start production before recording a stoppage');
    }
    set({ stoppageModalBatch: batchNo });
  },

  closeStoppageDialog: () => set({ stoppageModalBatch: null }),

  loadPanelOrder: async (batchNo) => {
    const inflight = panelOrderInflight.get(batchNo);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const order = await apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNo)}`);
        const prev = get().panelOrder;
        if (prev?.batchNumber === batchNo && jsonEqual(prev, order)) {
          return prev;
        }
        set({ panelOrder: order });
        return order;
      } catch {
        return null;
      } finally {
        panelOrderInflight.delete(batchNo);
      }
    })();

    panelOrderInflight.set(batchNo, promise);
    return promise;
  },

  refreshMachineState: async () => {
    const refreshGen = ++machineStateRefreshGen;
    try {
      const mc = get().machineCode;
      const [activeCrm, manualStoppage] = await Promise.all([
        apiClient.get<ActiveMachineOrder | null>(`/6hi/active-order?machine=${mc}`),
        apiClient.get<ManualStoppageState>(`/6hi/manual-stoppage?machine=${mc}`),
      ]);

      if (refreshGen !== machineStateRefreshGen) return;

      let active = activeCrm;
      if (!active?.batchNumber) {
        try {
          const reroll = await apiClient.get<{ active: {
            batchNumber: string | null;
            batchNumbers?: string[];
            status: string;
          } | null }>(`/manual-reroll/sessions?machine=${encodeURIComponent(mc)}`);
          const open = reroll.active;
          if (open && (open.status === 'IN_PROGRESS' || open.status === 'STOPPAGE' || open.status === 'ON_HOLD')) {
            active = {
              batchNumber: open.batchNumbers?.length
                ? open.batchNumbers.join(' · ')
                : (open.batchNumber ?? 'RE-ROLL'),
              status: open.status,
              subProcess: 'ROLLING',
            };
          }
        } catch {
          // Flag off / no access — leave CRM-only active.
        }
      }

      if (refreshGen !== machineStateRefreshGen) return;

      const { workspaceOpen, combinedRun } = get();
      let nextCombinedRun = combinedRun;

      if (activeCrm?.batchNumber) {
        // Phase 2.2: derive combined run from store — no dual full-queue fetch.
        if (!combinedRun?.batchNumbers.includes(activeCrm.batchNumber)) {
          nextCombinedRun = null;
        }
      } else if (!workspaceOpen) {
        nextCombinedRun = null;
      }

      if (refreshGen !== machineStateRefreshGen) return;

      const prev = get();
      const patch: Partial<Pick<SixHiStore, 'machineActive' | 'manualStoppage' | 'panelOrder'>> = {};
      if (!jsonEqual(prev.machineActive, active)) patch.machineActive = active;
      if (!jsonEqual(prev.manualStoppage, manualStoppage)) patch.manualStoppage = manualStoppage;
      if (Object.keys(patch).length > 0) set(patch);
      if (!jsonEqual(prev.combinedRun, nextCombinedRun)) {
        get().setCombinedRun(nextCombinedRun);
      }

      if (activeCrm?.batchNumber) {
        const { workspaceOpen: wsOpen, workspaceBatch, combinedSelectedBatches, panelOrder: prevOrder } = get();
        const pickedPrimary = combinedSelectedBatches.length > 0
          ? (combinedSelectedBatches.includes(nextCombinedRun?.primaryBatchNumber ?? '')
            ? nextCombinedRun!.primaryBatchNumber
            : combinedSelectedBatches[0])
          : null;
        const formBatch = pickedPrimary ?? nextCombinedRun?.primaryBatchNumber ?? activeCrm.batchNumber;

        // RACE CONDITION FIX: If we have an active panelOrder with a valid start time,
        // and we are refreshing for the SAME batch, do not trigger a fresh load
        // which might return a stale version (without prodStartAt) during transition.
        const matchesCurrent = prevOrder?.batchNumber === formBatch;
        const alreadyRunning = prevOrder?.status === 'IN_PROGRESS' || prevOrder?.status === 'STOPPAGE';
        const hasStartTime = !!prevOrder?.prodStartAt;

        if (matchesCurrent && alreadyRunning && hasStartTime) {
          // Keep current authoritative panelOrder from the action response.
          return;
        }

        if (!wsOpen || workspaceBatch === activeCrm.batchNumber || workspaceBatch === formBatch) {
          await get().loadPanelOrder(formBatch);
        }
      } else if (!get().workspaceOpen) {
        const clearing: Partial<Pick<SixHiStore, 'panelOrder'>> = {};
        if (prev.panelOrder !== null) clearing.panelOrder = null;
        if (Object.keys(clearing).length > 0) set(clearing);
        if (prev.combinedRun !== null) get().setCombinedRun(null);
      }
    } catch {
      if (refreshGen !== machineStateRefreshGen) return;
      const prev = get();
      const clearing: Partial<Pick<SixHiStore, 'machineActive' | 'manualStoppage'>> = {};
      if (prev.machineActive !== null) clearing.machineActive = null;
      if (prev.manualStoppage !== null) clearing.manualStoppage = null;
      if (Object.keys(clearing).length > 0) set(clearing);
      if (prev.combinedRun !== null) get().setCombinedRun(null);
    }
  },

  loadShiftSummary: async (shiftLogId) => {
    try {
      const machineCode = get().machineCode;
      const qs = machineCode ? `?machine=${encodeURIComponent(machineCode)}` : '';
      const summary = await apiClient.get<SixHiShiftSummary>(`/6hi/shift-summary/${shiftLogId}${qs}`);
      const prev = get().shiftSummary;
      if (jsonEqual(prev, summary)) return;
      set({ shiftSummary: summary });
    } catch {
      if (get().shiftSummary !== null) set({ shiftSummary: null });
    }
  },

  runOrderAction: async (batchNo, fn, opts) => {
    const optimisticEndingBatches = opts?.optimisticEndBatchNumbers?.filter(Boolean) ?? [];
    const isOptimisticEnd = optimisticEndingBatches.length > 0;
    const lightSave = opts?.refreshMode === 'save';

    if (isOptimisticEnd) {
      // Optimistic end: keep console responsive and paint Completed immediately.
      set({ optimisticEndingBatches });
      set({ machineActive: null });

      const prevPanelOrder = get().panelOrder;
      if (prevPanelOrder && optimisticEndingBatches.includes(prevPanelOrder.batchNumber)) {
        set({
          panelOrder: {
            ...prevPanelOrder,
            status: 'COMPLETED' as SixHiOrderStatus,
          },
        });
      }
    } else {
      set({ busy: true });
    }

    try {
      const result = await fn();

      if (lightSave) {
        const shiftLogId = useShiftStore.getState().shiftLogId;
        notifyProductionChanged({ shiftLogId: shiftLogId ?? undefined, batchNumber: batchNo });
        void get().loadPanelOrder(batchNo);
        void get().refreshMachineState();
        if (shiftLogId) void get().loadShiftSummary(shiftLogId);
        return get().panelOrder;
      }

      let order: SixHiOrderDetail | null = null;
      if (!isOptimisticEnd) {
        if (result && typeof result === 'object' && 'batchNumber' in (result as object)) {
          order = result as SixHiOrderDetail;
        } else {
          const loaded = await get().loadPanelOrder(batchNo);
          if (!loaded) return null;
          order = loaded;
        }
        set({ panelOrder: order });
      }

      await get().refreshMachineState();
      const shiftLogId = useShiftStore.getState().shiftLogId;
      if (shiftLogId) await get().loadShiftSummary(shiftLogId);

      if (isOptimisticEnd) {
        notifyProductionChanged({ shiftLogId: shiftLogId ?? undefined, batchNumber: batchNo });
        set({ optimisticEndingBatches: [] });
        return null;
      }

      notifyProductionChanged({ shiftLogId: shiftLogId ?? undefined, batchNumber: batchNo });
      return order;
    } catch (err) {
      if (isOptimisticEnd) {
        // Roll back optimistic painting with a best-effort refresh.
        set({ optimisticEndingBatches: [] });
        await get().refreshMachineState();
        const shiftLogId = useShiftStore.getState().shiftLogId;
        if (shiftLogId) await get().loadShiftSummary(shiftLogId);
        notifyProductionChanged({ shiftLogId: shiftLogId ?? undefined, batchNumber: batchNo });
      }
      throw err;
    } finally {
      if (!isOptimisticEnd) set({ busy: false });
    }
  },

  resetSession: () => set({ ...INITIAL_SixHi_STATE }),
}));

/** Order is in preparing mode when workspace is open on a PENDING batch. */
export function isPreparing(order: SixHiOrderDetail | null, workspaceOpen: boolean, workspaceBatch: string | null): boolean {
  return !!(
    workspaceOpen &&
    workspaceBatch &&
    order?.batchNumber === workspaceBatch &&
    (order.status === 'PENDING' || order.status === 'PREPARING')
  );
}

/** Global production panel should stay visible for preparing or live production. */
export function shouldShowProductionPanel(
  order: SixHiOrderDetail | null,
  workspaceOpen: boolean,
  workspaceBatch: string | null,
): boolean {
  if (!order) return false;
  if (isPreparing(order, workspaceOpen, workspaceBatch)) return true;
  return order.status === 'IN_PROGRESS' || order.status === 'STOPPAGE';
}
