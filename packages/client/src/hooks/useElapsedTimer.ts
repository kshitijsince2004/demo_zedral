import { useState, useEffect } from 'react';
import { getServerTime } from '../lib/apiClient';

/**
 * useElapsedTimer
 *
 * Returns a live HH:MM:SS string that ticks every second.
 * Seeded from a server-provided ISO timestamp so the timer is accurate
 * even after a page refresh.
 *
 * @param sinceIso - ISO 8601 timestamp of when the state began.
 *                   Pass undefined to disable the timer (returns '—').
 */
export function useElapsedTimer(sinceIso: string | undefined): string {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const compute = () => {
      if (!sinceIso) return setElapsed('—');
      const sinceMs = new Date(sinceIso).getTime();
      if (!Number.isFinite(sinceMs)) return setElapsed('—');
      const diffMs = getServerTime() - sinceMs;
      if (diffMs < 0) return setElapsed('00:00:00');
      const totalSeconds = Math.floor(diffMs / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      setElapsed(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      );
    };

    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [sinceIso]);

  return elapsed;
}
