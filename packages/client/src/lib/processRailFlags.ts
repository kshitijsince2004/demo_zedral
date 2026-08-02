/** 6HI-style primary slot: exactly one of Start | Resume | End. */
export function processRailFlags(status: 'idle' | 'running' | 'stoppage', coilNo: string) {
  const isRunning = status === 'running';
  const isStoppage = status === 'stoppage';
  const canStart = status === 'idle' && !!coilNo;
  const canResume = isStoppage;
  const canEnd = isRunning; // not during stoppage — Resume replaces End
  return {
    isRunning,
    isStoppage,
    canStart,
    canResume,
    canEnd,
    primary: (canStart ? 'Start' : canResume ? 'Resume' : canEnd ? 'End' : 'none') as
      'Start' | 'Resume' | 'End' | 'none',
    machineStatus: (isStoppage ? 'Stopped' : isRunning ? 'Running' : 'Idle') as
      'Stopped' | 'Running' | 'Idle',
  };
}
