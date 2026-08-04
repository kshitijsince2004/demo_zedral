import { useEffect, useRef, useState } from 'react';
import { getServerTime } from '../lib/apiClient';
import { formatRuntimeMs } from '../lib/sixHiRuntime';
import { subscribeTimerTick } from './useTimerTick';

export type ProcessTimerStoppage = {
  id?: string;
  startAt: string;
  endAt?: string | null;
};

/** Net production ms = wall since prodStart − stoppage intervals (active included → freezes). */
export function processNetRuntimeMs(
  prodStartAt: string | null | undefined,
  stoppages: ProcessTimerStoppage[],
  activeStoppageId?: string | null,
): number | null {
  if (!prodStartAt) return null;
  const now = getServerTime();
  const wall = Math.max(0, now - new Date(prodStartAt).getTime());
  let stopMs = 0;
  for (const s of stoppages) {
    if (s.endAt) {
      stopMs += Math.max(0, new Date(s.endAt).getTime() - new Date(s.startAt).getTime());
    } else if (activeStoppageId && s.id && s.id === activeStoppageId) {
      stopMs += Math.max(0, now - new Date(s.startAt).getTime());
    } else if (!s.endAt) {
      // Open stoppage without id match — still deduct (optimistic / single open).
      stopMs += Math.max(0, now - new Date(s.startAt).getTime());
    }
  }
  return Math.max(0, wall - stopMs);
}

function timerKey(
  prodStartAt: string | null | undefined,
  stoppages: ProcessTimerStoppage[],
  activeStoppageId?: string | null,
): string {
  if (!prodStartAt) return '';
  return [
    prodStartAt,
    activeStoppageId ?? '',
    stoppages.map((s) => `${s.id ?? ''}:${s.startAt}:${s.endAt ?? ''}`).join(','),
  ].join('|');
}

/** Live net production timer for process lines (PKL parity with Rolling). */
export function useProcessNetTimer(
  prodStartAt: string | null | undefined,
  stoppages: ProcessTimerStoppage[],
  active: boolean,
  activeStoppageId?: string | null,
): string | null {
  const stoppagesRef = useRef(stoppages);
  stoppagesRef.current = stoppages;
  const key = timerKey(prodStartAt, stoppages, activeStoppageId);
  const [formatted, setFormatted] = useState<string | null>(() => {
    if (!active || !prodStartAt) return null;
    const ms = processNetRuntimeMs(prodStartAt, stoppages, activeStoppageId);
    return ms != null ? formatRuntimeMs(ms) : null;
  });

  useEffect(() => {
    if (!active || !key) {
      setFormatted(null);
      return;
    }
    const tick = () => {
      const ms = processNetRuntimeMs(prodStartAt, stoppagesRef.current, activeStoppageId);
      const next = ms != null ? formatRuntimeMs(ms) : null;
      setFormatted((prev) => (prev === next ? prev : next));
    };
    tick();
    return subscribeTimerTick(tick);
  }, [active, key, prodStartAt, activeStoppageId]);

  return formatted;
}
