import { db } from '../../db';
import type { AuthUser } from '../../services/authService';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function isDprMonthFinalized(month: string): Promise<boolean> {
  if (!MONTH_RE.test(month)) return false;
  const row = await db
    .selectFrom('audit.dpr_month_lock' as any)
    .select('month')
    .where('month', '=', month)
    .executeTakeFirst();
  return Boolean(row);
}

export async function assertDprMonthWritable(month: string, user: AuthUser): Promise<void> {
  const locked = await isDprMonthFinalized(month);
  if (!locked) return;
  if (user.roles.includes('ADMIN')) return;
  throw new Error(`DPR month ${month} is finalized and locked. Contact an administrator to override.`);
}

export async function finalizeDprMonth(
  month: string,
  user: AuthUser,
  exportJobId?: string,
): Promise<void> {
  if (!MONTH_RE.test(month)) {
    throw new Error('month must be YYYY-MM');
  }
  if (!user.roles.some((r) => ['ADMIN', 'PLANT_HEAD'].includes(r))) {
    throw new Error('Forbidden: only admin or plant head may finalize a DPR month');
  }

  const existing = await isDprMonthFinalized(month);
  if (existing) {
    await db
      .updateTable('audit.dpr_month_lock' as any)
      .set({
        finalized_at: new Date(),
        finalized_by: user.id,
        export_job_id: exportJobId ?? null,
      })
      .where('month', '=', month)
      .execute();
    return;
  }

  await db
    .insertInto('audit.dpr_month_lock' as any)
    .values({
      month,
      finalized_by: user.id,
      export_job_id: exportJobId ?? null,
      finalized_at: new Date(),
    })
    .execute();
}
