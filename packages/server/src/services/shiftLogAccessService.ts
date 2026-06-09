import { db } from '../db';
import { assertLineOperation } from '../auth/lineAccessPolicy';
import { AuthError, AuthUser, LineAccessLevel } from './authService';

export async function getProcessCodeForShiftLog(shiftLogId: string): Promise<string> {
  const row = await db
    .selectFrom('txn.shift_log as sl')
    .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
    .select('p.code as processCode')
    .where('sl.shift_log_id', '=', String(shiftLogId))
    .executeTakeFirst();

  if (!row) {
    throw new AuthError('Shift log not found');
  }

  return row.processCode;
}

export async function assertShiftLogAccess(
  user: AuthUser,
  shiftLogId: string,
  operation: LineAccessLevel,
): Promise<void> {
  const processCode = await getProcessCodeForShiftLog(shiftLogId);
  assertLineOperation(user, processCode, operation);
}
