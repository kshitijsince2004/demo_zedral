import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getRoleHomePath } from '../lib/roleHome';

export function RoleHomeRedirect() {
  const role = useAuthStore((s) => s.role);
  return <Navigate to={getRoleHomePath(role)} replace />;
}
