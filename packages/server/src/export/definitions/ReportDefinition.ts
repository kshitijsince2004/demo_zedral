import type { AuthUser } from '../../services/authService';
import type { ExportFormat, ExportType, ReportExecutionResult } from '../types';

export interface ReportDefinition {
  readonly id: ExportType;
  validateScope(scope: Record<string, unknown>): void;
  supportedFormats(): ExportFormat[];
  estimateRowCount(scope: Record<string, unknown>, user: AuthUser): Promise<number>;
  execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    user: AuthUser,
  ): Promise<ReportExecutionResult>;
}
