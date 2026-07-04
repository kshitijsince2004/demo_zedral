import { ReportingService } from '../ReportingService';

export class TraceabilityReportingService {
  static searchCoilTraceability(
    ...args: Parameters<typeof ReportingService.searchCoilTraceability>
  ): ReturnType<typeof ReportingService.searchCoilTraceability> {
    return ReportingService.searchCoilTraceability(...args);
  }
}
