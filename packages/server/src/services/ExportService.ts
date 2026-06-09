/**
 * @deprecated Facade — delegates to ExportJobService (M1 Export Module Phase 0).
 * Prefer importing from `../export` in new code.
 */
import type { AuthUser } from './authService';
import {
  ExportJobService,
  parseExportRequest,
  parseQueryParams,
} from '../export/jobs/ExportJobService';
import type { ExportFormat, ExportJobView, RawExportScope } from '../export/types';

export type { ExportFormat };
export type ExportScope = RawExportScope;

/** @deprecated Use ExportJobView */
export interface ExportJobResult {
  jobId: string;
  status: ExportJobView['status'];
  downloadUrl?: string;
  rowCount?: number;
  createdAt: string;
  error?: string;
}

function toLegacyResult(view: ExportJobView): ExportJobResult {
  return {
    jobId: view.jobId,
    status: view.status,
    downloadUrl: view.downloadUrl,
    rowCount: view.rowCount,
    createdAt: view.createdAt,
    error: view.error,
  };
}

export class ExportService {
  static async createJob(
    scope: RawExportScope,
    formatInput: string | undefined,
    user: AuthUser,
  ): Promise<ExportJobResult> {
    const view = await ExportJobService.createAndRun(
      parseExportRequest({ type: 'RAW', format: formatInput, scope }),
      user,
    );
    return toLegacyResult(view);
  }

  static async createFromRequest(body: Record<string, unknown>, user: AuthUser): Promise<ExportJobView> {
    return ExportJobService.createAndRun(parseExportRequest(body), user);
  }

  static async getJob(jobId: string, user: AuthUser): Promise<ExportJobResult | null> {
    const view = await ExportJobService.getJob(jobId, user);
    return view ? toLegacyResult(view) : null;
  }

  static async getJobView(jobId: string, user: AuthUser): Promise<ExportJobView | null> {
    return ExportJobService.getJob(jobId, user);
  }

  static async resolveDownload(jobId: string, user: AuthUser) {
    return ExportJobService.resolveDownload(jobId, user);
  }

  static async listNotifications(user: AuthUser, withinSeconds = 60) {
    return ExportJobService.listRecentCompletions(user, withinSeconds);
  }

  static parseQueryParams(query: Record<string, unknown>) {
    const req = parseQueryParams(query);
    return { scope: req.scope as RawExportScope, format: req.format };
  }

  static async listHistory(
    user: AuthUser,
    filters: { type?: string; from?: string; to?: string; page?: number; limit?: number },
  ) {
    return ExportJobService.listJobs(user, filters as any);
  }
}
