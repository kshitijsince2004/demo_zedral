import { sql } from 'kysely';
import { db } from '../../db';
import { getUserWithRolesAndAccess } from '../../services/authService';
import type { ExportFormat, ExportRequest, ExportType } from '../types';
import { ExportJobRunner } from './ExportJobRunner';

const DEFAULT_POLL_MS = Number(process.env.EXPORT_WORKER_POLL_MS ?? 5000);

let workerRunning = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export class ExportWorker {
  static start(pollMs = DEFAULT_POLL_MS): void {
    if (pollMs <= 0 || process.env.EXPORT_WORKER_ENABLED === 'false') return;
    if (pollTimer) return;

    void this.processQueue();
    pollTimer = setInterval(() => void this.processQueue(), pollMs);
    console.log(`[ExportWorker] started (poll ${pollMs}ms)`);
  }

  static stop(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /** Process one or more queued jobs (non-reentrant). */
  static async processQueue(): Promise<number> {
    if (workerRunning) return 0;
    workerRunning = true;
    let processed = 0;

    try {
      while (true) {
        const job = await this.claimNextJob();
        if (!job) break;

        const request = this.parseStoredRequest(
          job.params_json,
          job.format,
          job.export_type,
        );
        const user = await this.loadRequestingUser(Number(job.requested_by));
        if (!user) {
          await this.failClaimed(job.export_id, 'Requesting user not found');
          continue;
        }

        await ExportJobRunner.runJob(String(job.export_id), request, user);
        processed += 1;
      }
    } finally {
      workerRunning = false;
    }

    return processed;
  }

  static kick(): void {
    void this.processQueue();
  }

  private static async claimNextJob() {
    const result = await sql<{
      export_id: string;
      params_json: string;
      requested_by: number;
      format: string;
      export_type: string;
    }>`
      UPDATE audit.export_job
      SET job_status = 'running', progress = 5
      WHERE export_id = (
        SELECT export_id FROM audit.export_job
        WHERE job_status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING export_id, params_json, requested_by, format, export_type
    `.execute(db);

    return result.rows[0] ?? null;
  }

  private static parseStoredRequest(
    paramsJson: string | Record<string, unknown>,
    format: string,
    exportType: string,
  ): ExportRequest {
    const parsed = (typeof paramsJson === 'string' ? JSON.parse(paramsJson) : paramsJson) as Record<string, unknown>;
    const { type: _t, format: _f, options, ...scope } = parsed;
    return {
      type: exportType.toUpperCase() as ExportType,
      format: format.toUpperCase() as ExportFormat,
      scope: scope as Record<string, unknown>,
      options: options as Record<string, unknown> | undefined,
    };
  }

  private static async loadRequestingUser(userId: number) {
    const row = await db
      .selectFrom('security.app_user')
      .select(['user_id', 'username'])
      .where('user_id', '=', userId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();

    if (!row) return null;
    return getUserWithRolesAndAccess(row.user_id, row.username);
  }

  private static async failClaimed(jobId: string, message: string) {
    await db.updateTable('audit.export_job')
      .set({
        job_status: 'error',
        progress: 0,
        error_message: message,
        completed_at: new Date(),
      } as any)
      .where('export_id', '=', jobId)
      .execute();
  }
}
