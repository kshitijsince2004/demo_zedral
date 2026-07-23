import { UserRole } from '@m1/shared-validation';
import { AuthUser } from '../services/authService';
import { db } from '../db';

export class MachineAccessForbiddenError extends Error {
  constructor(machineCode: string) {
    super(`Forbidden: No access to machine ${machineCode.toUpperCase()}`);
    this.name = 'MachineAccessForbiddenError';
  }
}

export function isMachineAccessForbidden(error: unknown): boolean {
  if (error instanceof MachineAccessForbiddenError) return true;
  if (error instanceof Error && error.message.includes('Forbidden: No access to machine')) {
    return true;
  }
  return false;
}

export function assertMachineAccess(
  user: AuthUser,
  machineCode: string,
  opts?: { mode?: 'READ' | 'WRITE' },
): void {
  const code = machineCode.toUpperCase();
  const mode = opts?.mode ?? 'WRITE';
  if (user.roles.includes(UserRole.ADMIN as string) || user.roles.includes(UserRole.PLANT_HEAD as string)) {
    return;
  }
  if (mode === 'READ' && user.roles.includes(UserRole.SUPERVISOR as string)) {
    return;
  }
  const allowed = (user.machineAccess ?? []).map((m) => m.toUpperCase());
  if (!allowed.includes(code)) {
    throw new MachineAccessForbiddenError(code);
  }
}

export async function resolveShiftLogMachines(shiftLogId: string): Promise<string[]> {
  const id = String(shiftLogId);
  const machines = new Set<string>();

  // 1. txn.machine_shift_session
  const sessions = await db
    .selectFrom('txn.machine_shift_session')
    .select('machine_code')
    .where('shift_log_id', '=', id as any)
    .execute();
  for (const s of sessions) {
    if (s.machine_code) machines.add(s.machine_code.toUpperCase());
  }

  // 2. Orders attributed to this shift → machine from PPC batch (not sub_process)
  const orders = await db
    .selectFrom('txn.crm_order as o')
    .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
    .select('pb.machine_code')
    .where('o.shift_log_id', '=', id as any)
    .execute();
  for (const o of orders) {
    if (o.machine_code) machines.add(o.machine_code.toUpperCase());
  }

  // 3. shift_log.mill_type & fallback
  const log = await db
    .selectFrom('txn.shift_log')
    .select(['mill_type', 'process_id'])
    .where('shift_log_id', '=', id as any)
    .executeTakeFirst();
    
  if (log?.mill_type) {
    machines.add(log.mill_type.toUpperCase());
  } else if (log?.process_id && machines.size === 0) {
    // 4. fallback: master.machine
    const masterMachines = await db
      .selectFrom('master.machine')
      .select('machine_code')
      .where('process_id', '=', log.process_id)
      .execute();
    for (const m of masterMachines) {
      if (m.machine_code) machines.add(m.machine_code.toUpperCase());
    }
  }

  return Array.from(machines);
}

export async function assertShiftLogApproval(user: AuthUser, shiftLogId: string): Promise<void> {
  if (user.roles.includes(UserRole.ADMIN as string) || user.roles.includes(UserRole.PLANT_HEAD as string)) {
    return;
  }
  
  if (!user.roles.includes(UserRole.MACHINE_HEAD as string)) {
    throw new Error('Forbidden: Only machine heads may approve on a machine');
  }

  const machines = await resolveShiftLogMachines(shiftLogId);
  const allowed = (user.machineAccess ?? []).map((m) => m.toUpperCase());
  
  for (const m of machines) {
    if (!allowed.includes(m)) {
      throw new MachineAccessForbiddenError(m);
    }
  }
}
