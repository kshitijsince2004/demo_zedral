import { SixHiService } from '../SixHiService';

export class SixHiExecutionService {
  static getOrder(
    ...args: Parameters<typeof SixHiService.getOrder>
  ): ReturnType<typeof SixHiService.getOrder> {
    return SixHiService.getOrder(...args);
  }

  static findActiveMachineOrder(
    ...args: Parameters<typeof SixHiService.findActiveMachineOrder>
  ): ReturnType<typeof SixHiService.findActiveMachineOrder> {
    return SixHiService.findActiveMachineOrder(...args);
  }

  static startProduction(
    ...args: Parameters<typeof SixHiService.startProduction>
  ): ReturnType<typeof SixHiService.startProduction> {
    return SixHiService.startProduction(...args);
  }

  static startCombinedProduction(
    ...args: Parameters<typeof SixHiService.startCombinedProduction>
  ): ReturnType<typeof SixHiService.startCombinedProduction> {
    return SixHiService.startCombinedProduction(...args);
  }

  static endProduction(
    ...args: Parameters<typeof SixHiService.endProduction>
  ): ReturnType<typeof SixHiService.endProduction> {
    return SixHiService.endProduction(...args);
  }

  static updateRolling(
    ...args: Parameters<typeof SixHiService.updateRolling>
  ): ReturnType<typeof SixHiService.updateRolling> {
    return SixHiService.updateRolling(...args);
  }

  static updateSkinPass(
    ...args: Parameters<typeof SixHiService.updateSkinPass>
  ): ReturnType<typeof SixHiService.updateSkinPass> {
    return SixHiService.updateSkinPass(...args);
  }

  static addRemark(
    ...args: Parameters<typeof SixHiService.addRemark>
  ): ReturnType<typeof SixHiService.addRemark> {
    return SixHiService.addRemark(...args);
  }

  static rejectOrder(
    ...args: Parameters<typeof SixHiService.rejectOrder>
  ): ReturnType<typeof SixHiService.rejectOrder> {
    return SixHiService.rejectOrder(...args);
  }

  static logRollChange(
    ...args: Parameters<typeof SixHiService.logRollChange>
  ): ReturnType<typeof SixHiService.logRollChange> {
    return SixHiService.logRollChange(...args);
  }

  static resolveOrderWeight(
    ...args: Parameters<typeof SixHiService.resolveOrderWeight>
  ): ReturnType<typeof SixHiService.resolveOrderWeight> {
    return SixHiService.resolveOrderWeight(...args);
  }

  static getProducedMt(
    ...args: Parameters<typeof SixHiService.getProducedMt>
  ): ReturnType<typeof SixHiService.getProducedMt> {
    return SixHiService.getProducedMt(...args);
  }

  static getManualStoppageStatus(
    ...args: Parameters<typeof SixHiService.getManualStoppageStatus>
  ): ReturnType<typeof SixHiService.getManualStoppageStatus> {
    return SixHiService.getManualStoppageStatus(...args);
  }

  static startManualStoppage(
    ...args: Parameters<typeof SixHiService.startManualStoppage>
  ): ReturnType<typeof SixHiService.startManualStoppage> {
    return SixHiService.startManualStoppage(...args);
  }

  static updateManualStoppage(
    ...args: Parameters<typeof SixHiService.updateManualStoppage>
  ): ReturnType<typeof SixHiService.updateManualStoppage> {
    return SixHiService.updateManualStoppage(...args);
  }

  static endManualStoppage(
    ...args: Parameters<typeof SixHiService.endManualStoppage>
  ): ReturnType<typeof SixHiService.endManualStoppage> {
    return SixHiService.endManualStoppage(...args);
  }
}
