import useSWR from 'swr';
import { apiClient } from '../lib/apiClient';
import { useAuthStore } from '../lib/authStore';
import { canAccessMachine } from '../lib/machineRouting';
import { isCrmMillCode } from '../lib/millConfig';
import { manualRerollUiFlags } from '../lib/manualRerollUi';

interface TenantFlagsResponse {
  flags: Record<string, boolean>;
  enabledModules: string[];
}

/** Fail-closed tenant flag lookup (missing/unreachable → false). */
export function useTenantFlag(flagKey: string | null) {
  const key = flagKey ? '/tenant-flags' : null;
  const { data, error, isLoading } = useSWR<TenantFlagsResponse>(key, async () => apiClient.get('/tenant-flags'));
  const flagValue = flagKey ? data?.flags?.[flagKey] : null;
  return {
    enabled: flagValue === true,
    loading: Boolean(flagKey) && isLoading && !error,
  };
}

export function useManualRerollEntry(machineCode: string) {
  const { enabled, loading } = useTenantFlag('mode.manual_reroll');
  const role = useAuthStore((s) => s.role);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const millOk = machineCode === '6HI' || machineCode === '4HI';
  return {
    ...manualRerollUiFlags({
      flagOn: enabled,
      role,
      hasMachineAccess: millOk && (isCrmMillCode(machineCode) || canAccessMachine(role, machineAccess, machineCode)),
    }),
    loading,
  };
}
