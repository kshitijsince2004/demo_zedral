import { memo } from 'react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { formatPlantClock } from '../../lib/dateFormat';
import { NetProductionTimerText, StoppageTimerText } from './ProductionTimerDisplay';

/** Live production/stoppage banner — timer hooks are scoped here so forms do not re-render. */
export const ProductionStatusBanner = memo(function ProductionStatusBanner({
  order,
  compact,
}: {
  order: SixHiOrderDetail;
  compact?: boolean;
}) {
  const isRunning = order.status === 'IN_PROGRESS' && !!order.prodStartAt && !order.activeStoppage;
  const isStoppageActive = !!order.activeStoppage;

  if (!isRunning && !isStoppageActive) return null;

  return (
    <div className={`flex items-center justify-between rounded-xl border shadow-sm transition-colors shrink-0 ${
      compact ? 'px-4 py-2' : 'px-6 py-4'
    } ${
      isStoppageActive
        ? 'bg-destructive text-white border-destructive'
        : 'bg-success text-white border-success'
    }`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide opacity-80 mb-0.5">
            {isStoppageActive ? 'Stoppage Active' : 'Production Active'}
          </div>
          <div className={`font-semibold truncate ${compact ? 'text-sm' : 'text-base'}`}>
            {isStoppageActive
              ? `${order.activeStoppage?.categoryLabel ?? 'Stopped'} · ${order.activeStoppage?.remarks ?? 'No remarks'}`
              : `Running since ${formatPlantClock(order.prodStartAt!)}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isStoppageActive ? (
          <StoppageTimerText
            startAt={order.activeStoppage?.startAt}
            active
            className={`font-mono font-bold tracking-tight ${compact ? 'text-2xl' : 'text-3xl'}`}
          />
        ) : (
          <NetProductionTimerText
            order={order}
            className={`font-mono font-bold tracking-tight ${compact ? 'text-2xl' : 'text-3xl'}`}
          />
        )}
      </div>
    </div>
  );
});
