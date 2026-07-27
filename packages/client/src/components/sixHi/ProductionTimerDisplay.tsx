import { memo } from 'react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { useNetProductionTimer } from '../../hooks/useNetProductionTimer';
import { useLiveTimer } from '../../hooks/useLiveTimer';

/** Isolated net production timer — only this span re-renders each second. */
export const NetProductionTimerText = memo(function NetProductionTimerText({
  order,
  className,
  fallback = '—',
}: {
  order: SixHiOrderDetail | null | undefined;
  className?: string;
  fallback?: string;
}) {
  const formatted = useNetProductionTimer(order);
  return <span className={className}>{formatted ?? fallback}</span>;
});

/** Isolated stoppage elapsed timer — only this span re-renders each second. */
export const StoppageTimerText = memo(function StoppageTimerText({
  startAt,
  active,
  className,
  fallback = '—',
}: {
  startAt?: string | Date | null;
  active: boolean;
  className?: string;
  fallback?: string;
}) {
  const { formatted } = useLiveTimer(startAt, active);
  return <span className={className}>{formatted || fallback}</span>;
});

/** Action-rail runtime footer (completed minutes or live net timer). */
export const ProductionRuntimeFooterText = memo(function ProductionRuntimeFooterText({
  order,
  preparing,
  className,
}: {
  order: SixHiOrderDetail;
  preparing: boolean;
  className?: string;
}) {
  const formatted = useNetProductionTimer(order);
  const label = order.prodDurationMin
    ? `${order.prodDurationMin} minutes`
    : formatted
      ? formatted
      : preparing
        ? 'Preparing'
        : '—';
  return <span className={className}>{label}</span>;
});
