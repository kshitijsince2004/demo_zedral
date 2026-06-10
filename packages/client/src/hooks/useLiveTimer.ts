import { useState, useEffect } from 'react';

export function formatDuration(ms: number) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function useLiveTimer(startTime?: string | Date | null, isActive: boolean = true) {
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
    if (!startTime || !isActive) {
      setElapsed(0);
      return;
    }

    const startMs = new Date(startTime).getTime();
    
    // Initial calculation
    setElapsed(Date.now() - startMs);

    const interval = setInterval(() => {
      setElapsed(Date.now() - startMs);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, isActive]);

  return {
    elapsedMs: elapsed,
    formatted: formatDuration(elapsed),
  };
}
