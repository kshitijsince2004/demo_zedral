import { describe, expect, it } from 'vitest';
import { processRailFlags } from '../src/lib/processRailFlags';

describe('processRailFlags (Rolling Start/End/Stoppage parity)', () => {
  it('idle → Start only', () => {
    const f = processRailFlags('idle', 'PKL-COIL-001');
    expect(f).toMatchObject({ canStart: true, canResume: false, canEnd: false, primary: 'Start', machineStatus: 'Idle' });
  });

  it('running → End only', () => {
    const f = processRailFlags('running', 'PKL-COIL-001', { hasActiveStoppage: false });
    expect(f).toMatchObject({ canStart: false, canResume: false, canEnd: true, primary: 'End', machineStatus: 'Running' });
  });

  it('open stoppage → no End, no Resume (Manage Stop only)', () => {
    const f = processRailFlags('stoppage', 'PKL-COIL-001', { hasActiveStoppage: true });
    expect(f).toMatchObject({
      canStart: false,
      canResume: false,
      canEnd: false,
      hasActiveStoppage: true,
      primary: 'none',
      machineStatus: 'Stopped',
    });
  });

  it('stoppage without open record → Resume (+ End), like Rolling after stop closed', () => {
    const f = processRailFlags('stoppage', 'PKL-COIL-001', { hasActiveStoppage: false });
    expect(f).toMatchObject({
      canStart: false,
      canResume: true,
      canEnd: true,
      primary: 'Resume',
      machineStatus: 'Stopped',
    });
  });

  it('stoppage status defaults to open stoppage when flag omitted', () => {
    const f = processRailFlags('stoppage', 'PKL-COIL-001');
    expect(f.canEnd).toBe(false);
    expect(f.canResume).toBe(false);
    expect(f.hasActiveStoppage).toBe(true);
  });
});
