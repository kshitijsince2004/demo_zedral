import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/db';
import { ShiftLogService } from '../src/services/shiftLogService';

describe('ShiftLogService.resolveShiftManagerId', () => {
  let appUserId: number;

  beforeAll(async () => {
    const user = await db
      .selectFrom('security.app_user')
      .select('user_id')
      .limit(1)
      .executeTakeFirst();
    if (!user) throw new Error('No app_user in database — run seed:users first');
    appUserId = user.user_id;
  });

  it('returns a master.operator id (auto-provisions when missing)', async () => {
    const operatorId = await ShiftLogService.resolveShiftManagerId(appUserId);
    expect(operatorId).toBeTruthy();
    expect(typeof operatorId).toBe('number');

    const row = await db
      .selectFrom('master.operator')
      .select('operator_id')
      .where('operator_id', '=', operatorId!)
      .executeTakeFirst();
    expect(row).toBeTruthy();
  });
});
