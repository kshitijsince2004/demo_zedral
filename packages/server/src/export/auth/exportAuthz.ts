import { UserRole } from '@m1/shared-validation';
import type { AuthUser } from '../../services/authService';
import { getScopedLineCodes } from '../../auth/lineAccessPolicy';
import type { ExportType } from '../types';
import { DPR_LINE_AREAS } from '../aggregation/lineAreas';
import { dprAreasForMachines } from '../dpr/areaGeometry';

const EXPORT_ROLES = [
  UserRole.PLANT_HEAD,
  UserRole.MACHINE_HEAD,
  UserRole.ADMIN,
] as string[];

/** DPR area codes visible to a scoped user; null = all areas. */
export function getScopedDprAreaCodes(user: AuthUser): string[] | null {
  if (user.roles.includes(UserRole.PLANT_HEAD as string)) return null;

  if (user.roles.includes(UserRole.MACHINE_HEAD as string)) {
    const machines = (user.machineAccess ?? []).map((m) => m.toUpperCase());
    if (machines.length === 0) return [];
    return dprAreasForMachines(machines);
  }

  const scoped = getScopedLineCodes(user, 'READ');
  if (scoped === null) return null;

  const codes = new Set<string>();
  for (const line of scoped) {
    if (line === '6HI' || line === 'CRM') {
      for (const a of DPR_LINE_AREAS) {
        if (/^(4|6|2)HI|WR|RW|HPH/i.test(a.areaCode)) codes.add(a.areaCode);
      }
    } else if (line === 'PKL') {
      codes.add('PKLG');
    } else if (line === 'ANN') {
      codes.add('HPH');
    } else if (line === 'CRS') {
      for (const a of DPR_LINE_AREAS) {
        if (a.areaCode.startsWith('CRS')) codes.add(a.areaCode);
      }
    } else if (line === 'CTL') {
      for (const a of DPR_LINE_AREAS) {
        if (a.areaCode.startsWith('CTL')) codes.add(a.areaCode);
      }
    } else {
      codes.add(line);
    }
  }
  return [...codes];
}

export function assertExportPermission(
  user: AuthUser,
  type: ExportType,
  _scope: Record<string, unknown>,
): void {
  if (!user.roles.some((r) => EXPORT_ROLES.includes(r))) {
    throw new Error('Forbidden: export requires supervisor, plant head, machine head, or admin role');
  }

  const scoped = getScopedLineCodes(user, 'READ');
  const isMachineHead = user.roles.includes(UserRole.MACHINE_HEAD as string);
  const machineAreas = isMachineHead ? getScopedDprAreaCodes(user) : null;

  switch (type) {
    case 'DPR':
      if (user.roles.includes(UserRole.PLANT_HEAD as string)) break;
      if (isMachineHead) {
        if (!machineAreas || machineAreas.length === 0) {
          throw new Error('Forbidden: no machine access for DPR export');
        }
        break;
      }
      if (scoped !== null && scoped.length === 0) {
        throw new Error('Forbidden: no line read access for DPR export');
      }
      break;
    case 'LINE_LOG':
    case 'COIL_TRACE':
    case 'RAW':
      if (scoped !== null && scoped.length === 0) {
        throw new Error('Forbidden: no line read access for export');
      }
      break;
    default:
      break;
  }
}

export function filterRunsByAreaAccess<T extends { areaCode: string }>(
  user: AuthUser,
  rows: T[],
): T[] {
  const areas = getScopedDprAreaCodes(user);
  if (areas === null) return rows;
  const allowed = new Set(areas);
  return rows.filter((r) => allowed.has(r.areaCode));
}
