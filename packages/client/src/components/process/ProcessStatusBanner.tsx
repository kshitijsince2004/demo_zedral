import { memo } from 'react';
import { formatPlantClock } from '../../lib/dateFormat';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { useProcessStore } from '../../store/processStore';

/** Live production/stoppage banner — driven by processStore (not sixHiStore). */
export const ProcessStatusBanner = memo(function ProcessStatusBanner({
  compact,
  stoppageLabel,
}: {
  compact?: boolean;
  stoppageLabel?: string;
}) {
  const captureStatus = useProcessStore((s) => s.captureStatus);
  const runStartedAt = useProcessStore((s) => s.runStartedAt);
  const stoppageStartedAt = useProcessStore((s) => s.stoppageStartedAt);
  const isRunning = captureStatus === 'running' && !!runStartedAt;
  const isStoppage = captureStatus === 'stoppage' && !!stoppageStartedAt;
  const { formatted } = useLiveTimer(
    isStoppage ? stoppageStartedAt : isRunning ? runStartedAt : undefined,
    isRunning || isStoppage,
  );

  if (!isRunning && !isStoppage) return null;

  return (
    <div
      className={`flex items-center justify-between rounded-xl border shadow-sm transition-colors shrink-0 ${
        compact ? 'px-4 py-2' : 'px-6 py-4'
      } ${
        isStoppage
          ? 'bg-destructive text-white border-destructive'
          : 'bg-success text-white border-success'
      }`}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide opacity-80 mb-0.5">
          {isStoppage ? 'Stoppage Active' : 'Production Active'}
        </div>
        <div className={`font-semibold truncate ${compact ? 'text-sm' : 'text-base'}`}>
          {isStoppage
            ? (stoppageLabel || 'Stopped')
            : `Running since ${formatPlantClock(runStartedAt!)}`}
        </div>
      </div>
      <span className={`font-mono font-bold tracking-tight shrink-0 ${compact ? 'text-2xl' : 'text-3xl'}`}>
        {formatted || '—'}
      </span>
    </div>
  );
});
