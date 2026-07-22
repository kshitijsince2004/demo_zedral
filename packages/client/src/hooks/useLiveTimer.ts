import { useState, useEffect } from 'react';

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
  const [elapsed, setElapsed] = useState<number>(0);
  const startMs = startTime ? new Date(startTime).getTime() : NaN;
  const canTick = isActive && Number.isFinite(startMs);

  useEffect(() => {
    if (!canTick) {
      setElapsed(0);
      return;
    }

    setElapsed(Date.now() - startMs);

    const interval = setInterval(() => {
      setElapsed(Date.now() - startMs);
    }, 1000);

    return () => clearInterval(interval);
  }, [canTick, startMs]);

  return {
    elapsedMs: canTick ? elapsed : 0,
    formatted: canTick ? formatDuration(elapsed) : '',
  };
}
