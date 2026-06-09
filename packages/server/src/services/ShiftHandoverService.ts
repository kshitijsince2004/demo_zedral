import { ShiftLogService } from './shiftLogService';

/**
 * @deprecated Use ShiftLogService.getHandoverSummary / ShiftLogService.handover instead.
 * Retained as a thin delegate for legacy /handovers route compatibility.
 */
export class ShiftHandoverService {
  static getHandoverSummary(shiftLogId: string) {
    return ShiftLogService.getHandoverSummary(shiftLogId);
  }
}
