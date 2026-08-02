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
