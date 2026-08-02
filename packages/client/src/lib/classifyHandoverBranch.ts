import { isCrmMillCode } from './millConfig';
import { isProcessStationCode } from './processConfig';

export type HandoverBranch = 'ann' | 'pkl' | 'hrs' | 'rwd' | 'crm' | 'process-fallback';

/** Which outgoing handover page to mount — prefer processCode when auth activeMachine is CRM-stale. */
export function classifyHandoverBranch(
  activeMachine: string | null | undefined,
  processCode?: string | null,
): HandoverBranch {
  const code =
    (activeMachine && isProcessStationCode(activeMachine) ? activeMachine : null)
    ?? (processCode && isProcessStationCode(processCode) ? processCode : null)
    ?? activeMachine
    ?? null;

  if (code === 'ANN') return 'ann';
  if (code === 'PKL') return 'pkl';
  if (code === 'HRS') return 'hrs';
  if (code === 'RWD') return 'rwd';
  if (code && isCrmMillCode(code)) return 'crm';
  return 'process-fallback';
}
