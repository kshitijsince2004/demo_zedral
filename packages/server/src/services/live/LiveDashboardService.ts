import { LiveService } from '../LiveService';

export class LiveDashboardService {
  static getMachineScope(
    ...args: Parameters<typeof LiveService.getMachineScope>
  ): ReturnType<typeof LiveService.getMachineScope> {
    return LiveService.getMachineScope(...args);
  }

  static getShiftQueueContext(
    ...args: Parameters<typeof LiveService.getShiftQueueContext>
  ): ReturnType<typeof LiveService.getShiftQueueContext> {
    return LiveService.getShiftQueueContext(...args);
  }

  static getSnapshot(
    ...args: Parameters<typeof LiveService.getSnapshot>
  ): ReturnType<typeof LiveService.getSnapshot> {
    return LiveService.getSnapshot(...args);
  }

  static getMachineCards(
    ...args: Parameters<typeof LiveService.getMachineCards>
  ): ReturnType<typeof LiveService.getMachineCards> {
    return LiveService.getMachineCards(...args);
  }

  static getMachineCommandCenterData(
    ...args: Parameters<typeof LiveService.getMachineCommandCenterData>
  ): ReturnType<typeof LiveService.getMachineCommandCenterData> {
    return LiveService.getMachineCommandCenterData(...args);
  }

  static getMachineHeadDashboard(
    ...args: Parameters<typeof LiveService.getMachineHeadDashboard>
  ): ReturnType<typeof LiveService.getMachineHeadDashboard> {
    return LiveService.getMachineHeadDashboard(...args);
  }
}
