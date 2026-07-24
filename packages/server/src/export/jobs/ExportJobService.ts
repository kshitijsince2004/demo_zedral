import { db } from '../../db';

import type { AuthUser } from '../../services/authService';

import { assertExportPermission } from '../auth/exportAuthz';

import { getReportDefinition } from '../definitions';

import { assertDprMonthWritable } from './DprMonthLock';

import { ExportJobRunner } from './ExportJobRunner';

import { ExportWorker } from './ExportWorker';

import { resolveSignedDownloadUrl } from './objectStorage';

import type {

  ExportClientStatus,

  ExportFormat,

  ExportJobStatus,

  ExportJobView,

  ExportRequest,

  ExportType,

  RawExportScope,

} from '../types';

import { formatExtension } from './artifactStore';
import { endOfPlantDay, startOfPlantDay } from '../../utils/dateOnly';



export const ASYNC_ROW_THRESHOLD = 10000;



function normalizeFormat(raw?: string): ExportFormat {

  const v = String(raw ?? 'CSV').toUpperCase();

  if (v === 'XLSX') return 'XLSX';

  if (v === 'PDF') return 'PDF';

  return 'CSV';

}



function normalizeType(raw?: string): ExportType {

  const v = String(raw ?? 'RAW').toUpperCase();

  if (v === 'DPR') return 'DPR';

  if (v === 'LINE_LOG') return 'LINE_LOG';

  if (v === 'COIL_TRACE') return 'COIL_TRACE';

  if (v === 'REJECTED_ORDERS') return 'REJECTED_ORDERS';

  if (v === 'SHIFT_SUMMARY') return 'SHIFT_SUMMARY';

  return 'RAW';

}



function toClientStatus(status: ExportJobStatus): ExportClientStatus {

  switch (status) {

    case 'queued': return 'PENDING';

    case 'running': return 'PROCESSING';

    case 'done': return 'COMPLETE';

    case 'error': return 'FAILED';

    default: return 'FAILED';

  }

}



function scopeLabel(type: ExportType, scope: Record<string, unknown>): string {

  if (type === 'DPR') return `DPR:${scope.month ?? 'month'}`;

  if (type === 'COIL_TRACE') return `TRACE:${scope.coil_no ?? scope.coilNo ?? 'batch'}`;

  if (type === 'LINE_LOG') return `LOG:${scope.process_code ?? scope.processId ?? 'line'}`;

  if (type === 'REJECTED_ORDERS') return `REJECTED:${scope.dateFrom ?? 'all'}`;

  if (type === 'SHIFT_SUMMARY') return `SHIFT:${scope.date ?? scope.dateFrom ?? 'date'}:${scope.shiftCode ?? 'shift'}`;

  return `RAW:${Object.keys(scope).join(',')}`;
}



export function parseExportRequest(body: Record<string, unknown>): ExportRequest {

  if (body.type) {

    return {

      type: normalizeType(String(body.type)),

      format: normalizeFormat(body.format ? String(body.format) : undefined),

      scope: (body.scope as Record<string, unknown>) ?? {},

      options: body.options as Record<string, unknown> | undefined,

    };

  }



  const legacyScope = (body.scope as Record<string, unknown>) ?? body;

  return {

    type: 'RAW',

    format: normalizeFormat(body.format ? String(body.format) : undefined),

    scope: {

      processId: legacyScope.processId,

      dateFrom: legacyScope.dateFrom,

      dateTo: legacyScope.dateTo,

      shiftCode: legacyScope.shiftCode,

      coilNo: legacyScope.coilNo,

    },

  };

}



export function parseQueryParams(query: Record<string, unknown>): ExportRequest {

  return {

    type: 'RAW',

    format: normalizeFormat(query.format ? String(query.format) : 'csv'),

    scope: {

      processId: query.process ? String(query.process) : undefined,

      dateFrom: query.date_from ? String(query.date_from) : undefined,

      dateTo: query.date_to ? String(query.date_to) : undefined,

      shiftCode: query.shift ? String(query.shift) : undefined,

      coilNo: query.coil_no ? String(query.coil_no) : undefined,

    },

  };

}



export class ExportJobService {

  static async createAndRun(request: ExportRequest, user: AuthUser): Promise<ExportJobView> {

    const definition = getReportDefinition(request.type);

    definition.validateScope(request.scope);

    assertExportPermission(user, request.type, request.scope);



    if (!definition.supportedFormats().includes(request.format)) {

      throw new Error(`Format ${request.format} not supported for ${request.type}`);

    }



    if (request.type === 'DPR' && request.scope.month) {

      await assertDprMonthWritable(String(request.scope.month), user);

    }



    const paramsJson = JSON.stringify({

      ...request.scope,

      type: request.type,

      format: request.format,

      options: request.options,

    });

    const label = scopeLabel(request.type, request.scope);



    const job = await db.insertInto('audit.export_job')

      .values({

        scope: label,

        params_json: paramsJson,

        format: request.format,

        export_type: request.type,

        job_status: 'queued',

        progress: 0,

        requested_by: user.id,

      } as any)

      .returningAll()

      .executeTakeFirstOrThrow();



    const jobId = String(job.export_id);



    const rowEstimate = await definition.estimateRowCount(request.scope, user);

    const csvStreaming = request.type === 'RAW' && request.format === 'CSV';

    const useAsync = rowEstimate > ASYNC_ROW_THRESHOLD && !csvStreaming;



    if (useAsync) {

      ExportWorker.kick();

      return this.toView(jobId, await this.fetchRow(jobId), user);

    }



    return ExportJobRunner.runJob(jobId, request, user);

  }



