import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { useAuthStore, type Role } from './authStore';
import { roleFromAccessTokenPayload } from './sessionRoleUtils';

export { roleFromAccessTokenPayload, isPlantWideDeskRole } from './sessionRoleUtils';

/**
 * Effective session role for route/UI gates.
 * JWT wins when a SuperTokens session exists so a leftover MACHINE_HEAD in
 * sessionStorage cannot open MH/live UI while `/live/*` returns 403.
 */
export function useEffectiveSessionRole(): {
  role: Role | null;
  sessionLoading: boolean;
  /** True while JWT and authStore disagree (SuperTokensSync catching up). */
  roleSyncPending: boolean;
} {
  const storeRole = useAuthStore((s) => s.role);
  const session = useSessionContext();

  if (session.loading) {
    return { role: storeRole, sessionLoading: true, roleSyncPending: false };
  }

  if (session.doesSessionExist) {
    const jwtRole = roleFromAccessTokenPayload(
      session.accessTokenPayload as Record<string, unknown>,
    );
    if (jwtRole) {
      return {
        role: jwtRole,
        sessionLoading: false,
        roleSyncPending: storeRole !== jwtRole,
      };
    }
  }

  return { role: storeRole, sessionLoading: false, roleSyncPending: false };
}