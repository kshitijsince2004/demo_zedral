import { SixHiService } from '../SixHiService';

export class SixHiShiftService {
  static getProcessId(
    ...args: Parameters<typeof SixHiService.getProcessId>
  ): ReturnType<typeof SixHiService.getProcessId> {
    return SixHiService.getProcessId(...args);
  }

  static ensureActiveShiftLog(
    ...args: Parameters<typeof SixHiService.ensureActiveShiftLog>
  ): ReturnType<typeof SixHiService.ensureActiveShiftLog> {
    return SixHiService.ensureActiveShiftLog(...args);
  }

  static formatPlanDate(
    ...args: Parameters<typeof SixHiService.formatPlanDate>
  ): ReturnType<typeof SixHiService.formatPlanDate> {
    return SixHiService.formatPlanDate(...args);
  }

  static toPlanDate(
    ...args: Parameters<typeof SixHiService.toPlanDate>
  ): ReturnType<typeof SixHiService.toPlanDate> {
    return SixHiService.toPlanDate(...args);
  }

  static getShiftSummary(
    ...args: Parameters<typeof SixHiService.getShiftSummary>
  ): ReturnType<typeof SixHiService.getShiftSummary> {
    return SixHiService.getShiftSummary(...args);
  }

  static saveShiftSummary(
    ...args: Parameters<typeof SixHiService.saveShiftSummary>
  ): ReturnType<typeof SixHiService.saveShiftSummary> {
    return SixHiService.saveShiftSummary(...args);
  }

  static getProducedMt(
    ...args: Parameters<typeof SixHiService.getProducedMt>
  ): ReturnType<typeof SixHiService.getProducedMt> {
    return SixHiService.getProducedMt(...args);
  }

  static resolveShiftLogIdForPlan(
    ...args: Parameters<typeof SixHiService.resolveShiftLogIdForPlan>
  ): ReturnType<typeof SixHiService.resolveShiftLogIdForPlan> {
    return SixHiService.resolveShiftLogIdForPlan(...args);
  }

  static resolveShiftLogIdsForPlan(
    ...args: Parameters<typeof SixHiService.resolveShiftLogIdsForPlan>
  ): ReturnType<typeof SixHiService.resolveShiftLogIdsForPlan> {
    return SixHiService.resolveShiftLogIdsForPlan(...args);
  }

  static expandSiblingShiftLogIds(
    ...args: Parameters<typeof SixHiService.expandSiblingShiftLogIds>
  ): ReturnType<typeof SixHiService.expandSiblingShiftLogIds> {
    return SixHiService.expandSiblingShiftLogIds(...args);
  }

  static syncShiftProductionCache(
    ...args: Parameters<typeof SixHiService.syncShiftProductionCache>
  ): ReturnType<typeof SixHiService.syncShiftProductionCache> {
    return SixHiService.syncShiftProductionCache(...args);
  }
}
