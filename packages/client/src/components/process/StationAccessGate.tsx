import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { canAccessMachine } from '../../lib/machineRouting';
import { getRoleHomePath } from '../../lib/roleHome';

interface StationAccessGateProps {
  machine: string;
  children: React.ReactNode;
}

/** Non-CRM process station access gate (generalised from MillAccessGate). */
export function StationAccessGate({ machine, children }: StationAccessGateProps) {
  const role = useAuthStore((s) => s.role);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const username = useAuthStore((s) => s.username);

  if (!canAccessMachine(role, machineAccess, machine)) {
    return <Navigate to={getRoleHomePath(role, lineAccess, machineAccess, username)} replace />;
  }

  return <>{children}</>;
}
