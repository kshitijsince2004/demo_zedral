export const ANN_BASE_REQUIRED_MSG = 'Base must be assigned before starting the annealing process.';

export function assertAnnBaseAssigned(baseNo: string | null | undefined): string {
  const base = String(baseNo ?? '').trim().toUpperCase();
  if (!base) throw new Error(ANN_BASE_REQUIRED_MSG);
  return base;
}

export function annCreateStatus(baseNo: string | null | undefined): 'PREPARING' | 'IN_PROCESS' {
  return String(baseNo ?? '').trim() ? 'IN_PROCESS' : 'PREPARING';
}
