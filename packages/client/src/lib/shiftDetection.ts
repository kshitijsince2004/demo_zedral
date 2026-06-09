import { apiClient } from './apiClient';
import { useShiftStore } from '../store/shiftStore';

export interface DetectedShift {
  shiftCode: string;
  shiftName: string;
  prodDate: string;
  windowStart: string;
  windowEnd: string;
  detectedAt: string;
  source: 'CLOCK' | 'OVERRIDE';
  overrideId?: number;
  overrideReason?: string;
}

export async function bootstrapShiftContext(machineCode?: string): Promise<DetectedShift> {
  const q = machineCode ? `?machine=${encodeURIComponent(machineCode)}` : '';
  const shift = await apiClient.get<DetectedShift>(`/shifts/current${q}`);
  useShiftStore.getState().applyDetectedShift(shift);
  return shift;
}
