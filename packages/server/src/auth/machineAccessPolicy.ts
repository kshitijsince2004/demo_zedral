import { UserRole } from '@m1/shared-validation';
import { AuthUser } from '../services/authService';

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

export function assertMachineAccess(user: AuthUser, machineCode: string): void {
  const code = machineCode.toUpperCase();
  if (user.roles.includes(UserRole.ADMIN as string) || user.roles.includes(UserRole.PLANT_HEAD as string)) {
    return;
  }
  const allowed = (user.machineAccess ?? []).map((m) => m.toUpperCase());
  if (!allowed.includes(code)) {
    throw new MachineAccessForbiddenError(code);
  }
}
