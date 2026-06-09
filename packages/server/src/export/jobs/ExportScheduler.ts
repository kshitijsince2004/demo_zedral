import { db } from '../../db';
import { getUserWithRolesAndAccess } from '../../services/authService';
import { ExportWorker } from './ExportWorker';
import type { ExportRequest } from '../types';

const DEFAULT_CRON_HOUR = Number(process.env.DPR_SCHEDULE_HOUR ?? 7);
const SYSTEM_USER_ID = Number(process.env.EXPORT_SYSTEM_USER_ID ?? 1);

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function msUntilNextRun(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export class ExportScheduler {
  private static timer: ReturnType<typeof setTimeout> | null = null;

  static start(): void {
    if (process.env.DPR_SCHEDULER_ENABLED === 'false') return;
    this.scheduleNext();
    console.log(`[ExportScheduler] DPR nightly enabled (hour ${DEFAULT_CRON_HOUR} local)`);
  }

  static stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private static scheduleNext(): void {
    const delay = msUntilNextRun(DEFAULT_CRON_HOUR);
    this.timer = setTimeout(() => {
      void this.runNightlyDpr().finally(() => this.scheduleNext());
    }, delay);
  }

  /** Refresh current-month DPR workbook after shift-C close. */
  static async runNightlyDpr(month = currentMonth()): Promise<string | null> {
    const userRow = await db
      .selectFrom('security.app_user')
      .select(['user_id', 'username'])
      .where('user_id', '=', SYSTEM_USER_ID)
      .executeTakeFirst();

    if (!userRow) {
      console.warn('[ExportScheduler] system user not found — skipping DPR');
      return null;
    }

    const user = await getUserWithRolesAndAccess(userRow.user_id, userRow.username);
    const request: ExportRequest = {
      type: 'DPR',
      format: 'XLSX',
      scope: { month, scheduled: true },
    };

    const paramsJson = JSON.stringify({ ...request.scope, type: request.type, format: request.format });
    const job = await db.insertInto('audit.export_job')
      .values({
        scope: `DPR:${month}`,
        params_json: paramsJson,
        format: 'XLSX',
        export_type: 'DPR',
        job_status: 'queued',
        progress: 0,
        requested_by: user.id,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    const jobId = String(job.export_id);
    ExportWorker.kick();
    console.log(`[ExportScheduler] queued nightly DPR for ${month} (job ${jobId})`);
    return jobId;
  }
}
