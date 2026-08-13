/** Live process hubs — never flag-gate (QA Docker seeds station.* false). */
const LIVE = new Set(['HRS', 'PKL', 'ANN', 'RWD']);
const GATED = new Set(['CRS', 'CTL']);
const PROCESS = new Set(['HRS', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL']);

export type ProcessStationKind = 'hub' | 'disabled' | 'not-process';

/**
 * How UserScopeShell should enter a process station.
 * Live lines always hub. Never returns a /capture bounce.
 */
export function processStationEntry(code: string, flagEnabled: boolean): ProcessStationKind {
  const c = code.toUpperCase();
  if (LIVE.has(c)) return 'hub';
  if (GATED.has(c)) return flagEnabled ? 'hub' : 'disabled';
  return 'not-process';
}

export function isProcessHubMachine(code: string): boolean {
  return PROCESS.has(code.toUpperCase());
}

/**
 * Where /capture/{HRS|PKL|ANN|RWD|CRS|CTL} should go.
 * Never `/` (RoleHomeRedirect loops) and never `/capture/…` (self-loop).
 */
export function processHubRedirect(homePath: string): { to: string } | { comingSoon: true } {
  if (!homePath || homePath === '/' || homePath.startsWith('/capture/')) {
    return { comingSoon: true };
  }
  return { to: homePath };
}
