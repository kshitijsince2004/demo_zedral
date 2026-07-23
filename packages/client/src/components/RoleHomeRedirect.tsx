import { Navigate } from 'react-router-dom';
import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { pickPrimaryRole } from '@m1/shared-validation';
import { useAuthStore } from '../lib/authStore';
import { getRoleHomePath } from '../lib/roleHome';

/**
 * Role-native landing redirect.
 * Waits until authStore role matches SuperTokens JWT claims so a stale
 * sessionStorage `mock_role` (e.g. MACHINE_HEAD) cannot send supervisors
 * to `/machine-head-dashboard`.
 */
export function RoleHomeRedirect() {
  const session = useSessionContext();
  const role = useAuthStore((s) => s.role);
  const username = useAuthStore((s) => s.username);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const token = useAuthStore((s) => s.token);

  if (session.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }

  if (session.doesSessionExist) {
    if (token !== 'st-session') {
      return (
        <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
          Syncing role…
        </div>
      );
    }

    const payload = session.accessTokenPayload as Record<string, unknown>;
    const jwtRoles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
    const jwtRole = pickPrimaryRole(jwtRoles);

    // Stale mock_role (e.g. MACHINE_HEAD) must not win before SuperTokensSync.
    if (!jwtRole || role !== jwtRole) {
      return (
        <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
          Syncing role…
        </div>
      );
    }

    const jwtLines = Array.isArray(payload.lineAccess) ? (payload.lineAccess as string[]) : lineAccess;
    const jwtMachines = Array.isArray(payload.machineAccess)
      ? (payload.machineAccess as string[])
      : machineAccess;
    const jwtUsername = typeof payload.username === 'string' ? payload.username : username;

    return (
      <Navigate
        to={getRoleHomePath(jwtRole, jwtLines, jwtMachines, jwtUsername)}
        replace
      />
    );
  }

  return (
    <Navigate
      to={getRoleHomePath(role, lineAccess, machineAccess, username)}
      replace
    />
  );
}
