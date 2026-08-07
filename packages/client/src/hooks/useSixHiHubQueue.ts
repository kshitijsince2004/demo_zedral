import { useEffect } from 'react';
import useSWR from 'swr';
import type { SixHiQueueCard } from '@m1/shared-validation';
import { apiClient } from '../lib/apiClient';
import { networkAwareRefreshInterval } from '../lib/networkAwareInterval';
import { subscribeProductionSync } from '../lib/productionSync';
import { jsonEqual } from '../lib/silentRefresh';

export interface SixHiHubQueueData {
  queue: SixHiQueueCard[];
  pendingAllocation: SixHiQueueCard[];
  backlog: SixHiQueueCard[];
  completed: SixHiQueueCard[];
  rejected: SixHiQueueCard[];
}

function buildQueueUrl(input: {
  apiSubProcess: string;
  date: string;
  queueMachine: string;
  shift?: string;
  shiftLogId?: string | null;
  operationalDate: string;
}): string {
  const params = new URLSearchParams({
    subProcess: input.apiSubProcess,
    date: input.date,
    machine: input.queueMachine,
  });
  if (input.shift) params.set('shift', input.shift);
  if (input.shiftLogId && input.date === input.operationalDate) {
    params.set('shiftLogId', input.shiftLogId);
  }
  return `/6hi/queue?${params.toString()}`;
}

async function fetchHubQueue(url: string): Promise<SixHiHubQueueData> {
  const res = await apiClient.get(url);
  const shiftReady = url.includes('shiftLogId=') || url.includes('shift=');
  const completedForShift = shiftReady
    ? (Array.isArray(res) ? [] : (res.completed ?? []))
    : [];
  return {
    queue: Array.isArray(res) ? res : (res.queue ?? []),
    pendingAllocation: Array.isArray(res) ? [] : (res.pendingAllocation ?? []),
    backlog: Array.isArray(res) ? [] : (res.backlog ?? []),
    completed: completedForShift,
    rejected: Array.isArray(res) ? [] : (res.rejected ?? []),
  };
}

export function useSixHiHubQueue(input: {
  apiSubProcess: string;
  date: string;
  queueMachine: string;
  shift?: string;
  shiftLogId?: string | null;
  operationalDate: string;
  refreshToken?: number;
}) {
  const queueUrl = buildQueueUrl(input);

  const { data, error, isLoading, isValidating, mutate } = useSWR(queueUrl, fetchHubQueue, {
    refreshInterval: networkAwareRefreshInterval(15_000),
    revalidateOnFocus: false,
    keepPreviousData: true,
    compare: (a, b) => jsonEqual(a, b),
  });

  useEffect(() => subscribeProductionSync(() => { void mutate(); }), [mutate]);

  useEffect(() => {
    if (!input.refreshToken) return;
    void mutate();
  }, [input.refreshToken, mutate]);

  return { data, error, isLoading, isValidating, mutate };
}
