import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getRoleHomePath } from '../lib/roleHome';

export function RoleHomeRedirect() {
  const role = useAuthStore((s) => s.role);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const username = useAuthStore((s) => s.username);
  return <Navigate to={getRoleHomePath(role, lineAccess, machineAccess, username)} replace />;
}
