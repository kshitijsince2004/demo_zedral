import useSWR from 'swr';
import { apiClient } from '../lib/apiClient';

interface TenantFlagsResponse {
  flags: Record<string, boolean>;
  enabledModules: string[];
}

export function useTenantStationFlag(stationCode: string | null) {
  const key = stationCode ? '/tenant-flags' : null;
  const { data, error, isLoading } = useSWR<TenantFlagsResponse>(key, async () => apiClient.get('/tenant-flags'));

  const flagKey = stationCode ? `station.${stationCode.toLowerCase()}` : null;
  const flagValue = flagKey ? data?.flags?.[flagKey] : null;

  // Fail-open: if flags are unreachable/missing, keep new workspaces usable.
  const enabled = flagValue == null ? true : flagValue;
  return { enabled, loading: Boolean(stationCode) && isLoading && !error };
}

