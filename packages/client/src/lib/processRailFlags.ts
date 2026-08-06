/** Rolling/6HI-parity primary slot: Start | Resume | End — never End while a stoppage is open. */
export function processRailFlags(
  status: 'idle' | 'running' | 'stoppage',
  coilNo: string,
  opts?: { hasActiveStoppage?: boolean },
) {
  const isRunning = status === 'running';
  const isStoppage = status === 'stoppage';
  /**
   * Open stoppage record (Rolling `order.activeStoppage`).
   * When status is stoppage and caller omits the flag, treat as open (safe default).
   */
  const hasActiveStoppage = opts?.hasActiveStoppage ?? isStoppage;

  const canStart = status === 'idle' && !!coilNo;
  // Rolling: Resume only after the open stoppage is closed while order is still STOPPAGE.
  const canResume = isStoppage && !hasActiveStoppage;
  // Rolling: End while running, or when Resume is available — never while stoppage is open.
  const canEnd = (isRunning || canResume) && !hasActiveStoppage;

  return {
    isRunning,
    isStoppage,
    hasActiveStoppage,
    canStart,
    canResume,
    canEnd,
    primary: (canStart ? 'Start' : canResume ? 'Resume' : canEnd ? 'End' : 'none') as
      'Start' | 'Resume' | 'End' | 'none',
    machineStatus: (hasActiveStoppage || isStoppage ? 'Stopped' : isRunning ? 'Running' : 'Idle') as
      'Stopped' | 'Running' | 'Idle',
  };
}
