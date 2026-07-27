import { useEffect, useRef, useState } from 'react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { formatRuntimeMs, netProductionRuntimeMs } from '../lib/sixHiRuntime';
import { subscribeTimerTick } from './useTimerTick';

function orderTimerKey(order: SixHiOrderDetail | null | undefined): string {
  if (!order?.prodStartAt) return '';
  const stoppagesKey = order.stoppages
    ?.map((s) => `${s.id}:${s.durationMin ?? s.endAt ?? s.startAt}`)
    .join(',') ?? '';
  return [
    order.prodStartAt,
    order.prodEndAt ?? '',
    order.status,
    order.activeStoppage?.id ?? '',
    stoppagesKey,
  ].join('|');
}

function formatNetRuntime(order: SixHiOrderDetail | null | undefined): string | null {
  if (!order?.prodStartAt) return null;
  const ms = netProductionRuntimeMs(order);
  return ms != null ? formatRuntimeMs(ms) : null;
}

/** Live net production timer (wall clock minus stoppage time). */
export function useNetProductionTimer(order: SixHiOrderDetail | null | undefined): string | null {
  const orderRef = useRef(order);
  orderRef.current = order;
  const timerKey = orderTimerKey(order);
  const [formatted, setFormatted] = useState<string | null>(() => formatNetRuntime(order));

  useEffect(() => {
    if (!timerKey) {
      setFormatted(null);
      return;
    }

    const tick = () => {
      const next = formatNetRuntime(orderRef.current);
      setFormatted((prev) => (prev === next ? prev : next));
    };

    tick();
    return subscribeTimerTick(tick);
  }, [timerKey]);

  return formatted;
}
