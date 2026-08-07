import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  queueNextCursor?: string | null;
}

const QUEUE_PAGE_LIMIT = 50;

function buildQueueUrl(input: {
  apiSubProcess: string;
  date: string;
  queueMachine: string;
  shift?: string;
  shiftLogId?: string | null;
  operationalDate: string;
  cursor?: string | null;
}): string {
  const params = new URLSearchParams({
    subProcess: input.apiSubProcess,
    date: input.date,
    machine: input.queueMachine,
    limit: String(QUEUE_PAGE_LIMIT),
  });
  if (input.shift) params.set('shift', input.shift);
  if (input.shiftLogId && input.date === input.operationalDate) {
    params.set('shiftLogId', input.shiftLogId);
  }
  if (input.cursor) params.set('cursor', input.cursor);
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
    queueNextCursor: Array.isArray(res) ? null : (res.queueNextCursor ?? null),
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

  const [tail, setTail] = useState<SixHiQueueCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const loadingMore = useRef(false);

  useEffect(() => {
    // Bail when already empty — setTail([]) is a new [] every time and re-renders.
    setTail((prev) => (prev.length === 0 ? prev : []));
    setNextCursor(data?.queueNextCursor ?? null);
  }, [queueUrl, data?.queueNextCursor]);

  useEffect(() => subscribeProductionSync(() => { void mutate(); }), [mutate]);

  useEffect(() => {
    if (!input.refreshToken) return;
    void mutate();
  }, [input.refreshToken, mutate]);

  const loadMoreQueue = useCallback(async () => {
    if (!nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await fetchHubQueue(buildQueueUrl({
        apiSubProcess: input.apiSubProcess,
        date: input.date,
        queueMachine: input.queueMachine,
        shift: input.shift,
        shiftLogId: input.shiftLogId,
        operationalDate: input.operationalDate,
        cursor: nextCursor,
      }));
      setTail((prev) => [...prev, ...page.queue]);
      setNextCursor(page.queueNextCursor ?? null);
    } finally {
      loadingMore.current = false;
    }
  }, [
    input.apiSubProcess,
    input.date,
    input.queueMachine,
    input.shift,
    input.shiftLogId,
    input.operationalDate,
    nextCursor,
  ]);

  // Stable reference — bare `{...data, queue:[...]}` every render made SixHiCrmHub
  // allOrders churn → selection useEffects → max update depth.
  const merged = useMemo(
    () => (data
      ? { ...data, queue: [...data.queue, ...tail], queueNextCursor: nextCursor }
      : data),
    [data, tail, nextCursor],
  );

  return { data: merged, error, isLoading, isValidating, mutate, loadMoreQueue, hasMoreQueue: !!nextCursor };
}
