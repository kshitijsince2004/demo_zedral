import { create } from 'zustand';
import { formatShiftDate } from '../lib/dateFormat';

export type CoilStatus = 'planned' | 'open' | 'done';
export type ProcessLine = 'HRS' | 'PKL' | 'CRM' | '6HI' | 'ANN' | 'SKP' | 'RWD' | 'CRS' | 'CTL' | 'GLV';

export interface PlannedCoil {
  id: string;
  coilNo: string;
  grade: string;
  customer: string;
  width: number;
  thickness: number;
  weightMt: number;
  status: CoilStatus;
  processLine: ProcessLine;
}

export interface StoppageEntry {
  id: string;
  code: string;
  reason: string;
  fromTime: string;
  toTime: string | null;
  durationMins: number | null;
  remarks: string;
}

export interface DefectEntry {
  id: string;
  code: string;
  description: string;
  location: string;
  quantityMt: number;
}

export interface CapturedValues {
  [key: string]: string | number | boolean | null;
}

export interface DetectedShiftContext {
  shiftName: string;
  windowStart: string;
  windowEnd: string;
  source: 'CLOCK' | 'OVERRIDE';
  overrideReason?: string;
}

export interface ShiftState {
  // Shift context — populated from /shifts/current + shift-log API (not hardcoded)
  shiftDate: string;
  shiftCode: 'A' | 'B' | 'C';
  shiftLogId: string | null;
  detectedShift: DetectedShiftContext | null;
  processLine: ProcessLine | null;
  /** Line in-charge name sourced from the active shift log, not hardcoded. */
  lineIncharge: string;
  /** Shift manager name sourced from the active shift log, not hardcoded. */
  shiftManager: string;
  targetMt: number;
  producedMt: number;

  // Coils — populated from the planning/auto-source API (Task 6.1), not hardcoded
  plannedCoils: PlannedCoil[];
  activeCoilId: string | null;
  capturedValues: CapturedValues;

  // Stoppages & Defects
  stoppages: StoppageEntry[];
  defects: DefectEntry[];
  runningStoppage: StoppageEntry | null;

  // Actions
  setShiftLogId: (id: string) => void;
  applyDetectedShift: (shift: {
    prodDate: string;
    shiftCode: string;
    shiftName: string;
    windowStart: string;
    windowEnd: string;
    source: 'CLOCK' | 'OVERRIDE';
    overrideReason?: string;
  }) => void;
  setProcessLine: (line: ProcessLine) => void;
  /**
   * Replaces the planned-coil list with data fetched from the planning/auto-source
   * API. Called by AutoSourceService (Task 6.1) once the real endpoint is wired.
   */
  setPlannedCoils: (coils: PlannedCoil[]) => void;
  selectCoil: (id: string) => void;
  updateCapturedValue: (key: string, value: string | number | boolean | null) => void;
  completeCoil: (id: string) => void;
  addStoppage: (entry: Omit<StoppageEntry, 'id'>) => void;
  endStoppage: (id: string) => void;
  addDefect: (entry: Omit<DefectEntry, 'id'>) => void;
  resetCapture: () => void;
  resetSession: () => void;
}

const INITIAL_SHIFT_STATE = {
  shiftDate: new Date().toISOString().split('T')[0],
  shiftCode: 'A' as const,
  shiftLogId: null,
  detectedShift: null,
  processLine: null,
  lineIncharge: '',
  shiftManager: '',
  targetMt: 0,
  producedMt: 0,
  plannedCoils: [] as PlannedCoil[],
  activeCoilId: null,
  capturedValues: {} as CapturedValues,
  stoppages: [] as StoppageEntry[],
  defects: [] as DefectEntry[],
  runningStoppage: null,
};

/**
 * shiftStore holds shift-level operational state (coil queue, stoppages, defects,
 * captured values). It is NOT a session/auth store — session truth (token, role,
 * lineAccess, lock state) lives exclusively in lib/authStore.ts (Requirement 8.4).
 *
 * Planned coils are initialised empty; they are populated at runtime by the
 * AutoSourceService calling setPlannedCoils() once the /auto-source endpoint is
 * wired (Task 6.1). The former MOCK_PLANNED_COILS constant has been removed.
 */
export const useShiftStore = create<ShiftState>((set, get) => ({
  ...INITIAL_SHIFT_STATE,

  setShiftLogId: (id) => set({ shiftLogId: id }),
  setProcessLine: (line) => set({ processLine: line }),

  setPlannedCoils: (coils) => set({ plannedCoils: coils }),

  selectCoil: (id) => set({ activeCoilId: id, capturedValues: {} }),

  updateCapturedValue: (key, value) => set((s) => ({
    capturedValues: { ...s.capturedValues, [key]: value },
  })),

  completeCoil: (id) => set((s) => ({
    plannedCoils: s.plannedCoils.map((c) =>
      c.id === id ? { ...c, status: 'done' as CoilStatus } : c
    ),
    producedMt: s.producedMt + (s.plannedCoils.find((c) => c.id === id)?.weightMt || 0),
    activeCoilId: null,
    capturedValues: {},
  })),

  addStoppage: (entry) => {
    const id = `s${Date.now()}`;
    const stoppage = { ...entry, id };
    set((s) => ({
      stoppages: [...s.stoppages, stoppage],
      runningStoppage: entry.toTime === null ? stoppage : s.runningStoppage,
    }));
  },

  endStoppage: (id) => set((s) => ({
    stoppages: s.stoppages.map((st) =>
      st.id === id ? { ...st, toTime: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }), durationMins: 0 } : st
    ),
    runningStoppage: s.runningStoppage?.id === id ? null : s.runningStoppage,
  })),

  addDefect: (entry) => {
    const id = `d${Date.now()}`;
    set((s) => ({ defects: [...s.defects, { ...entry, id }] }));
  },

  resetCapture: () => set({ activeCoilId: null, capturedValues: {} }),

  applyDetectedShift: (shift) =>
    set({
      shiftDate: formatShiftDate(shift.prodDate),
      shiftCode: shift.shiftCode as 'A' | 'B' | 'C',
      detectedShift: {
        shiftName: shift.shiftName,
        windowStart: shift.windowStart,
        windowEnd: shift.windowEnd,
        source: shift.source,
        overrideReason: shift.overrideReason,
      },
    }),

  resetSession: () => set({ ...INITIAL_SHIFT_STATE, shiftDate: new Date().toISOString().split('T')[0] }),
}));
