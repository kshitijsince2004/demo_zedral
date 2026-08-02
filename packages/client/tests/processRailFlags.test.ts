import { describe, expect, it } from 'vitest';
import { processRailFlags } from '../src/lib/processRailFlags';

describe('processRailFlags (6HI Start/End parity)', () => {
  it('idle → Start only', () => {
    const f = processRailFlags('idle', 'PKL-COIL-001');
    expect(f).toMatchObject({ canStart: true, canResume: false, canEnd: false, primary: 'Start', machineStatus: 'Idle' });
  });

  it('running → End only (Start becomes End)', () => {
    const f = processRailFlags('running', 'PKL-COIL-001');
    expect(f).toMatchObject({ canStart: false, canResume: false, canEnd: true, primary: 'End', machineStatus: 'Running' });
  });

  it('stoppage → Resume only (not End+Resume)', () => {
    const f = processRailFlags('stoppage', 'PKL-COIL-001');
    expect(f).toMatchObject({ canStart: false, canResume: true, canEnd: false, primary: 'Resume', machineStatus: 'Stopped' });
  });
});
