import { ReportingService } from '../ReportingService';

export class DashboardReportingService {
  static getSupervisorDashboard(
    ...args: Parameters<typeof ReportingService.getSupervisorDashboard>
  ): ReturnType<typeof ReportingService.getSupervisorDashboard> {
    return ReportingService.getSupervisorDashboard(...args);
  }

  static getPlantHeadDashboard(
    ...args: Parameters<typeof ReportingService.getPlantHeadDashboard>
  ): ReturnType<typeof ReportingService.getPlantHeadDashboard> {
    return ReportingService.getPlantHeadDashboard(...args);
  }

  static getPlantHeadDrilldown(
    ...args: Parameters<typeof ReportingService.getPlantHeadDrilldown>
  ): ReturnType<typeof ReportingService.getPlantHeadDrilldown> {
    return ReportingService.getPlantHeadDrilldown(...args);
  }

  static getPlantHeadBacklog(
    ...args: Parameters<typeof ReportingService.getPlantHeadBacklog>
  ): ReturnType<typeof ReportingService.getPlantHeadBacklog> {
    return ReportingService.getPlantHeadBacklog(...args);
  }

  static getManagementDashboard(
    ...args: Parameters<typeof ReportingService.getManagementDashboard>
  ): ReturnType<typeof ReportingService.getManagementDashboard> {
    return ReportingService.getManagementDashboard(...args);
  }

  static getDrilldown(
    ...args: Parameters<typeof ReportingService.getDrilldown>
  ): ReturnType<typeof ReportingService.getDrilldown> {
    return ReportingService.getDrilldown(...args);
  }
}
