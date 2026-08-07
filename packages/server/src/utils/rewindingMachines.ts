/** Rewinding line machine pool — not CrmMillCode (CRM mills only). */
export const REWINDING_MACHINES = ['RWD', '2HI'] as const;
export type RewindingMachineCode = (typeof REWINDING_MACHINES)[number];

export function parseRewindingMachineCode(raw: string): RewindingMachineCode | null {
  const code = raw.trim().toUpperCase();
  return (REWINDING_MACHINES as readonly string[]).includes(code)
    ? (code as RewindingMachineCode)
    : null;
}

export function assertRewindingMachine(machineCode: string): RewindingMachineCode {
  const parsed = parseRewindingMachineCode(machineCode);
  if (!parsed) {
    throw new Error(`Invalid rewinding machine: ${machineCode} (expected RWD or 2HI)`);
  }
  return parsed;
}

/** ppc_batch row qualifies for the rewinding queue / rwd_order ensure (rewinding import/manual only). */
export function isRewindingPpcBatch(batch: {
  from_work_center?: string | null;
  machine_code?: string | null;
  sub_process?: string | null;
  destination?: string | null;
}): boolean {
  const machine = String(batch.machine_code ?? '').toUpperCase();
  const sub = String(batch.sub_process ?? '').toUpperCase();
  const dest = String(batch.destination ?? '').toUpperCase();
  if (machine !== 'RWD' && machine !== '2HI') return false;
  if (dest === 'REWINDING') return true;
  return sub === 'RWD' || sub === 'REWINDING';
}
