import { useEffect, useState } from 'react';
import { subscribeTimerTick } from './useTimerTick';

export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Live HH:MM:SS elapsed since `startTime`.
 * Returns an empty string when inactive or when `startTime` is missing/invalid
 * so callers can fall back to "—" instead of showing 00:00:00.
 */
export function useLiveTimer(startTime?: string | Date | null, isActive: boolean = true) {
  const startMs = startTime ? new Date(startTime).getTime() : NaN;
  const canTick = isActive && Number.isFinite(startMs);
  const [formatted, setFormatted] = useState(() =>
    canTick ? formatDuration(Date.now() - startMs) : '',
  );

  useEffect(() => {
    if (!canTick) {
      setFormatted('');
      return;
    }

    const tick = () => {
      const next = formatDuration(Date.now() - startMs);
      setFormatted((prev) => (prev === next ? prev : next));
    };

    tick();
    return subscribeTimerTick(tick);
  }, [canTick, startMs]);

  return {
    elapsedMs: canTick ? Math.max(0, Date.now() - startMs) : 0,
    formatted: canTick ? formatted : '',
  };
}
