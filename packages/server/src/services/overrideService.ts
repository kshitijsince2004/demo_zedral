import { db } from '../db';
import { AuthUser } from './authService';
export interface OverrideRequest { field: string; reason: string; }

export const persistOverrides = async (
  shiftLogId: string,
  overrides: OverrideRequest[],
  user: AuthUser
) => {
  if (!overrides || overrides.length === 0) {
    return;
  }

  // Map into rows for the txn.validation_overrides table
  const insertData = overrides.map(o => ({
    shift_log_id: shiftLogId,
    field_path: o.field,
    reason: o.reason,
    override_by: user.id,
    created_at: new Date(),
  }));

  // Assuming `txn.validation_overrides` exists in the Kysely Database interface
  // The actual insert would look like this:
  /*
  await db
    .insertInto('txn.validation_overrides' as any)
    .values(insertData)
    .execute();
  */
  
  // Note: Kysely types are still empty from earlier, so we bypass strict type checking for the insert for now.
  await db
    .insertInto('txn.validation_overrides' as any)
    .values(insertData)
    .execute();
};