  static async getJob(jobId: string, user: AuthUser): Promise<ExportJobView | null> {

    const row = await this.fetchRow(jobId);

    if (!row) return null;

    return this.toView(jobId, row, user);

  }



  static async listJobs(

    user: AuthUser,

    filters: {

      type?: ExportType;

      from?: string;

      to?: string;

      page?: number;

      limit?: number;

    },

  ) {

    const page = Math.max(1, filters.page ?? 1);

    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const offset = (page - 1) * limit;



    let q = db.selectFrom('audit.export_job').selectAll();



    const isAdmin = user.roles.some((r) => ['ADMIN', 'PLANT_HEAD'].includes(r));

    if (!isAdmin) {

      q = q.where('requested_by', '=', user.id);

    }



    if (filters.type) q = q.where('export_type', '=', filters.type);

    if (filters.from) q = q.where('created_at', '>=', startOfPlantDay(filters.from));

    if (filters.to) {
      q = q.where('created_at', '<=', endOfPlantDay(filters.to));
    }



    const rows = await q

      .orderBy('created_at', 'desc')

      .limit(limit)

      .offset(offset)

      .execute();



    let countQ = db.selectFrom('audit.export_job').select((eb) => eb.fn.countAll().as('total'));

    if (!isAdmin) countQ = countQ.where('requested_by', '=', user.id);

    if (filters.type) countQ = countQ.where('export_type', '=', filters.type);

    if (filters.from) countQ = countQ.where('created_at', '>=', startOfPlantDay(filters.from));

    if (filters.to) {
      countQ = countQ.where('created_at', '<=', endOfPlantDay(filters.to));
    }

    const countRow = await countQ.executeTakeFirst();

    const total = Number(countRow?.total ?? 0);



    const jobs = await Promise.all(

      rows.map((row) => this.toView(String(row.export_id), row, user)),

    );



    return { jobs, page, limit, total, pages: Math.ceil(total / limit) };

  }



  static async listRecentCompletions(user: AuthUser, withinSeconds = 60) {

    const since = new Date(Date.now() - withinSeconds * 1000);

    let q = db

      .selectFrom('audit.export_job')

      .selectAll()

      .where('job_status', '=', 'done')

      .where('completed_at', '>=', since)

      .orderBy('completed_at', 'desc')

      .limit(20);



    if (!user.roles.some((r) => ['ADMIN', 'PLANT_HEAD'].includes(r))) {

      q = q.where('requested_by', '=', user.id);

    }



    const rows = await q.execute();

    return Promise.all(rows.map((row) => this.toView(String(row.export_id), row, user)));

  }



  static async resolveDownload(jobId: string, user: AuthUser): Promise<{

    filePath: string;

    format: string;

    redirectUrl?: string;

  }> {

    const view = await this.getJob(jobId, user);

    if (!view || view.jobStatus !== 'done') {

      throw new Error('Export job not ready');

    }



    const record = await this.fetchRow(jobId);

    if (!record?.file_path && !record?.storage_uri) {

      throw new Error('Export file not found');

    }



    if (record.storage_uri) {

      const signed = await resolveSignedDownloadUrl(record.storage_uri);

      if (signed) return { filePath: '', format: record.format, redirectUrl: signed };

    }



    const fs = await import('fs');

    if (!record.file_path || !fs.existsSync(record.file_path)) {

      throw new Error('Export file not found');

    }



    return { filePath: record.file_path, format: record.format };

  }



  private static async fetchRow(jobId: string) {

    return db.selectFrom('audit.export_job')

      .selectAll()

      .where('export_id', '=', jobId)

      .executeTakeFirst();

  }



  private static async toView(jobId: string, row: any, user: AuthUser): Promise<ExportJobView> {

    if (row.requested_by !== user.id && !user.roles.some((r) => ['ADMIN', 'PLANT_HEAD'].includes(r))) {

      throw new Error('Forbidden');

    }



    const jobStatus = (row.job_status ?? (row.file_path ? 'done' : 'error')) as ExportJobStatus;

    const type = (row.export_type ?? 'RAW') as ExportType;



    const artifact = row.file_path && row.sha256

      ? {

          url: `/exports/download/${jobId}`,

          filename: `export_${jobId}.${formatExtension(row.format as ExportFormat)}`,

          bytes: Number(row.artifact_bytes ?? 0),

          sha256: row.sha256,

        }

      : undefined;



    const signedDownloadUrl = row.storage_uri

      ? await resolveSignedDownloadUrl(row.storage_uri) ?? undefined

      : undefined;



    return {

      jobId,

      type,

      status: toClientStatus(jobStatus),

      jobStatus,

      progress: Number(row.progress ?? 0),

      downloadUrl: row.file_path || row.storage_uri ? `/exports/download/${jobId}` : undefined,

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

      signedDownloadUrl,

    };

  }

}



/** @deprecated Use parseExportRequest — kept for ExportService facade. */

export function legacyScopeFromBody(body: Record<string, unknown>): { scope: RawExportScope; format: ExportFormat } {

  const req = parseExportRequest(body);

  return { scope: req.scope as RawExportScope, format: req.format };

}


