import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { ProductionActionRail } from '../src/components/process/ProductionActionRail';

function RailHarness() {
  const [status, setStatus] = useState<'idle' | 'running' | 'stoppage'>('idle');
  const [runStartedAt, setRunStartedAt] = useState<string | undefined>();
  return (
    <ProductionActionRail
      coilNo="PKL-COIL-001"
      status={status}
      runStartedAt={runStartedAt}
      onStart={() => {
        setStatus('running');
        setRunStartedAt(new Date().toISOString());
      }}
      onEnd={() => {}}
      onStoppage={() => setStatus('stoppage')}
      onRemark={() => {}}
      onHold={() => {}}
    />
  );
}

describe('ProductionActionRail Start→End (6HI)', () => {
  it('Start click swaps primary to End and enables timer slot', async () => {
    const user = userEvent.setup();
    render(<RailHarness />);

    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^end$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /start/i }));

    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^end$/i })).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});
