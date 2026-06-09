import { Navigate } from 'react-router-dom';
import type { MillCode } from '../lib/millPath';
import { useAuthStore } from '../lib/authStore';
import { canAccessMachine } from '../lib/machineRouting';
import { getRoleHomePath } from '../lib/roleHome';

interface MillAccessGateProps {
  machine: MillCode;
  children: React.ReactNode;
}

export function MillAccessGate({ machine, children }: MillAccessGateProps) {
  const role = useAuthStore((s) => s.role);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const username = useAuthStore((s) => s.username);

  if (!canAccessMachine(role, machineAccess, machine)) {
    return <Navigate to={getRoleHomePath(role, lineAccess, machineAccess, username)} replace />;
  }

  return <>{children}</>;
}
