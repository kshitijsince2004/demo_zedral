import { create } from 'zustand';
import type { SixHiOrderDetail, SixHiQueueCard, SixHiShiftSummary, SixHiSubProcess } from '@m1/shared-validation';
import { apiClient } from '../lib/apiClient';
import { defaultMillTab } from '../lib/millConfig';
import type { MillCode } from '../lib/millPath';
import { canRecordStoppage } from '../lib/sixHiRuntime';
import { notifyProductionChanged } from '../lib/productionSync';
import { useShiftStore } from './shiftStore';
import { detectCombinedRunFromQueue, dedupeQueueCards } from '../lib/combinedProductionRun';
import { formatShiftDate } from '../lib/dateFormat';
import { jsonEqual } from '../lib/silentRefresh';

let machineStateRefreshGen = 0;

export type SixHiProcessTab = 'rolling' | 'skinpass';

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
  combinedRun: CombinedProductionRun | null;
  /** Batch number when stoppage modal is open; null when closed. */
  stoppageModalBatch: string | null;

  setProcessTab: (tab: SixHiProcessTab) => void;
  setMachineCode: (machine: CrmMachineCode) => void;
  openManualOrder: () => void;
  closeManualOrder: () => void;
  requestQueueRefresh: () => void;
  openWorkspace: (batchNo: string) => void;
  closeWorkspace: () => void;
  setPanelOrder: (order: SixHiOrderDetail | null) => void;
  setMachineActive: (active: ActiveMachineOrder | null) => void;
  setManualStoppage: (state: ManualStoppageState | null) => void;
  setShiftSummary: (summary: SixHiShiftSummary | null) => void;
  setBusy: (busy: boolean) => void;
  setCombinedRun: (run: CombinedProductionRun | null) => void;
  openStoppageDialog: (batchNo: string) => Promise<void>;
  closeStoppageDialog: () => void;
  requestRejectionDialog?: (batchNo: string) => void;

  loadPanelOrder: (batchNo: string) => Promise<SixHiOrderDetail | null>;
  refreshMachineState: () => Promise<void>;
  loadShiftSummary: (shiftLogId: string) => Promise<void>;
  runOrderAction: (batchNo: string, fn: () => Promise<unknown>) => Promise<SixHiOrderDetail | null>;
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
  combinedRun: null as CombinedProductionRun | null,
  stoppageModalBatch: null as string | null,
  requestRejectionDialog: undefined as ((batchNo: string) => void) | undefined,
};

