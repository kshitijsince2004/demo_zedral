import { ReportingService } from '../ReportingService';

export class DailyReportService {
  static getDailyReport(
    ...args: Parameters<typeof ReportingService.getDailyReport>
  ): ReturnType<typeof ReportingService.getDailyReport> {
    return ReportingService.getDailyReport(...args);
  }
}
