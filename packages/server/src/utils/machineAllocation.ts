import type { SixHiSubProcess } from '@m1/shared-validation';
import { throwVersionConflict } from './versionConflict';

export type CrmMillCode = '6HI' | '4HI' | '2HI';

export const ROLLING_MILLS: CrmMillCode[] = ['6HI', '4HI'];
export const SKIN_PASS_MILLS: CrmMillCode[] = ['2HI', '4HI', '6HI'];
export const CRM_MILL_CODES: CrmMillCode[] = ['6HI', '4HI', '2HI'];

export function millsForSubProcess(subProcess: SixHiSubProcess): CrmMillCode[] {
  return subProcess === 'ROLLING' ? ROLLING_MILLS : SKIN_PASS_MILLS;
}

export function parseCrmMillCode(raw: string): CrmMillCode | null {
  const v = raw.trim().toUpperCase();
  return CRM_MILL_CODES.includes(v as CrmMillCode) ? (v as CrmMillCode) : null;
}

export function assertMachineForSubProcess(subProcess: SixHiSubProcess, machineCode: string): CrmMillCode {
  const machine = parseCrmMillCode(machineCode);
  if (!machine) throw new Error(`Unknown machine: ${machineCode}`);
  const allowed = millsForSubProcess(subProcess);
  if (!allowed.includes(machine)) {
    throw new Error(`${machine} is not valid for ${subProcess.replace('_', ' ')}`);
  }
  return machine;
}

/** PERF-E3: claim is idempotent on same target; 409 if already allocated elsewhere. */
export function assertMachineClaimOrIdempotent(
  batch: { batchNumber?: string; machine_code: string | null; machine_allocated?: boolean | null },
  targetMachine: string,
  allowReassign = false,
): 'idempotent' | 'proceed' {
  const allocated = batch.machine_allocated ?? true;
  const current = batch.machine_code;
  if (allocated && current === targetMachine) return 'idempotent';
  if (allocated && current && current !== targetMachine && !allowReassign) {
    throwVersionConflict({
      batchNumber: batch.batchNumber ?? null,
      machineCode: current,
      machineAllocated: true,
    });
  }
  return 'proceed';
}

export function defaultSuggestedMachine(subProcess: SixHiSubProcess): CrmMillCode {
  return subProcess === 'ROLLING' ? '6HI' : '2HI';
}

export function routeRequiresMachineAllocation(routeCode: string): boolean {
  return routeCode === '4' || routeCode === 'X';
}
