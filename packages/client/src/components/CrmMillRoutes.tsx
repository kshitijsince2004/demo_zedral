import { Outlet } from 'react-router-dom';
import type { MillCode } from '../lib/millPath';
import { MillAccessGate } from './MillAccessGate';
import { SixHiLayout } from './sixHi/SixHiLayout';

interface CrmMillShellProps {
  machine: MillCode;
}

/** Same SixHiLayout UX gated by assigned machine (4HI / 2HI / 6HI). */
export function CrmMillShell({ machine }: CrmMillShellProps) {
  return (
    <MillAccessGate machine={machine}>
      <SixHiLayout />
    </MillAccessGate>
  );
}

export function CrmMillOutlet() {
  return <Outlet />;
}
