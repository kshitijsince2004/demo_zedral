import { create } from 'zustand';
import type { SixHiOrderDetail, SixHiShiftSummary, SixHiSubProcess } from '@m1/shared-validation';
import { apiClient } from '../lib/apiClient';
import { defaultMillTab, type MillProcessTab } from '../lib/millConfig';
import type { MillCode } from '../lib/millPath';

export type SixHiProcessTab = 'rolling' | 'skinpass';

interface ActiveMachineOrder {
  batchNumber: string;
  status: string;
  subProcess: SixHiSubProcess;
}

export type CrmMachineCode = '6HI' | '4HI' | '2HI';

interface SixHiStore {
  processTab: SixHiProcessTab;
  machineCode: CrmMachineCode;
  workspaceOpen: boolean;
  workspaceBatch: string | null;
  panelOrder: SixHiOrderDetail | null;
  machineActive: ActiveMachineOrder | null;
  shiftSummary: SixHiShiftSummary | null;
  busy: boolean;
  manualOrderOpen: boolean;
  queueRefreshToken: number;

  setProcessTab: (tab: SixHiProcessTab) => void;
  setMachineCode: (machine: CrmMachineCode) => void;
  openManualOrder: () => void;
  closeManualOrder: () => void;
  requestQueueRefresh: () => void;
  openWorkspace: (batchNo: string) => void;
  closeWorkspace: () => void;
  setPanelOrder: (order: SixHiOrderDetail | null) => void;
  setMachineActive: (active: ActiveMachineOrder | null) => void;
  setShiftSummary: (summary: SixHiShiftSummary | null) => void;
  setBusy: (busy: boolean) => void;
  requestStoppageDialog?: (batchNo: string) => Promise<void>;
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
  shiftSummary: null as SixHiShiftSummary | null,
  busy: false,
  manualOrderOpen: false,
  queueRefreshToken: 0,
  requestStoppageDialog: undefined as ((batchNo: string) => Promise<void>) | undefined,
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
    set({ workspaceOpen: true, workspaceBatch: batchNo });
    void get().loadPanelOrder(batchNo);
  },
  closeWorkspace: () => set({ workspaceOpen: false, workspaceBatch: null }),
  setPanelOrder: (order) => set({ panelOrder: order }),
  setMachineActive: (active) => set({ machineActive: active }),
  setShiftSummary: (summary) => set({ shiftSummary: summary }),
  setBusy: (busy) => set({ busy }),

  loadPanelOrder: async (batchNo) => {
    try {
      const order = await apiClient.get(`/6hi/orders/${encodeURIComponent(batchNo)}`);
      set({ panelOrder: order });
      return order;
    } catch {
      return null;
    }
  },

  refreshMachineState: async () => {
    try {
      const mc = get().machineCode;
      const active = await apiClient.get(`/6hi/active-order?machine=${mc}`);
      set({ machineActive: active });
      if (active?.batchNumber) {
        const { workspaceOpen, workspaceBatch } = get();
        if (!workspaceOpen || workspaceBatch === active.batchNumber) {
          await get().loadPanelOrder(active.batchNumber);
        }
      } else if (!get().workspaceOpen) {
        set({ panelOrder: null });
      }
    } catch {
      set({ machineActive: null });
    }
  },

  loadShiftSummary: async (shiftLogId) => {
    try {
      const summary = await apiClient.get(`/6hi/shift-summary/${shiftLogId}`);
      set({ shiftSummary: summary });
    } catch {
      set({ shiftSummary: null });
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
      return order;
    } catch (err) {
      // Re-throw so callers can display the error to the user
      throw err;
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
