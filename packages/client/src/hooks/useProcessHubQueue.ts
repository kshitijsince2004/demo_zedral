import { useEffect } from 'react';
import useSWR from 'swr';
import { apiClient } from '../lib/apiClient';
import { networkAwareRefreshInterval } from '../lib/networkAwareInterval';
import { subscribeProductionSync } from '../lib/productionSync';
import { jsonEqual } from '../lib/silentRefresh';
import type { ProcessStationCode } from '../lib/processConfig';
import { mapQueue, processQueueUrl, useProcessStore } from '../store/processStore';

async function fetchProcessQueue(url: string, code: ProcessStationCode) {
  const raw = await apiClient.get(url);
  return mapQueue(code, raw);
}

/** SWR queue for process hubs — mirrors useSixHiHubQueue (15s poll + production sync). */
export function useProcessHubQueue(
  processCode: ProcessStationCode,
  refreshToken?: number,
) {
  const queueUrl = processQueueUrl(processCode);

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    queueUrl,
    (url) => fetchProcessQueue(url, processCode),
    {
      refreshInterval: networkAwareRefreshInterval(15_000),
      revalidateOnFocus: false,
      keepPreviousData: true,
      compare: (a, b) => jsonEqual(a, b),
    },
  );

  useEffect(() => subscribeProductionSync(() => { void mutate(); }), [mutate]);

  useEffect(() => {
    if (!refreshToken) return;
    void mutate();
  }, [refreshToken, mutate]);

  // Keep one cache — rail / Live Status read store.queue.
  useEffect(() => {
    if (!data) return;
    useProcessStore.setState({ queue: data, processCode });
  }, [data, processCode]);

  return { data, error, isLoading, isValidating, mutate, dataUpdatedAt: Date.now() };
}
