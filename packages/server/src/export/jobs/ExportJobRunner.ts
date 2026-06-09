import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import { getReportDefinition } from '../definitions';
import { renderCsv } from '../render/CsvRenderer';
import { renderPdf } from '../render/PdfRenderer';
import { renderXlsx } from '../render/XlsxRenderer';
import type { ExportFormat, ExportJobView, ExportRequest } from '../types';
import { artifactPath, formatExtension } from './artifactStore';
import { removePartialArtifact, uploadArtifactIfConfigured } from './objectStorage';

function toIso(d: Date = new Date()): string {
  return d.toISOString();
}

export class ExportJobRunner {
  static async runJob(
    jobId: string,
    request: ExportRequest,
    user: AuthUser,
  ): Promise<ExportJobView> {
    const definition = getReportDefinition(request.type);
    let renderedPath = '';

    try {
      await this.updateStatus(jobId, 'running', 15);

      const rowEstimate = await definition.estimateRowCount(request.scope, user);
      const result = await definition.execute(request.scope, request.format, user);
      await this.updateStatus(jobId, 'running', 65);

      const generatedAt = toIso();
      const sourceRecordCount = result.sourceRecordCount ?? result.rowCount ?? result.rows.length;
      const stamped = {
        ...result,
        generatedAt,
        sourceRecordCount,
      };

      const useStream = request.format === 'CSV'
        && (Boolean(stamped.streamBatches) || rowEstimate > 1000);

      renderedPath = artifactPath(jobId, request.format);
      const rendered = request.format === 'XLSX'
        ? await renderXlsx(jobId, stamped)
        : request.format === 'PDF'
          ? await renderPdf(jobId, stamped)
          : await renderCsv(jobId, stamped, { streaming: useStream });

      const storageUri = await uploadArtifactIfConfigured(
        jobId,
        request.format,
        rendered.filePath,
        rendered.sha256,
      );

      await db.updateTable('audit.export_job')
        .set({
          job_status: 'done',
          progress: 100,
          row_count: sourceRecordCount,
          file_path: rendered.filePath,
          sha256: rendered.sha256,
          artifact_bytes: rendered.bytes,
          data_version: stamped.dataVersion ?? null,
          generated_at: new Date(generatedAt),
          source_record_count: sourceRecordCount,
          storage_uri: storageUri,
          completed_at: new Date(),
          error_message: null,
        } as any)
        .where('export_id', '=', jobId)
        .execute();

      await db.insertInto('audit.audit_log').values({
        action: 'EXPORT',
        table_name: 'export_job',
        record_pk: jobId,
        column_name: 'params',
        old_value: null,
        new_value: JSON.stringify({
          scope: request.scope,
          filter_params: request.options,
          exported_row_count: sourceRecordCount,
          tz_aware_timestamp: new Date().toISOString(),
        }),
        user_id: user.id,
      } as any).execute();

      const row = await this.fetchRow(jobId);
      return ExportJobRunner.toView(jobId, row!, user);
    } catch (e: unknown) {
      if (renderedPath) removePartialArtifact(renderedPath);
      const message = e instanceof Error ? e.message : 'Export failed';
      await db.updateTable('audit.export_job')
        .set({
          job_status: 'error',
          progress: 0,
          error_message: message,
          completed_at: new Date(),
          file_path: null,
          sha256: null,
          artifact_bytes: null,
          storage_uri: null,
        } as any)
        .where('export_id', '=', jobId)
        .execute();

      const row = await this.fetchRow(jobId);
      return ExportJobRunner.toView(jobId, row!, user);
    }
  }

  private static async fetchRow(jobId: string) {
    return db.selectFrom('audit.export_job')
      .selectAll()
      .where('export_id', '=', jobId)
      .executeTakeFirst();
  }

  private static async updateStatus(jobId: string, status: string, progress: number) {
    await db.updateTable('audit.export_job')
      .set({ job_status: status, progress } as any)
      .where('export_id', '=', jobId)
      .execute();
  }

  static toView(jobId: string, row: any, user: AuthUser): ExportJobView {
    const jobStatus = row.job_status ?? 'error';
    const statusMap: Record<string, ExportJobView['status']> = {
      queued: 'PENDING',
      running: 'PROCESSING',
      done: 'COMPLETE',
      error: 'FAILED',
    };

    const type = row.export_type ?? 'RAW';
    const artifact = row.file_path && row.sha256
      ? {
          url: `/exports/download/${jobId}`,
          filename: `export_${jobId}.${formatExtension(row.format as ExportFormat)}`,
          bytes: Number(row.artifact_bytes ?? 0),
          sha256: row.sha256,
        }
      : undefined;

    if (row.requested_by !== user.id && !user.roles.some((r) => ['ADMIN', 'PLANT_HEAD'].includes(r))) {
      throw new Error('Forbidden');
    }

    return {
      jobId,
      type,
      status: statusMap[jobStatus] ?? 'FAILED',
      jobStatus,
      progress: Number(row.progress ?? 0),
      downloadUrl: row.file_path ? `/exports/download/${jobId}` : undefined,
      rowCount: row.row_count != null ? Number(row.row_count) : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
      error: row.error_message ?? undefined,
      artifact,
      dataVersion: row.data_version ?? undefined,
      generatedAt: row.generated_at ? new Date(row.generated_at).toISOString() : undefined,
      sourceRecordCount: row.source_record_count != null
        ? Number(row.source_record_count)
        : undefined,
      storageUri: row.storage_uri ?? undefined,
    };
  }
}
