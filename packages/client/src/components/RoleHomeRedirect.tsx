import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getRoleHomePath } from '../lib/roleHome';

export function RoleHomeRedirect() {
  const role = useAuthStore((s) => s.role);
  const username = useAuthStore((s) => s.username);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  return (
    <Navigate
      to={getRoleHomePath(role, lineAccess, machineAccess, username)}
      replace
    />
  );
}
