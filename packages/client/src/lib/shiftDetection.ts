import { apiClient } from './apiClient';
import { useShiftStore } from '../store/shiftStore';

/**
 * Mirrors the server ShiftDetectionService.DetectedShift union.
 * With a machine code, an ACTIVE session pins the shift (`source: 'SESSION'`)
 * even after the wall clock rolls to the next shift — until handover closes it.
 * Without a machine code, the response is clock/override only (shift-change watcher).
 */
export type DetectedShiftSource = 'CLOCK' | 'OVERRIDE' | 'SESSION' | 'FALLBACK';

export interface DetectedShift {
  shiftCode: string;
  shiftName: string;
  prodDate: string;
  windowStart: string;
  windowEnd: string;
  detectedAt: string;
  source: DetectedShiftSource;
  overrideId?: number;
  overrideReason?: string;
}

export async function bootstrapShiftContext(machineCode?: string): Promise<DetectedShift> {
  const q = machineCode ? `?machine=${encodeURIComponent(machineCode)}` : '';
  const shift = await apiClient.get<DetectedShift>(`/shifts/current${q}`);
  useShiftStore.getState().applyDetectedShift(shift);
  return shift;
}
