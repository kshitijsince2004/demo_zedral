import { useEffect, useState } from 'react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { formatRuntimeMs, netProductionRuntimeMs } from '../lib/sixHiRuntime';

/** Live net production timer (wall clock minus stoppage time). */
export function useNetProductionTimer(order: SixHiOrderDetail | null | undefined): string | null {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    if (!order?.prodStartAt) {
      setFormatted(null);
      return;
    }

    const tick = () => {
      const ms = netProductionRuntimeMs(order);
      setFormatted(ms != null ? formatRuntimeMs(ms) : null);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [
    order?.prodStartAt,
    order?.status,
    order?.activeStoppage?.id,
    order?.stoppages?.length,
    order?.stoppages?.map((s) => `${s.id}:${s.durationMin ?? s.endAt ?? s.startAt}`).join(','),
  ]);

  return formatted;
}