export const useSixHiStore = create<SixHiStore>((set, get) => ({
  ...INITIAL_SixHi_STATE,

  setProcessTab: (tab) => set({ processTab: tab }),
  setMachineCode: (machine: MillCode) => {
    const { processTab } = get();
    set({
      machineCode: machine,
      processTab: machine === '2HI' && processTab === 'rolling' ? defaultMillTab(machine) : processTab,
    });
  },
  openManualOrder: () => set({ manualOrderOpen: true }),
  closeManualOrder: () => set({ manualOrderOpen: false }),
  requestQueueRefresh: () => set({ queueRefreshToken: get().queueRefreshToken + 1 }),
  openWorkspace: (batchNo) => {
    const combined = get().combinedRun;
    const batch = combined?.batchNumbers.includes(batchNo)
      ? combined.primaryBatchNumber
      : batchNo;
    set({ workspaceOpen: true, workspaceBatch: batchNo });
    void get().loadPanelOrder(batch);
  },
  closeWorkspace: () => set({ workspaceOpen: false, workspaceBatch: null, combinedRun: null }),
  setPanelOrder: (order) => set({ panelOrder: order }),
  setMachineActive: (active) => set({ machineActive: active }),
  setManualStoppage: (state) => set({ manualStoppage: state }),
  setShiftSummary: (summary) => set({ shiftSummary: summary }),
  setBusy: (busy) => set({ busy }),
  setCombinedRun: (run) => set({ combinedRun: run }),

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
    }
  },

  refreshMachineState: async () => {
    const refreshGen = ++machineStateRefreshGen;
    try {
      const mc = get().machineCode;
      const [active, manualStoppage] = await Promise.all([
        apiClient.get<ActiveMachineOrder | null>(`/6hi/active-order?machine=${mc}`),
        apiClient.get<ManualStoppageState>(`/6hi/manual-stoppage?machine=${mc}`),
      ]);

      if (refreshGen !== machineStateRefreshGen) return;

      const { workspaceOpen, combinedRun } = get();
      let nextCombinedRun = combinedRun;

      if (active?.batchNumber) {
        try {
          const { shiftDate, shiftCode } = useShiftStore.getState();
          const params = `machine=${mc}&date=${formatShiftDate(shiftDate)}&shift=${shiftCode || 'A'}`;
          const [rolling, skinPass] = await Promise.all([
            apiClient.get<{ queue: SixHiQueueCard[] }>(`/6hi/queue?${params}&subProcess=ROLLING`),
            apiClient.get<{ queue: SixHiQueueCard[] }>(`/6hi/queue?${params}&subProcess=SKIN_PASS`),
          ]);
          const queue = dedupeQueueCards([...(rolling.queue ?? []), ...(skinPass.queue ?? [])]);
          const detected = detectCombinedRunFromQueue(queue, mc, active.batchNumber);
          if (detected) {
            nextCombinedRun = detected;
          } else if (!combinedRun?.batchNumbers.includes(active.batchNumber)) {
            nextCombinedRun = null;
          }
        } catch {
          if (!combinedRun?.batchNumbers.includes(active.batchNumber)) {
            nextCombinedRun = null;
          }
        }
      } else if (!workspaceOpen) {
        nextCombinedRun = null;
      }

      if (refreshGen !== machineStateRefreshGen) return;

      const prev = get();
      const patch: Partial<Pick<SixHiStore, 'machineActive' | 'manualStoppage' | 'combinedRun' | 'panelOrder'>> = {};
      if (!jsonEqual(prev.machineActive, active)) patch.machineActive = active;
      if (!jsonEqual(prev.manualStoppage, manualStoppage)) patch.manualStoppage = manualStoppage;
      if (!jsonEqual(prev.combinedRun, nextCombinedRun)) patch.combinedRun = nextCombinedRun;
      if (Object.keys(patch).length > 0) set(patch);

      if (active?.batchNumber) {
        const { workspaceOpen: wsOpen, workspaceBatch } = get();
        const formBatch = nextCombinedRun?.primaryBatchNumber ?? active.batchNumber;
        if (!wsOpen || workspaceBatch === active.batchNumber || workspaceBatch === formBatch) {
          await get().loadPanelOrder(formBatch);
        }
      } else if (!get().workspaceOpen) {
        const clearing: Partial<Pick<SixHiStore, 'panelOrder' | 'combinedRun'>> = {};
        if (prev.panelOrder !== null) clearing.panelOrder = null;
        if (prev.combinedRun !== null) clearing.combinedRun = null;
        if (Object.keys(clearing).length > 0) set(clearing);
      }
    } catch {
      if (refreshGen !== machineStateRefreshGen) return;
      const prev = get();
      const clearing: Partial<Pick<SixHiStore, 'machineActive' | 'manualStoppage' | 'combinedRun'>> = {};
      if (prev.machineActive !== null) clearing.machineActive = null;
      if (prev.manualStoppage !== null) clearing.manualStoppage = null;
      if (prev.combinedRun !== null) clearing.combinedRun = null;
      if (Object.keys(clearing).length > 0) set(clearing);
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

  runOrderAction: async (batchNo, fn) => {
    set({ busy: true });
    try {
      const result = await fn();
      let order: SixHiOrderDetail;
      if (result && typeof result === 'object' && 'batchNumber' in (result as object)) {
        order = result as SixHiOrderDetail;
      } else {
        const loaded = await get().loadPanelOrder(batchNo);
        if (!loaded) return null;
        order = loaded;
      }
      set({ panelOrder: order });
      await get().refreshMachineState();
      const shiftLogId = useShiftStore.getState().shiftLogId;
      if (shiftLogId) await get().loadShiftSummary(shiftLogId);
      get().requestQueueRefresh();
      notifyProductionChanged({ shiftLogId: shiftLogId ?? undefined, batchNumber: batchNo });
      return order;
    } finally {
      set({ busy: false });
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
