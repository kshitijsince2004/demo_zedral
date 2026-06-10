import { UserRole } from '@m1/shared-validation';
import { AuthUser } from '../services/authService';

export function assertMachineAccess(user: AuthUser, machineCode: string): void {
  const code = machineCode.toUpperCase();
  if (user.roles.includes(UserRole.ADMIN as string) || user.roles.includes(UserRole.PLANT_HEAD as string)) {
    return;
  }
  const allowed = (user.machineAccess ?? []).map((m) => m.toUpperCase());
  if (!allowed.includes(code)) {
    throw new Error(`Forbidden: No access to machine ${code}`);
  }
}
