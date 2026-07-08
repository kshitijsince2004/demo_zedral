import { apiClient } from './apiClient';
import { useShiftStore } from '../store/shiftStore';

/**
 * Mirrors the server ShiftDetectionService.DetectedShift union. When a machine has
 * an ACTIVE session the shift is pinned (`source: 'SESSION'`) and windowStart/windowEnd
 * come from that session's shift, not the wall clock.
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
