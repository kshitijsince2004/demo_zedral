import type { ProcessCode } from './processSectionRegistry';

/** Process sections using the floor capture workspace layout (Wave 1+2). */
export const WORKSPACE_PROCESS_CODES: readonly ProcessCode[] = [
  'HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL', 'GLV',
] as const;

export function isWorkspaceProcess(code: string): boolean {
  return (WORKSPACE_PROCESS_CODES as readonly string[]).includes(code);
}
