import { db } from '../db';

/** Historical aliases for process_id 31 after CRM6 → 6HI → ROLLING renames. */
export const ROLLING_PROCESS_CODES = ['ROLLING', 'CRM', '6HI', 'CRM6'] as const;

export async function resolveRollingProcessId(): Promise<number> {
  const rows = await db
    .selectFrom('master.process')
    .select(['process_id', 'code'])
    .where('code', 'in', [...ROLLING_PROCESS_CODES])
    .execute();
  const preferred = ROLLING_PROCESS_CODES
    .map((code) => rows.find((r) => r.code === code))
    .find(Boolean);
  if (!preferred) {
    throw new Error('6HI process not configured (expected ROLLING, CRM, 6HI, or CRM6)');
  }
  return preferred.process_id;
}
